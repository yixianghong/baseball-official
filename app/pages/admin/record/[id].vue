<script setup lang="ts">
import { clipFileName, formatDuration, nextHalf, resumePosition } from '~/utils/recording'
import { getClipStore, type ClipSession } from '~/utils/clip-store'
import type { ClipUpload } from '~/composables/useClipUpload'
import { battingSide, HALF_LABELS, type GameHalf } from '#shared/schemas/game'
import { formatBytes } from '~/utils/image'
import { formatGameDateLong } from '~/utils/format'

/**
 * 球場邊的錄影頁（階段 1，見 `docs/game-recording-plan.md`）。
 *
 * ## 為什麼是獨立路由、而且連 layout 都不掛
 * 這是在太陽底下、單手、戴著手套的旁邊操作的畫面。它需要的是深底、大按鈕、
 * 一眼看得到的狀態 —— 和後台那個有側欄、有四個分頁、密密麻麻的表單是兩種東西。
 * `layout: false` 而不是 `blank`：那個 layout 會再包一層淺色的滿版容器，
 * 對這一頁只是多一層要覆蓋掉的東西。
 * 放在 `/admin/record/` 底下也避開了與 `pages/admin/games/[id].vue` 的路由衝突。
 *
 * ## 只有一套版面：預覽滿寬、其餘捲動
 * 拍球場要的是最寬的畫面，所以人會把手機轉橫。預覽**永遠維持 16:9 並吃滿寬度**
 * —— 取景看得越大越準，不為了「塞進一屏」去壓縮它。
 *
 * 曾經為橫向做過第二套版面（預覽限高、標題與說明隱藏、局數與上下半併成一行），
 * 目的是「不用捲」。那個目標本身是錯的：為了省下捲動，取景畫面被壓到只剩
 * 三分之一屏高，而**取景正是這一頁唯一不能將就的東西**。現在橫向時整頁會
 * 超過一屏，讓使用者自己捲 —— 其餘資訊捲過去無所謂，真正不能捲掉的只有
 * 錄影鈕，所以**那一顆固定在螢幕底部**（`fixed`，不是 `sticky`，理由寫在那裡）。
 *
 * 少了一套版面也少了一整類只在特定視窗尺寸才出現的 bug（例如上傳錯誤清單
 * 曾經因為 `landscape:` 而在桌機上被整個藏起來）。
 *
 * 不能用程式鎖定方向：`screen.orientation.lock()` 要先進全螢幕，而 iPhone 對
 * 非 video 元素的 Fullscreen API 長期不支援。
 *
 * ## 高度用 `dvh`、左右要留安全區
 * 手機瀏覽器的 `100vh` 含**會收起的**工具列，跟著工具列跳動的底線沒得用。
 * 而橫向時瀏海吃的是**側邊**而不是下緣，所以這一頁三邊都要留
 * （`viewport-fit=cover` 已在 `nuxt.config.ts` 設好）：
 * 直向時 top 有值、左右是 0，橫向時剛好相反。
 *
 * ## 存檔與上傳是兩件事，而且順序不能反
 * 錄完**先存到裝置**，再丟進上傳佇列。反過來做的話，上傳失敗就等於那一段
 * 影片沒了 —— 而在球場的行動網路上，上傳失敗是常態而不是例外。
 * 先存檔之後，失敗的最壞情況只是「這一段還沒上去，事後手動傳」。
 *
 * 上傳是背景進行的（見 `useClipUpload`）：一段要傳 2～4 分鐘，而下一個
 * 半局馬上就要開始錄，不能讓人站在原地等。
 *
 * ## 存檔為什麼有兩條路
 * 和出賽名單圖卡同一個理由（見 `useShareRoster`）：iOS Safari 對大的 blob
 * 常常忽略 `download` 屬性，直接開在新分頁裡；而系統分享選單可以存進
 * 「照片」或「檔案」。所以優先用分享，沒有才退回下載。
 */
definePageMeta({ layout: false, middleware: 'auth' })

const route = useRoute()
const gameId = computed(() => String(route.params.id))

const { data: game, error: loadError } = await useGame(gameId)
const { data: settings } = await useSiteSettings()

const teamName = computed(() => settings.value?.teamName ?? '我隊')

const recorder = useGameRecorder()
const videoRef = ref<HTMLVideoElement | null>(null)

