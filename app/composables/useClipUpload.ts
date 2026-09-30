import type { GameHalf } from '#shared/schemas/game'
import { HALF_LABELS } from '#shared/schemas/game'
import { getClipStore } from '~/utils/clip-store'
import { getUploadStore } from '~/utils/upload-store'
import {
  CHUNK_BYTES,
  createUploadSession,
  NOT_CONFIGURED_MESSAGE,
  uploadChunks,
  UploadLimitError,
  UPLOAD_LIMIT_MESSAGE,
} from '~/utils/youtube-upload'

/**
 * 把片段上傳到 YouTube 的佇列（見 `docs/game-recording-plan.md`）。
 *
 * 「怎麼把位元組送上去」在 `~/utils/youtube-upload.ts`。這裡是佇列：排隊、
 * 進度、重試、成功之後登錄到比賽上。兩個呼叫端共用它 —— 錄影頁
 * （`/admin/record/[id]`）與從裝置挑檔案的「上傳影片檔」（`/admin/upload/[id]`）。
 *
 * ## ⚠️ 佇列活在 plugin 上，不在頁面上
 * 原本它是一般的 composable，狀態跟著頁面生滅 —— 於是換一頁就會出現
 * 「正在傳的那一個在背景繼續（XHR 不綁元件生命週期），還沒開始的那幾個
 * 卻因為 Blob 被清掉而失敗」這種一半一半的狀態，而且畫面已經不在，兩邊都
 * 看不到。而一個 4K 半局的檔案要傳幾十分鐘，中途去看一下別的後台頁是常態
 * 而不是例外。
 *
 * 現在整個佇列由 `app/plugins/clip-upload.client.ts` 建立一次，站內換頁
 * 不影響它。`useClipUpload()` 只是把它**依比賽篩過**的檢視交給頁面，
 * 所以兩個頁面的用法和原本一模一樣。
 *
 * ## 關掉分頁還是會斷，所以要落地
 * plugin 撐得過換頁，撐不過重新載入。從裝置挑的檔案因此會連同「上傳網址
 * 與已確認的位移」寫進 IndexedDB（`~/utils/upload-store.ts`），回到頁面
 * 就能從斷點接著傳。錄影頁不必：它的片段本來就留在 `clip-store` 裡。
 *
 * ## 上傳失敗不會弄丟影片
 * 錄影的片段在丟進佇列之前已經存到裝置上了；挑檔案的那一種，檔案本來就在
 * 裝置上。所以這裡的失敗一律只是「這一段還沒上去」，不是「這一段沒了」——
 * 訊息要講清楚，不要讓人以為白錄了。
 */

export type ClipUploadState = 'waiting' | 'uploading' | 'done' | 'failed'

export interface ClipUpload {
  id: string
  gameId: string
  inning: number
  half: GameHalf
  /** 顯示用的名字：挑檔案的是檔名，錄影的是「第 N 局X半」。 */
  label: string
  bytes: number
  state: ClipUploadState
  /** 0～100。resumable upload 沒有原生進度，這是用 XHR 的 progress 事件算的。 */
  progress: number
  error: string
  videoId: string
}

export interface EnqueueOptions {
  gameId: string
  inning: number
  half: GameHalf
  blob: Blob
  /** YouTube 上的標題。續傳時要和第一次開工作階段時一致。 */
  title: string
  label?: string
  /** 錄影頁在 `clip-store` 的暫存 id。上傳成功後用它刪掉暫存。 */
  sessionId?: string
  /** 寫進 `upload-store`，重新載入後可以接著傳。從裝置挑的檔案才需要。 */
  persist?: boolean
  /** 從 `upload-store` 救回來的：沿用原本的 id 與斷點。 */
  id?: string
  resume?: { location: string; offset: number }
}

/**
 * 建立佇列。**整個 app 只呼叫一次**（在 client plugin 裡），
 * 頁面拿到的是下面 `useClipUpload()` 篩過的檢視。
 */
