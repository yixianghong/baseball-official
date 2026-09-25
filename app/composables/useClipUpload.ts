import type { GameHalf } from '#shared/schemas/game'
import { HALF_LABELS } from '#shared/schemas/game'

/**
 * 把錄好的片段上傳到 YouTube（見 `docs/game-recording-plan.md`）。
 *
 * ## 檔案不經過我們的伺服器
 * 一段 1080p 有 85～140 MB。BFF 只發一個短效權杖（`/api/admin/youtube/upload-token`），
 * 瀏覽器拿著它**直傳 YouTube** —— 沒有 Storage 費、沒有流量費，也不必擔心
 * Cloud Run 的記憶體與請求逾時。
 *
 * ## 為什麼是佇列而不是 await
 * 一段傳完要 2～4 分鐘，而下一個半局馬上就要開始錄。上傳如果擋著使用者，
 * 他就得站在原地等 —— 所以錄完就丟進佇列，背景慢慢傳，人可以繼續錄下一段。
 *
 * ## 上傳失敗不會弄丟影片
 * 每一段在丟進佇列之前都已經存到裝置上了（見 `pages/admin/record/[id].vue`）。
 * 所以這裡的失敗只是「這一段還沒上去」，不是「這一段沒了」——
 * 使用者事後從手機手動上傳也可以。訊息要講清楚這件事，不要讓人以為白錄了。
 */

/** 用 resumable upload 而不是一次 POST：大檔案中斷時才有機會續傳。 */
const UPLOAD_INIT_URL =
  'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status'

export type ClipUploadState = 'waiting' | 'uploading' | 'done' | 'failed'

export interface ClipUpload {
  id: string
  inning: number
  half: GameHalf
  bytes: number
  state: ClipUploadState
  /** 0～100。resumable upload 沒有原生進度，這是用 XHR 的 progress 事件算的。 */
  progress: number
  error: string
  videoId: string
}

/**
 * YouTube 頻道每天可以上傳幾支影片是有上限的，而且**和 API 的配額是兩回事**。
 * Google 沒有公布確切數字，會依頻道的歷史與帳號信譽浮動（實務上約 15～50），
 * 觸頂後要等 24 小時。一場七局十四段很容易在一天之內撞到。
 */
class UploadLimitError extends Error {}

const UPLOAD_LIMIT_MESSAGE =
  '已達 YouTube 今日的上傳數量上限。影片都還在這台裝置上，24 小時後再按重試，或自己上傳後到後台補登。'