const uploads = useClipUpload({
  gameId: () => gameId.value,
  title: (n, h) =>
    `${game.value?.date ?? ''} ${teamName.value} vs ${game.value?.opponent ?? ''} 第${n}局${HALF_LABELS[h]}`,
})

/** 這一場預計幾局。乙組是七局，但延長賽會多打 —— 以計分板的實際局數為準。 */
const totalInnings = computed(() => Math.max(game.value?.scoreboard.innings.length ?? 7, 7))

/**
 * 已經上傳到網站的片段（比賽資料上的 `clips`）。
 *
 * 錄影頁原本完全不讀它，只看「這次打開頁面之後」的上傳佇列 —— 於是離開再
 * 回來，已經傳上去的片段在畫面上全部不見，局數也回到第 1 局上半，看起來就像
 * 錄影資料被清掉了。資料其實一直都在，只是這一頁沒去看。
 *
 * 這次重錄過的半局以佇列為準（下面的 `rows` 會把舊的那一筆藏起來）。
 */
const uploadedClips = computed(() => game.value?.clips ?? [])

const halfKey = (clip: { inning: number; half: GameHalf }) => `${clip.inning}-${clip.half}`

/** 現在要錄的是哪半局。錄完會自動往前推，見 `nextHalf()`。 */
const inning = ref(1)
const half = ref<GameHalf>('top')

/** 這半局誰在打擊。球場邊的人看的是場上，不會記得自己是主場還是客場。 */
const batting = computed(() => {
  if (!game.value) return ''
  const side = battingSide(half.value, game.value.homeAway)
  return side === 'our' ? teamName.value : game.value.opponent
})

const halfLabel = computed(() => `第 ${inning.value} 局${HALF_LABELS[half.value]}`)

const saveMessage = ref('')
const saving = ref(false)

/** 把串流接到 `<video>` 上。用 `srcObject` 而不是 blob URL —— 這是即時預覽。 */
watchEffect(() => {
  if (videoRef.value) videoRef.value.srcObject = recorder.stream.value
})

/**
 * 還留在裝置上、沒傳到 YouTube 的錄影。
 *
 * 片段在上傳成功之前都留在 IndexedDB（見 `app/utils/clip-store.ts`），
 * 所以**離開錄影頁、上傳失敗、頁面被 iOS 殺掉**，回來時都會在這裡。
 * 最後一種最常見：iOS 在記憶體吃緊時會直接殺掉網頁程序，主畫面 App 的
 * 表現就是「閃一下、重新載入、再要一次相機權限」。
 *
 * **不自動上傳。** 錄到一半的那一段只有中斷前的部分，而使用者很可能已經
 * 重錄了同一個半局 —— 自動傳上去的話，片段是以「第幾局的哪半局」為鍵覆蓋的，
 * 一段殘缺的影片就可能蓋掉完整的那一段。
 */
interface RecoveredClip {
  session: ClipSession
  blob: Blob
  confirmDiscard: boolean
}
const recovered = ref<RecoveredClip[]>([])

async function loadRecovered() {
  const store = getClipStore()
  try {
    const sessions = await store.list(gameId.value)
    const items: RecoveredClip[] = []
    for (const session of sessions) {
      const blob = await store.assemble(session.id)
      // 錄影一開始就被中斷、一塊都沒寫進去的，沒有東西可救
      if (!blob) {
        void store.remove(session.id).catch(() => {})
        continue
      }
      items.push({ session, blob, confirmDiscard: false })
    }
    recovered.value = items
  } catch (err) {
    // 讀不到暫存不影響錄影本身
    console.error('[record] 無法讀取暫存的錄影', err)
  } finally {
    // 暫存讀不到也要接回局數 —— 已上傳的片段在比賽資料裡，一定拿得到
    restorePosition()
  }
}

/** 接著錄哪一格：看已上傳、這次傳的、裝置上沒傳的三者的聯集。 */
function restorePosition() {
  if (recorder.recording.value) return
  const position = resumePosition(
    [
      ...uploadedClips.value.map((clip) => ({ ...clip, finished: true })),
      ...uploads.queue.value.map((item) => ({ ...item, finished: true })),
      ...recovered.value.map((item) => item.session),
    ],
    totalInnings.value,
  )
  if (!position) return
  inning.value = position.inning
  half.value = position.half
}

onMounted(async () => {
  void loadRecovered()
  await recorder.init()
})