export function createClipUploadQueue() {
  const queue = ref<ClipUpload[]>([])
  const { post } = useApi()
  const store = getUploadStore()

  /** 撞到當天的上傳額度。整批停下，而不是讓每一段各撞一次。 */
  const limitReached = ref(false)

  let running = false
  let seq = 0

  /** Blob 只留在這個 Map 裡，上傳完就丟掉。 */
  const blobs = new Map<string, Blob>()
  /** 佇列項目 → IndexedDB 裡的錄影暫存 id。 */
  const sessions = new Map<string, string>()
  /** 要不要把進度寫進 `upload-store`。 */
  const persisted = new Set<string>()
  /** 上傳網址與已確認的位移。重試與續傳都靠它。 */
  const resumes = new Map<string, { location: string; offset: number }>()
  /** 上一次寫進 IndexedDB 時的位移，用來節流。 */
  const lastWritten = new Map<string, number>()
  /** 佇列項目 → YouTube 標題。續傳時要和第一次開工作階段時一致。 */
  const titles = new Map<string, string>()

  function patch(id: string, changes: Partial<ClipUpload>) {
    queue.value = queue.value.map((item) => (item.id === id ? { ...item, ...changes } : item))
  }

  function enqueue(options: EnqueueOptions): string {
    const id = options.id ?? `${options.gameId}-${options.inning}-${options.half}-${(seq += 1)}`
    const label = options.label ?? `第 ${options.inning} 局${HALF_LABELS[options.half]}`

    blobs.set(id, options.blob)
    titles.set(id, options.title)
    if (options.sessionId) sessions.set(id, options.sessionId)
    if (options.resume) resumes.set(id, options.resume)
    if (options.persist) {
      persisted.add(id)
      // 寫失敗不該擋住上傳 —— 最壞只是「重新載入後救不回來」，
      // 而那正是沒有這個功能之前的行為
      void store
        .save({
          id,
          gameId: options.gameId,
          inning: options.inning,
          half: options.half,
          title: options.title,
          fileName: label,
          file: options.blob as File,
          location: options.resume?.location ?? '',
          offset: options.resume?.offset ?? 0,
          createdAt: Date.now(),
        })
        .catch(() => {})
    }

    queue.value = [
      ...queue.value,
      {
        id,
        gameId: options.gameId,
        inning: options.inning,
        half: options.half,
        label,
        bytes: options.blob.size,
        state: 'waiting',
        progress: options.resume
          ? Math.round((options.resume.offset / options.blob.size) * 100)
          : 0,
        error: '',
        videoId: '',
      },
    ]
    void drain()
    return id
  }

  /**
   * 一次只傳一個。
   *
   * 平行上傳在球場的行動網路上只會讓每一段都變慢，而且同時錄影時還要跟
   * 編碼搶 CPU。照順序慢慢傳，反正下一個半局還有十幾分鐘。
   */
  async function drain() {
    if (running) return
    running = true

    try {
      for (;;) {
        const next = queue.value.find((item) => item.state === 'waiting')
        if (!next) break

        await upload(next)

        /*
         * 撞到當天的上傳額度就整批停下 —— 後面每一個都會撞同一面牆，
         * 繼續試只是讓七段各自失敗一次，訊息還互相蓋掉。
         * 剩下的維持 `waiting`，明天（或手動）再按重試就會接著跑。
         */
        if (limitReached.value) break
      }
    } finally {
      running = false
    }
  }

  async function upload(item: ClipUpload) {
    const blob = blobs.get(item.id)
    if (!blob) {
      patch(item.id, { state: 'failed', error: '找不到影片資料' })
      return
    }

    const resume = resumes.get(item.id)
    patch(item.id, {
      state: 'uploading',
      progress: resume ? Math.round((resume.offset / blob.size) * 100) : 0,
      error: '',
    })

    try {
      const token = await post<{ configured: boolean; accessToken?: string }>(
        '/admin/youtube/upload-token',
        {},
      )
      if (!token.configured || !token.accessToken) {
        patch(item.id, { state: 'failed', error: NOT_CONFIGURED_MESSAGE })
        return
      }

      // 已經開過工作階段就沿用它 —— 重開一個等於在 YouTube 上多一支半殘的影片
      const location =
        resume?.location ||
        (await createUploadSession({
          accessToken: token.accessToken,
          title: titles.get(item.id) ?? item.label,
          description: `第 ${item.inning} 局${HALF_LABELS[item.half]}`,
          size: blob.size,
          contentType: blob.type || 'application/octet-stream',
        }))
      remember(item.id, location, resume?.offset ?? 0, true)

      const videoId = await uploadChunks({
        location,
        blob,
        startAt: resume?.offset ?? 0,
        onProgress: (progress, offset) => {
          patch(item.id, { progress })
          remember(item.id, location, offset, false)
        },
      })

      await post(`/admin/games/${encodeURIComponent(item.gameId)}/clips`, {
        inning: item.inning,
        half: item.half,
        videoId,
        // 上傳的影片一律是私人的，改成公開是管理者在 YouTube Studio 做的事
        privacy: 'private',
      })

      patch(item.id, { state: 'done', progress: 100, videoId })
      forget(item.id)

      /*
       * 只有成功才放掉 Blob。
       *
       * 失敗的那幾個必須留著，否則「重試」按鈕按下去沒有東西可以傳。
       * 球場的網路本來就不可靠，重試是這個功能最常用到的路徑，
       * 不能為了省記憶體把它做成死的。挑檔案的那一種更是如此：`File`
       * 只是磁碟上的參照，留著幾乎不佔記憶體。
       */
      blobs.delete(item.id)

      // 已經在 YouTube 上了，暫存可以放掉。刪不掉也不影響這一段 ——
      // 最壞是下次打開時它出現在救回清單裡，使用者按丟棄就好
      const sessionId = sessions.get(item.id)
      sessions.delete(item.id)
      if (sessionId)
        void getClipStore()
          .remove(sessionId)
          .catch(() => {})
    } catch (err) {
      if (err instanceof UploadLimitError) {
        limitReached.value = true
        patch(item.id, { state: 'failed', error: UPLOAD_LIMIT_MESSAGE })
        return
      }
      patch(item.id, {
        state: 'failed',
        error: err instanceof Error ? err.message : '上傳失敗',
      })
    }
  }

  /**
   * 記住斷點。
   *
   * ⚠️ **寫 IndexedDB 要節流。** `onProgress` 在一個大檔案上會觸發上千次，
   * 每次都寫一筆的話，磁碟寫入會跟上傳搶資源，而且那些寫入之間的差別
   * 對「接著傳」毫無意義 —— 續傳本來就以**塊**為單位。所以只在跨過一整塊
   * （或剛拿到上傳網址）時才落地。
   */
  function remember(id: string, location: string, offset: number, force: boolean) {
    resumes.set(id, { location, offset })
    if (!persisted.has(id)) return

    const written = lastWritten.get(id) ?? -1
    if (!force && offset - written < CHUNK_BYTES) return
    lastWritten.set(id, offset)
    void store.progress(id, location, offset).catch(() => {})
  }

  /** 傳完了（或被丟棄）：把這一筆的所有痕跡清掉。 */
  function forget(id: string) {
    resumes.delete(id)
    lastWritten.delete(id)
    titles.delete(id)
    if (persisted.delete(id)) void store.remove(id).catch(() => {})
  }

  /** 重試某一個。失敗多半是網路，重按一次通常就過了，而且是**接著**傳。 */
  function retry(id: string) {
    // 手動重試代表「我認為現在可以了」—— 把額度旗標放掉，讓佇列重新跑
    limitReached.value = false
    if (!blobs.has(id)) {
      patch(id, { error: '影片資料已釋放，請重新挑一次檔案' })
      return false
    }
    patch(id, { state: 'waiting', error: '' })
    void drain()
    return true
  }

  /** 從佇列（與 IndexedDB）移除。正在傳的那一個不給移除，先讓它失敗或傳完。 */
  function discard(id: string) {
    blobs.delete(id)
    sessions.delete(id)
    forget(id)
    queue.value = queue.value.filter((item) => item.id !== id)
  }

  const pending = computed(
    () =>
      queue.value.filter((item) => item.state === 'waiting' || item.state === 'uploading').length,
  )

  return { queue, limitReached, pending, enqueue, retry, discard }
}