export function useClipUpload(options: {
  gameId: () => string
  title: (inning: number, half: GameHalf) => string
}) {
  const queue = ref<ClipUpload[]>([])
  const { post } = useApi()

  /** 撞到當天的上傳額度。整批停下，而不是讓每一段各撞一次。 */
  const limitReached = ref(false)

  /** 還沒傳完的段數。離開頁面前要用它攔一下。 */
  const pending = computed(
    () =>
      queue.value.filter((item) => item.state === 'waiting' || item.state === 'uploading').length,
  )
  const failed = computed(() => queue.value.filter((item) => item.state === 'failed').length)

  let running = false

  /** 把一段排進佇列。Blob 只留在這個 Map 裡，上傳完就丟掉。 */
  const blobs = new Map<string, Blob>()

  function enqueue(clip: { inning: number; half: GameHalf; blob: Blob }): string {
    const id = `${clip.inning}-${clip.half}-${Date.now()}`
    blobs.set(id, clip.blob)
    queue.value = [
      ...queue.value,
      {
        id,
        inning: clip.inning,
        half: clip.half,
        bytes: clip.blob.size,
        state: 'waiting',
        progress: 0,
        error: '',
        videoId: '',
      },
    ]
    void drain()
    return id
  }

  function patch(id: string, changes: Partial<ClipUpload>) {
    queue.value = queue.value.map((item) => (item.id === id ? { ...item, ...changes } : item))
  }

  /**
   * 一次只傳一段。
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
         * 撞到當天的上傳額度就整批停下 —— 後面每一段都會撞同一面牆，
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

    patch(item.id, { state: 'uploading', progress: 0, error: '' })

    try {
      const token = await post<{ configured: boolean; accessToken?: string }>(
        '/admin/youtube/upload-token',
        {},
      )
      if (!token.configured || !token.accessToken) {
        // 三個環境變數缺任何一個都會走到這裡，講清楚要去哪裡補
        patch(item.id, {
          state: 'failed',
          error: '尚未設定 YouTube 上傳（缺 NUXT_YOUTUBE_CLIENT_ID／SECRET／REFRESH_TOKEN）',
        })
        return
      }

      const location = await startUpload(token.accessToken, item, blob)
      const videoId = await sendBytes(location, blob, (progress) => patch(item.id, { progress }))

      await post(`/admin/games/${encodeURIComponent(options.gameId())}/clips`, {
        inning: item.inning,
        half: item.half,
        videoId,
        // 上傳的影片一律是私人的，改成公開是管理者在 YouTube Studio 做的事
        privacy: 'private',
      })

      patch(item.id, { state: 'done', progress: 100, videoId })

      /*
       * 只有成功才放掉 Blob。
       *
       * 一段 140 MB，留著當然佔記憶體 —— 但失敗的那幾段必須留著，
       * 否則「重試」按鈕按下去沒有東西可以傳。球場的網路本來就不可靠，
       * 重試是這個功能最常用到的路徑，不能為了省記憶體把它做成死的。
       *
       * 最壞的情況（連續失敗好幾段）使用者看得到警告，而且影片已經存在
       * 裝置上了 —— 大不了不重試，事後手動傳。
       */
      blobs.delete(item.id)
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

  /** 第一步：告訴 YouTube 要傳什麼，拿回一個上傳網址。 */
  async function startUpload(accessToken: string, item: ClipUpload, blob: Blob): Promise<string> {
    const response = await fetch(UPLOAD_INIT_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
        'x-upload-content-type': blob.type,
        'x-upload-content-length': String(blob.size),
      },
      body: JSON.stringify({
        snippet: {
          title: options.title(item.inning, item.half),
          description: `第 ${item.inning} 局${HALF_LABELS[item.half]}`,
        },
        // 送 private 只是表明意圖 —— 未通過合規稽核的專案本來就強制私人
        status: { privacyStatus: 'private', selfDeclaredMadeForKids: false },
      }),
    })

    const location = response.headers.get('location')
    if (!response.ok) {
      /*
       * 把 YouTube 真正說的話帶出來。
       *
       * 只回一個狀態碼的話，使用者（和之後除錯的人）完全不知道是配額用完、
       * 權杖沒有上傳範圍、還是頻道沒驗證。這幾種的處理方式完全不同，
       * 而這是唯一會告訴你的地方。
       */
      const { reason, message } = await describeError(response)

      /*
       * YouTube 頻道有「每天可以上傳幾支」的額度，和 API 的配額是兩回事。
       * 撞到之後**當天剩下的每一段都會撞同一面牆** —— 所以要標記出來讓佇列
       * 停下，而不是讓七段各自失敗七次、跳七個看不懂的英文訊息。
       */
      if (reason === 'uploadLimitExceeded') {
        throw new UploadLimitError()
      }
      throw new Error(`YouTube 拒絕上傳（${response.status}）：${message}`)
    }
    if (!location) {
      throw new Error('YouTube 沒有回傳上傳位址')
    }
    return location
  }

  /**
   * 從 Google 的錯誤回應裡撈出原因與可讀訊息。
   *
   * `reason` 是機器判讀用的（例如 `uploadLimitExceeded`、`quotaExceeded`），
   * `message` 是給人看的。只回其中一個都不夠：前者沒法顯示，後者沒法分支。
   */
  async function describeError(response: Response): Promise<{ reason: string; message: string }> {
    try {
      const body = await response.json()
      return {
        reason: body?.error?.errors?.[0]?.reason ?? '',
        message: body?.error?.message ?? body?.error_description ?? '沒有說明',
      }
    } catch {
      return { reason: '', message: '沒有說明' }
    }
  }

  /**
   * 第二步：把位元組送上去。
   *
   * 用 `XMLHttpRequest` 而不是 `fetch` —— 只有它有 `upload.onprogress`。
   * 傳一段要好幾分鐘，沒有進度條的話使用者不知道是在傳還是卡住了。
   */
  function sendBytes(
    location: string,
    blob: Blob,
    onProgress: (percent: number) => void,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('PUT', location)
      xhr.setRequestHeader('content-type', blob.type)

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100))
      }

      xhr.onload = () => {
        if (xhr.status < 200 || xhr.status >= 300) {
          let detail: string
          try {
            detail = JSON.parse(xhr.responseText)?.error?.message ?? ''
          } catch {
            detail = xhr.responseText.slice(0, 120)
          }
          reject(new Error(`上傳失敗（${xhr.status}）${detail ? `：${detail}` : ''}`))
          return
        }
        try {
          const videoId = JSON.parse(xhr.responseText)?.id
          if (typeof videoId === 'string' && videoId) resolve(videoId)
          else reject(new Error('YouTube 沒有回傳影片 ID'))
        } catch {
          reject(new Error('無法解析 YouTube 的回應'))
        }
      }

      xhr.onerror = () => reject(new Error('網路中斷，這一段還沒上傳'))
      xhr.onabort = () => reject(new Error('上傳已取消'))
      xhr.send(blob)
    })
  }

  /** 重試某一段。失敗多半是球場的網路，重按一次通常就過了。 */
  function retry(id: string) {
    // 手動重試代表「我認為現在可以了」—— 把額度旗標放掉，讓佇列重新跑
    limitReached.value = false
    if (!blobs.has(id)) {
      // 理論上不會發生（失敗的 Blob 都留著），但如果真的發生了，
      // 要講出「請手動上傳」而不是讓按鈕按下去毫無反應
      patch(id, { error: '影片資料已釋放，請從裝置手動上傳這一段' })
      return false
    }
    patch(id, { state: 'waiting', error: '' })
    void drain()
    return true
  }

  /**
   * 離開頁面時把 Blob 全部放掉。
   *
   * 沒有這一段的話，失敗的片段會一直佔著記憶體直到分頁關閉 ——
   * 而管理者很可能只是切去看一下比賽頁再回來。
   */
  onBeforeUnmount(() => blobs.clear())

  return { queue, pending, failed, limitReached, enqueue, retry }
}