function recoveredFileName(session: ClipSession) {
  return clipFileName({
    teamName: teamName.value,
    opponent: game.value?.opponent ?? '對手',
    date: game.value?.date ?? '',
    inning: session.inning,
    half: session.half,
    mimeType: session.mimeType,
  })
}

function uploadRecovered(item: RecoveredClip) {
  uploads.enqueue({
    inning: item.session.inning,
    half: item.session.half,
    blob: item.blob,
    sessionId: item.session.id,
  })
  recovered.value = recovered.value.filter((other) => other !== item)
}

async function saveRecovered(item: RecoveredClip) {
  await save(item.blob, recoveredFileName(item.session))
}

/** 兩段式：丟掉就真的沒了，而這個按鈕就在「上傳」旁邊。 */
async function discardRecovered(item: RecoveredClip) {
  if (!item.confirmDiscard) {
    item.confirmDiscard = true
    return
  }
  await getClipStore()
    .remove(item.session.id)
    .catch(() => {})
  recovered.value = recovered.value.filter((other) => other !== item)
}

function startRecording() {
  recorder.start({ gameId: gameId.value, inning: inning.value, half: half.value })
}

async function onCameraChange(deviceId: string) {
  if (recorder.recording.value) return
  await recorder.openCamera(deviceId)
}

async function finish() {
  const clip = await recorder.stop()
  if (!clip) {
    saveMessage.value = '這一段沒有錄到內容'
    return
  }

  const filename = clipFileName({
    teamName: teamName.value,
    opponent: game.value?.opponent ?? '對手',
    date: game.value?.date ?? '',
    inning: inning.value,
    half: half.value,
    mimeType: recorder.mimeType.value,
  })

  // ⚠️ 順序不能反：先存到裝置，再排進上傳佇列。
  // 反過來的話，上傳失敗就等於這一段沒了 —— 而球場的網路本來就不可靠。
  await save(clip.blob, filename)
  uploads.enqueue({
    inning: inning.value,
    half: half.value,
    blob: clip.blob,
    sessionId: clip.sessionId,
  })

  const next = nextHalf({ inning: inning.value, half: half.value }, totalInnings.value)
  inning.value = next.inning
  half.value = next.half
}

/**
 * 還有片段沒傳完就離開頁面 —— 攔一下。
 *
 * 影片本身已經存到裝置了，所以最壞情況不是「弄丟」而是「還沒上去」，
 * 但那仍然是使用者會想知道的事。
 */
onBeforeRouteLeave(() => {
  if (uploads.pending.value === 0) return true
  return confirm(
    `還有 ${uploads.pending.value} 段影片正在上傳，離開會中斷上傳。影片會留在這台裝置上，下次打開錄影頁可以再傳。確定要離開嗎？`,
  )
})

/** 優先走系統分享（iOS 才存得進「照片」），沒有才退回下載。 */
async function save(blob: Blob, filename: string) {
  saving.value = true
  saveMessage.value = ''

  try {
    const file = new File([blob], filename, { type: blob.type })

    // canShare 一定要帶 files 去問 —— 有些瀏覽器有 share 但不收檔案
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: filename })
        saveMessage.value = `已儲存 ${filename}`
        return
      } catch (err) {
        // 使用者按取消不是錯誤，但這一段影片還沒存到任何地方 —— 要講出來
        if (err instanceof DOMException && err.name === 'AbortError') {
          saveMessage.value = '已取消儲存，這一段影片還沒存檔'
          return
        }
        console.error('[record] 系統分享失敗', err)
      }
    }

    download(blob, filename)
    saveMessage.value = `已下載 ${filename}`
  } finally {
    saving.value = false
  }
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()

  /*
   * 影片檔比圖片大得多，立刻 `revokeObjectURL()` 會讓下載在開始之前就被中斷
   * （出賽名單圖卡那邊只有幾百 KB，所以同步撤銷沒事）。延後一分鐘再放掉，
   * 這段期間 blob 仍佔著記憶體，但總比檔案根本沒存下來好。
   */
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/**
 * 「這一場的錄影」清單：已上傳的 + 這次錄的，照比賽順序排。
 *
 * 同一個半局這次又錄了一段的話，只顯示這次的 —— 它上傳成功就會取代網站上
 * 那一段（片段以「第幾局的哪半局」為鍵覆蓋），兩筆並列只會讓人以為有兩段。
 */
type ClipRow =
  | { kind: 'uploaded'; key: string; inning: number; half: GameHalf; privacy: string }
  | { kind: 'queued'; key: string; inning: number; half: GameHalf; item: ClipUpload }