export type ClipUploadQueue = ReturnType<typeof createClipUploadQueue>

/**
 * 某一場比賽的上傳檢視。
 *
 * 佇列本身是全站共用的（見上面），這裡只把它篩成「這一場的」，
 * 所以頁面的寫法和佇列還活在頁面上的時候完全一樣。
 */
export function useClipUpload(options: {
  gameId: () => string
  title: (inning: number, half: GameHalf) => string
}) {
  const shared = useNuxtApp().$clipUploads as ClipUploadQueue

  const queue = computed(() =>
    shared.queue.value.filter((item) => item.gameId === options.gameId()),
  )

  return {
    queue,
    limitReached: shared.limitReached,
    pending: computed(
      () =>
        queue.value.filter((item) => item.state === 'waiting' || item.state === 'uploading').length,
    ),
    failed: computed(() => queue.value.filter((item) => item.state === 'failed').length),

    enqueue: (clip: Omit<EnqueueOptions, 'gameId' | 'title'> & { title?: string }) =>
      shared.enqueue({
        ...clip,
        gameId: options.gameId(),
        title: clip.title ?? options.title(clip.inning, clip.half),
      }),

    retry: shared.retry,
    discard: shared.discard,
  }
}

/** 全站的上傳狀態，給後台版面上的指示器用。 */
export function useClipUploadStatus() {
  const shared = useNuxtApp().$clipUploads as ClipUploadQueue

  const active = computed(() =>
    shared.queue.value.filter((item) => item.state === 'waiting' || item.state === 'uploading'),
  )

  return {
    count: computed(() => active.value.length),
    /** 正在傳的那一個的進度。沒有正在傳的就是 0。 */
    progress: computed(
      () => active.value.find((item) => item.state === 'uploading')?.progress ?? 0,
    ),
    /** 點下去要去哪一頁。以正在傳的那一場為準。 */
    gameId: computed(() => active.value[0]?.gameId ?? ''),
  }
}
