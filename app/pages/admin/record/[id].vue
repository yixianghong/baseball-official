<script setup lang="ts">
import { clipFileName, formatDuration, nextHalf } from '~/utils/recording'
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

onMounted(async () => {
  await recorder.init()
})

async function onCameraChange(deviceId: string) {
  if (recorder.recording.value) return
  await recorder.openCamera(deviceId)
}

async function finish() {
  const blob = await recorder.stop()
  if (!blob) {
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
  await save(blob, filename)
  uploads.enqueue({ inning: inning.value, half: half.value, blob })

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
  return confirm(`還有 ${uploads.pending.value} 段影片正在上傳，離開會中斷。確定要離開嗎？`)
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
 * 已經錄過的半局，鍵是「局-上下」。局數與上下半按鈕靠它標示錄過了沒。
 *
 * 直接從上傳佇列推導，不另外維護一份清單 —— 每一段錄完都一定會進佇列
 * （上傳失敗的也在裡面，狀態是 `failed`），所以它就是「這一輪錄了什麼」的
 * 完整紀錄。兩份平行的清單遲早會對不上。
 */
const recordedHalves = computed(
  () => new Set(uploads.queue.value.map((item) => `${item.inning}-${item.half}`)),
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
              <NuxtLink
                :to="`/admin/games/${game.id}`"
                class="shrink-0 text-fluid-sm text-white/60 underline underline-offset-4"
              >
                離開
              </NuxtLink>
            </div>

            <p v-if="recorder.error.value" class="text-fluid-sm text-warning">
              {{ recorder.error.value }}
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

            <!-- ══ 已錄片段與上傳狀態 ══════════════════════════ -->
            <div v-if="uploads.queue.value.length">
              <h2 class="mb-2 text-fluid-sm font-semibold text-white/70">這一輪已錄</h2>
              <ul class="space-y-1.5">
                <li
                  v-for="item in uploads.queue.value"
                  :key="item.id"
                  class="rounded-lg bg-white/10 px-3 py-2 text-fluid-sm"
                >
                  <div class="flex items-center justify-between gap-3">
                    <span class="font-bold">
                      第 {{ item.inning }} 局{{ HALF_LABELS[item.half] }}
                    </span>
                    <span class="tabular-nums text-white/70">{{ formatBytes(item.bytes) }}</span>
                  </div>

                  <div class="mt-1 flex items-center justify-between gap-3 text-xs">
                    <span v-if="item.state === 'done'" class="text-success">✓ 已上傳</span>
                    <span v-else-if="item.state === 'uploading'" class="text-white/70">
                      上傳中 {{ item.progress }}%
                    </span>
                    <span v-else-if="item.state === 'waiting'" class="text-white/50">等待上傳</span>
                    <span v-else class="text-warning">{{ item.error }}</span>

                    <button
                      v-if="item.state === 'failed'"
                      type="button"
                      class="shrink-0 underline underline-offset-4"
                      @click="uploads.retry(item.id)"
                    >
                      重試
                    </button>
                  </div>

                  <!-- 進度條。傳一段要好幾分鐘，沒有它會以為卡住了 -->
                  <div
                    v-if="item.state === 'uploading'"
                    class="mt-1.5 h-1 overflow-hidden rounded-full bg-white/15"
                  >
                    <div
                      class="h-full bg-brand-500 transition-all"
                      :style="{ width: `${item.progress}%` }"
                    />
                  </div>
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
              <p v-else class="mt-2 text-xs text-white/50">
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
                @click="recorder.start()"
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