const rows = computed<ClipRow[]>(() => {
  const queued = new Set(uploads.queue.value.map(halfKey))
  const list: ClipRow[] = [
    ...uploadedClips.value
      .filter((clip) => !queued.has(halfKey(clip)))
      .map((clip) => ({
        kind: 'uploaded' as const,
        key: `uploaded-${clip.videoId}`,
        inning: clip.inning,
        half: clip.half,
        privacy: clip.privacy,
      })),
    ...uploads.queue.value.map((item) => ({
      kind: 'queued' as const,
      key: item.id,
      inning: item.inning,
      half: item.half,
      item,
    })),
  ]
  const order = (row: ClipRow) => row.inning * 2 + (row.half === 'bottom' ? 1 : 0)
  return list.sort((a, b) => order(a) - order(b))
})

/**
 * 已經錄過的半局，鍵是「局-上下」。局數與上下半按鈕靠它標示錄過了沒。
 *
 * 三個來源的聯集：已上傳、這次錄的、裝置上還沒傳的。只看其中一個的話，
 * 離開再回來之後按鈕上的「已錄」標示就全部消失了。
 */
const recordedHalves = computed(
  () =>
    new Set([
      ...uploadedClips.value.map(halfKey),
      ...uploads.queue.value.map(halfKey),
      ...recovered.value.map((item) => halfKey(item.session)),
    ]),
)

/** 兩個半局都錄完的局，整顆按鈕才算「完成」。 */
const completedInnings = computed(
  () =>
    new Set(
      Array.from({ length: totalInnings.value }, (_, i) => i + 1).filter(
        (n) => recordedHalves.value.has(`${n}-top`) && recordedHalves.value.has(`${n}-bottom`),
      ),
    ),
)

useHead({ title: () => (game.value ? `錄影：vs ${game.value.opponent}` : '錄影') })
</script>

