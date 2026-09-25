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
 * ## 橫向是主要的使用姿勢
 * 拍球場要的是最寬的畫面，所以人會把手機轉橫。但橫向的可用高度只有 320px 上下
 * （iPhone 橫向 390 再扣掉 Safari 的上下列），而直向的版面疊起來有 855px ——
 * 照搬過去的話錄影鈕會在畫面外 400 多 px，你得一邊端著手機對準球場一邊捲頁面。
 * 所以橫向是**另一套版面**（`field-mode:` variant）：預覽與控制項仍然是上下
 * 排列（和直向一致，不左右並排），但預覽改用 `42dvh` 的高度上限收斂 ——
 * 橫向若讓它吃滿寬度，16:9 會算出比整個視窗還高的高度。
 * 剩下的高度給控制項，而**錄影鈕永遠不參與捲動**。
 *
 * 不能用程式鎖定方向：`screen.orientation.lock()` 要先進全螢幕，而 iPhone 對
 * 非 video 元素的 Fullscreen API 長期不支援。只能用 CSS 回應，並在直向時提示。
 *
 * ## 高度用 `dvh`、左右要留安全區
 * 手機瀏覽器的 `100vh` 含**會收起的**工具列，橫向本來就只有 320px 上下，
 * 再跟著工具列跳動就沒得用了。而橫向時瀏海吃的是**側邊**而不是下緣，
 * 所以這一頁三邊都要留（`viewport-fit=cover` 已在 `nuxt.config.ts` 設好）：
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
/** 最近一則上傳失敗的原因。球場模式只擺得下一行，那就擺最要緊的那一行。 */
const firstUploadError = computed(
  () => uploads.queue.value.find((item) => item.state === 'failed')?.error ?? '',
)

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
      直向：由上往下堆，頁面可以捲。
      橫向：鎖成一個滿高的兩欄，左邊預覽、右邊控制，整頁不捲。
    -->
    <div
      v-else-if="game"
      class="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-5 field-mode:h-dvh field-mode:max-w-none field-mode:gap-2 field-mode:px-3 field-mode:py-2"
    >
      <!-- ══ 不支援：橫向直向都一樣，佔滿就好 ══════════════════ -->
      <div
        v-if="!recorder.supported.value"
        class="rounded-xl border border-warning/40 bg-warning/10 p-4 text-fluid-sm field-mode:flex-1"
      >
        <p class="font-semibold">這個裝置不能在瀏覽器裡錄影</p>
        <p class="mt-1 text-white/70">
          {{ recorder.error.value || '請改用手機版 Safari 或 Chrome，並確認網址是 https。' }}
        </p>
      </div>

      <template v-else>
        <!-- ══ 預覽 ════════════════════════════════════════════ -->
        <!--
          滿版：用負 margin 抵銷容器的左右內距，讓畫面貼齊螢幕兩側。
          取景的時候看得越大越準，而這一頁上沒有別的東西需要跟它對齊。
        -->
        <div class="-mx-4 shrink-0 field-mode:-mx-3">
          <!--
            直向靠 16:9 決定高度；橫向改成固定高度 —— 844px 寬的 16:9 會算出
            475px 高，比整個視窗還高。`object-cover` 會把超出的部分裁掉，
            所以橫向看到的範圍比實際錄到的窄一點。
          -->
          <div
            class="relative aspect-video w-full overflow-hidden bg-black field-mode:aspect-auto field-mode:h-[38dvh]"
          >
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
              ⚠️ 錄出來是直的。

              這和畫面方向是兩回事 —— 預覽可能看起來好好的，但存下來的檔案是
              1080×1920。在球場上完全看不出來，回家打開才發現一整場都是直的，
              所以這個警告要壓在畫面上、用紅底，不能只是一行小字。
            -->
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

        <!-- ══ 右：控制項 ══════════════════════════════════════ -->
        <div class="flex min-h-0 flex-col gap-3 field-mode:flex-1 field-mode:gap-2">
          <!--
            控制項可以捲，但錄影鈕在捲動區外面 —— 端著手機對準球場的人
            不可能一邊捲頁面一邊找按鈕。
          -->
          <div class="min-h-0 flex-1 space-y-3 field-mode:overflow-y-auto">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <h1 class="truncate text-fluid-lg font-bold field-mode:text-fluid-sm">
                  {{ teamName }} vs {{ game.opponent }}
                </h1>
                <p class="text-fluid-sm text-white/60 field-mode:hidden">
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
              <label for="camera" class="mb-1 block text-fluid-sm text-white/70 field-mode:hidden"
                >鏡頭</label
              >
              <select
                id="camera"
                :value="recorder.selectedCameraId.value"
                :disabled="recorder.recording.value"
                class="min-h-12 w-full rounded-xl border border-white/20 bg-white/10 px-3 text-white disabled:opacity-50 field-mode:min-h-10 field-mode:text-fluid-sm"
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
              <p class="mt-1 text-xs text-white/50 field-mode:hidden">
                每次開啟都要重新挑一次，系統不會記住。
              </p>
            </div>

            <!--
              球場模式把局數與上下半併成一行。
              橫向有的是寬度、缺的是高度 —— 分成兩排的話上下半會被擠出畫面，
              而那正是每半局都要確認一次的東西。
            -->
            <div
              class="space-y-3 field-mode:flex field-mode:items-start field-mode:gap-2 field-mode:space-y-0"
            >
              <div class="field-mode:min-w-0 field-mode:flex-1">
                <span class="mb-1 block text-fluid-sm text-white/70 field-mode:hidden"
                  >這一段是第幾局</span
                >
                <div class="flex flex-wrap gap-2">
                  <button
                    v-for="n in totalInnings"
                    :key="n"
                    type="button"
                    :disabled="recorder.recording.value"
                    class="min-h-11 min-w-11 flex-1 rounded-xl border px-3 font-bold tabular-nums transition disabled:opacity-40 field-mode:min-h-9 field-mode:min-w-9 field-mode:px-2"
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

              <div class="field-mode:min-w-0 field-mode:flex-1">
                <span class="mb-1 block text-fluid-sm text-white/70 field-mode:hidden"
                  >上半還是下半</span
                >
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
                    class="min-h-12 rounded-xl border font-bold transition disabled:opacity-40 field-mode:min-h-9 field-mode:text-fluid-sm"
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
            <div v-if="uploads.queue.value.length" class="field-mode:hidden">
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
              <p class="mt-2 text-xs text-white/50">
                每一段都已經存到這台裝置，上傳失敗也不會弄丟 —— 事後手動傳就好。
              </p>
            </div>
          </div>

          <!-- ══ 錄影鈕：永遠看得到，不參與捲動 ══════════════════ -->
          <div class="shrink-0 space-y-2">
            <UiBaseButton
              v-if="!recorder.recording.value"
              class="min-h-14 w-full text-fluid-lg field-mode:min-h-12"
              :disabled="!recorder.stream.value || saving || recorder.initializing.value"
              @click="recorder.start()"
            >
              開始錄{{ halfLabel }}
            </UiBaseButton>
            <UiBaseButton
              v-else
              variant="secondary"
              class="min-h-14 w-full text-fluid-lg field-mode:min-h-12"
              :loading="saving"
              @click="finish"
            >
              結束並儲存
            </UiBaseButton>

            <p v-if="recorder.recording.value" class="text-center text-fluid-sm text-warning">
              ⚠️ 請勿切換 App 或鎖定螢幕
            </p>

            <!-- 球場模式沒空間列完整清單，收成一兩行 -->
            <div v-else-if="uploads.queue.value.length" class="hidden text-center field-mode:block">
              <p class="text-xs" :class="uploads.failed.value ? 'text-warning' : 'text-white/50'">
                已錄 {{ uploads.queue.value.length }} 段<template v-if="uploads.pending.value">
                  ・上傳中 {{ uploads.pending.value }}</template
                ><template v-if="uploads.failed.value"
                  >・{{ uploads.failed.value }} 段失敗</template
                >
              </p>
              <!--
                失敗時把原因也帶出來。只有計數的話，人在球場上會知道
                「壞了」卻不知道是網路斷了還是設定沒做 —— 而這兩件事
                一個當下重試就好、一個再試幾次也沒用。
              -->
              <p v-if="firstUploadError" class="truncate text-xs text-warning">
                {{ firstUploadError }}
              </p>
            </div>

            <p v-if="saveMessage" class="truncate text-center text-fluid-sm">{{ saveMessage }}</p>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