<template>
  <div
    class="min-h-dvh bg-ink-deep text-white"
    style="
      padding-top: env(safe-area-inset-top);
      padding-left: env(safe-area-inset-left);
      padding-right: env(safe-area-inset-right);
    "
  >
    <UiBaseEmpty v-if="loadError" title="找不到這場比賽" icon="🔍" class="px-4 py-10">
      <UiBaseButton variant="secondary" @click="navigateTo('/admin/games')">
        回到賽事列表
      </UiBaseButton>
    </UiBaseEmpty>

    <!--
      一律由上往下堆、頁面可以捲。底部的 `pb-32` 是留給固定在螢幕底部的
      錄影鈕的空間 —— 少了它，最後一段內容會永遠被那顆按鈕蓋住。
    -->
    <div v-else-if="game" class="flex flex-col gap-4 pt-5 pb-32">
      <!-- ══ 不支援：橫向直向都一樣，佔滿就好 ══════════════════ -->
      <div
        v-if="!recorder.supported.value"
        class="mx-auto w-full max-w-2xl rounded-xl border border-warning/40 bg-warning/10 p-4 text-fluid-sm"
      >
        <p class="font-semibold">這個裝置不能在瀏覽器裡錄影</p>
        <p class="mt-1 text-white/70">
          {{ recorder.error.value || '請改用手機版 Safari 或 Chrome，並確認網址是 https。' }}
        </p>
      </div>

      <template v-else>
        <!-- ══ 預覽 ════════════════════════════════════════════ -->
        <!--
          滿版：它**放在寬度容器外面**，所以自然貼齊視窗兩側。
          不要改用負 margin 把它從容器裡撐出去 —— 那需要 `100vw`，
          而 `100vw` 含垂直捲軸的寬度，結果會橫向溢出十幾像素
          （`CommonPageHero` 的註解記過這件事）。

          取景看得越大越準，所以高度完全跟著 16:9 走、不設上限。
          代價是橫向時整頁會超過一屏 —— 那沒關係，能捲，而真正不能捲掉的
          只有錄影鈕，它是固定在底部的。
        -->
        <div class="shrink-0">
          <div class="relative aspect-video w-full overflow-hidden bg-black">
            <!-- muted 不能省：沒有它 autoplay 會被瀏覽器擋下，而且會產生回授嘯叫 -->
            <video ref="videoRef" class="size-full object-cover" autoplay muted playsinline />

            <!--
              權限對話框開著的時候 getUserMedia 會一直 pending，這一塊沒有的話
              畫面上就只是一片黑，看起來像壞掉了
            -->
            <div
              v-if="recorder.initializing.value"
              class="absolute inset-0 flex flex-col items-center justify-center gap-2 text-fluid-sm text-white/70"
            >
              <UiBaseSpinner />
              <p>正在要求相機權限…</p>
              <p class="text-xs">請在跳出的視窗按「允許」</p>
            </div>

            <div
              v-else-if="recorder.recording.value"
              class="absolute top-3 left-3 flex items-center gap-2 rounded-full bg-danger px-3 py-1 text-fluid-sm font-bold"
            >
              <span class="size-2 rounded-full bg-white motion-safe:animate-pulse" />
              REC
              <span class="tabular-nums">{{ formatDuration(recorder.elapsedSeconds.value) }}</span>
            </div>

            <!--
              解析度留著（不是警告，是給人核對「真的拿到 1920×1080 嗎」）。
              方向本身不再提示 —— 轉動裝置會自動重新取得串流並修正方向，
              見 `useGameRecorder` 的 `onOrientationChange`。
            -->
            <p
              v-if="recorder.resolution.value"
              class="absolute right-3 bottom-3 rounded bg-black/60 px-2 py-0.5 text-xs tabular-nums"
            >
              {{ recorder.resolution.value }}
            </p>
          </div>
        </div>

        <!-- ══ 控制項（捲動區）══════════════════════════════════ -->
        <div class="mx-auto flex w-full max-w-2xl flex-col gap-3 px-4">
          <!--
            控制項可以捲，但錄影鈕在捲動區外面 —— 端著手機對準球場的人
            不可能一邊捲頁面一邊找按鈕。
          -->
          <div class="space-y-3">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <h1 class="truncate text-fluid-lg font-bold">
                  {{ teamName }} vs {{ game.opponent }}
                </h1>
                <p class="text-fluid-sm text-white/60">
                  {{ formatGameDateLong(game.date) }}
                </p>
              </div>
              <!--
                回「賽事管理」那個分頁，不是回比賽頁的第一個分頁 ——
                剛錄完的片段就列在那裡，上傳失敗的要在那裡補登網址。
              -->
              <NuxtLink
                :to="`/admin/games/${game.id}?tab=result`"
                class="shrink-0 text-fluid-sm text-white/60 underline underline-offset-4"
              >
                離開
              </NuxtLink>
            </div>

            <p v-if="recorder.error.value" class="text-fluid-sm text-warning">
              {{ recorder.error.value }}
            </p>
            <p v-if="recorder.storageWarning.value" class="text-fluid-sm text-warning">
              {{ recorder.storageWarning.value }}
            </p>

            <div>
              <label for="camera" class="mb-1 block text-fluid-sm text-white/70">鏡頭</label>
              <select
                id="camera"
                :value="recorder.selectedCameraId.value"
                :disabled="recorder.recording.value"
                class="min-h-12 w-full rounded-xl border border-white/20 bg-white/10 px-3 text-white disabled:opacity-50"
                @change="onCameraChange(($event.target as HTMLSelectElement).value)"
              >
                <option
                  v-for="camera in recorder.cameras.value"
                  :key="camera.deviceId"
                  :value="camera.deviceId"
                  class="text-ink"
                >
                  {{ camera.label }}{{ camera.isUltraWide ? '（超廣角）' : '' }}
                </option>
              </select>
              <!-- deviceId 每次都會變，所以不能記住上次的選擇，要講清楚 -->
              <p class="mt-1 text-xs text-white/50">每次開啟都要重新挑一次，系統不會記住。</p>
            </div>

            <!--
              局數與上下半分兩排。以前橫向時會併成一行（那時整頁不能捲，
              分兩排上下半會被擠出畫面），現在頁面本來就可以捲，
              擠成一行只是讓每一顆都更難按。
            -->
            <div class="space-y-3">
              <div>
                <span class="mb-1 block text-fluid-sm text-white/70">這一段是第幾局</span>
                <div class="flex flex-wrap gap-2">
                  <button
                    v-for="n in totalInnings"
                    :key="n"
                    type="button"
                    :disabled="recorder.recording.value"
                    class="min-h-11 min-w-11 flex-1 rounded-xl border px-3 font-bold tabular-nums transition disabled:opacity-40"
                    :class="
                      inning === n
                        ? 'border-accent-400 bg-accent-500 text-ink-deep'
                        : completedInnings.has(n)
                          ? 'border-white/20 bg-white/15 text-white/60'
                          : 'border-white/20 text-white'
                    "
                    @click="inning = n"
                  >
                    {{ n }}
                  </button>
                </div>
              </div>

              <div>
                <span class="mb-1 block text-fluid-sm text-white/70">上半還是下半</span>
                <div class="grid grid-cols-2 gap-2">
                  <!--
                    只有兩個選項，所以做成兩顆大按鈕而不是下拉 —— 這是戴著手套、
                    單手、在太陽底下要按的東西。錄完會自動跳到下一半局，
                    正常情況下整場都不必碰它。
                  -->
                  <button
                    v-for="option in ['top', 'bottom'] as const"
                    :key="option"
                    type="button"
                    :disabled="recorder.recording.value"
                    class="min-h-12 rounded-xl border font-bold transition disabled:opacity-40"
                    :class="
                      half === option
                        ? 'border-accent-400 bg-accent-500 text-ink-deep'
                        : recordedHalves.has(`${inning}-${option}`)
                          ? 'border-white/20 bg-white/15 text-white/60'
                          : 'border-white/20 text-white'
                    "
                    @click="half = option"
                  >
                    {{ HALF_LABELS[option] }}半局
                  </button>
                </div>
                <!-- 客隊先攻，所以上半局是客隊打擊。場邊的人看的是場上不是設定 -->
                <p v-if="batting" class="mt-1 text-xs text-white/50">
                  {{ halfLabel }}：{{ batting }} 進攻
                </p>
              </div>
            </div>

            <!-- ══ 還沒上傳的錄影 ══════════════════════════════
              還留在裝置上、沒傳到 YouTube 的片段。放在最前面：它們是唯一
              「不處理就可能永遠不見」的東西。
            -->
            <div
              v-if="recovered.length"
              class="rounded-xl border border-warning/40 bg-warning/10 p-3"
            >
              <h2 class="text-fluid-sm font-semibold text-warning">還沒上傳的錄影</h2>
              <p class="mt-1 text-xs text-white/70">
                這些還在這台裝置上、沒傳到
                YouTube（離開錄影頁、上傳失敗或頁面被系統中斷都會留在這裡）。
                上傳會取代網站上同一個半局的影片。
              </p>
              <ul class="mt-2 space-y-1.5">
                <li
                  v-for="item in recovered"
                  :key="item.session.id"
                  class="rounded-lg bg-white/10 px-3 py-2 text-fluid-sm"
                >
                  <div class="flex items-center justify-between gap-3">
                    <span class="font-bold">
                      第 {{ item.session.inning }} 局{{ HALF_LABELS[item.session.half] }}
                    </span>
                    <span class="tabular-nums text-white/70">{{
                      formatBytes(item.blob.size)
                    }}</span>
                  </div>
                  <p class="mt-0.5 text-xs text-white/50">
                    {{
                      item.session.finished
                        ? '已錄完，還沒上傳'
                        : '錄到一半被中斷，只有中斷前的部分'
                    }}
                  </p>
                  <div class="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      class="min-h-9 rounded-lg bg-white/15 px-3 text-xs font-medium transition hover:bg-white/25"
                      @click="uploadRecovered(item)"
                    >
                      上傳
                    </button>
                    <button
                      type="button"
                      class="min-h-9 rounded-lg bg-white/15 px-3 text-xs font-medium transition hover:bg-white/25"
                      :disabled="saving"
                      @click="saveRecovered(item)"
                    >
                      存到裝置
                    </button>
                    <button
                      type="button"
                      class="min-h-9 rounded-lg px-3 text-xs font-medium text-warning transition hover:bg-white/10"
                      @click="discardRecovered(item)"
                    >
                      {{ item.confirmDiscard ? '確定丟棄？' : '丟棄' }}
                    </button>
                  </div>
                </li>
              </ul>
            </div>

            <!-- ══ 這一場的錄影 ══════════════════════════════
              已經上傳到網站的 + 這次錄的，照比賽順序。已上傳的來自比賽資料，
              所以離開錄影頁再回來也還在（原本只看這次的上傳佇列，一離開就全不見）。
            -->
            <div v-if="rows.length">
              <h2 class="mb-2 text-fluid-sm font-semibold text-white/70">這一場的錄影</h2>
              <ul class="space-y-1.5">
                <li
                  v-for="row in rows"
                  :key="row.key"
                  class="rounded-lg bg-white/10 px-3 py-2 text-fluid-sm"
                >
                  <div class="flex items-center justify-between gap-3">
                    <span class="font-bold">第 {{ row.inning }} 局{{ HALF_LABELS[row.half] }}</span>
                    <span v-if="row.kind === 'queued'" class="tabular-nums text-white/70">
                      {{ formatBytes(row.item.bytes) }}
                    </span>
                  </div>

                  <!-- 之前就傳上去的：前台看不看得到取決於可見度 -->
                  <p v-if="row.kind === 'uploaded'" class="mt-1 text-xs">
                    <span class="text-success">✓ 已上傳</span>
                    <span class="text-white/50">
                      ・{{
                        row.privacy === 'private'
                          ? '私人（前台看不到）'
                          : row.privacy === 'public'
                            ? '公開'
                            : '不公開'
                      }}
                    </span>
                  </p>

                  <template v-else>
                    <div class="mt-1 flex items-center justify-between gap-3 text-xs">
                      <span v-if="row.item.state === 'done'" class="text-success">✓ 已上傳</span>
                      <span v-else-if="row.item.state === 'uploading'" class="text-white/70">
                        上傳中 {{ row.item.progress }}%
                      </span>
                      <span v-else-if="row.item.state === 'waiting'" class="text-white/50">
                        等待上傳
                      </span>
                      <span v-else class="text-warning">{{ row.item.error }}</span>

                      <button
                        v-if="row.item.state === 'failed'"
                        type="button"
                        class="shrink-0 underline underline-offset-4"
                        @click="uploads.retry(row.item.id)"
                      >
                        重試
                      </button>
                    </div>

                    <!-- 進度條。傳一段要好幾分鐘，沒有它會以為卡住了 -->
                    <div
                      v-if="row.item.state === 'uploading'"
                      class="mt-1.5 h-1 overflow-hidden rounded-full bg-white/15"
                    >
                      <div
                        class="h-full bg-brand-500 transition-all"
                        :style="{ width: `${row.item.progress}%` }"
                      />
                    </div>
                  </template>
                </li>
              </ul>
              <!-- 撞到當天額度是「整批停下」，要一次講清楚而不是每段各喊一次 -->
              <p
                v-if="uploads.limitReached.value"
                class="mt-2 rounded-lg bg-warning/15 px-3 py-2 text-xs text-warning"
              >
                已達 YouTube 今日的上傳數量上限，剩下的片段暫停上傳。影片都還在這台裝置上 ——
                明天再按重試，或自己傳上 YouTube 後到後台的「賽事錄影」貼網址補登。
              </p>
              <p v-else-if="uploads.queue.value.length" class="mt-2 text-xs text-white/50">
                每一段都已經存到這台裝置，上傳失敗也不會弄丟 —— 事後手動傳就好。
              </p>
            </div>
          </div>

          <!--
            ══ 錄影鈕 ══
            整頁可以捲動，但這一顆**固定在螢幕底部**。端著手機對準球場的人
            不可能一邊捲頁面一邊找「結束」—— 其餘資訊捲過去無所謂，這顆不行。

            ⚠️ 用 `fixed` 而不是 `sticky`：sticky 不會把元素拉出它的容器範圍，
            而這顆按鈕本來就在文件末端，所以 `sticky bottom-0` 在捲到底之前
            完全沒有作用（看起來像沒生效，其實是規格如此）。
          -->
          <div
            class="fixed inset-x-0 bottom-0 z-20 border-t border-white/10 bg-ink-deep/95 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur"
          >
            <div class="mx-auto w-full max-w-2xl space-y-2 px-4">
              <UiBaseButton
                v-if="!recorder.recording.value"
                class="min-h-14 w-full text-fluid-lg"
                :disabled="!recorder.stream.value || saving || recorder.initializing.value"
                @click="startRecording"
              >
                開始錄{{ halfLabel }}
              </UiBaseButton>
              <UiBaseButton
                v-else
                variant="secondary"
                class="min-h-14 w-full text-fluid-lg"
                :loading="saving"
                @click="finish"
              >
                結束並儲存
              </UiBaseButton>

              <p v-if="recorder.recording.value" class="text-center text-fluid-sm text-warning">
                ⚠️ 請勿切換 App 或鎖定螢幕
              </p>

              <p v-if="saveMessage" class="truncate text-center text-fluid-sm">{{ saveMessage }}</p>
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
