<script setup lang="ts">
import type {
  AttendanceEntry,
  GameStatus,
  LineupEntry,
  PitcherEntry,
  Scoreboard,
} from '#shared/schemas/game'
import {
  emptyScoreboard,
  GAME_EXCEPTION_STATUSES,
  GAME_FLOW_STATUSES,
  GAME_RESULT_LABELS,
  GAME_STATUS_LABELS,
  gameResult,
  HALF_LABELS,
  isGoogleMapsUrl,
  withSummedRuns,
} from '#shared/schemas/game'
import { teamNameCandidates } from '#shared/schemas/settings'
import { TAIWAN_CITIES, type TaiwanCity } from '#shared/schemas/weather'
import { formatGameDateLong } from '~/utils/format'

/**
 * 編輯比賽。
 *
 * ## 為什麼分成四個分頁、各自儲存
 * 一場比賽的資料有四組彼此獨立的東西：基本資料、出席、打線、計分板。
 * 分頁之後每次儲存只送自己那一組欄位（PATCH），所以：
 * - 編輯打線時不會覆蓋掉別人剛更新的出席名單
 * - 表單短、可以馬上儲存，不必為了改一個時間而捲過整個計分板
 *
 * ## 出席與打線在哪個分頁看得到
 * 未開打的比賽前台顯示「出席＋先發陣容」，開打之後顯示「打線＋計分板」。
 * 後台四個分頁一律都在 —— 比賽結束後仍可能要回頭補出席紀錄。
 *
 * ## 「賽事管理」分頁
 * 賽事狀態與計分板放在同一個分頁，因為它們是同一件事的兩面：比賽開打時
 * 按「比賽中」並開始填分，打完按「比賽結束」。狀態原本擺在「基本資料」
 * 裡當成一個下拉選單，但那是比賽當天最常按的東西，不該和場地、地圖連結
 * 這些建檔一次就不再碰的欄位放在一起。
 */
definePageMeta({ layout: 'admin', middleware: 'auth' })

const route = useRoute()
const gameId = computed(() => String(route.params.id))

const { data: game, error } = await useGame(gameId)
const { data: players } = await usePlayers()
const { data: settings } = await useSiteSettings()
const { updateGame, refreshClips, removeClip } = useGameActions()

const teamName = computed(() => settings.value?.teamName ?? '我隊')
const teamNames = computed(() => (settings.value ? teamNameCandidates(settings.value) : []))
const roster = computed(() => players.value ?? [])

const tabs = [
  { key: 'basic', label: '基本資料' },
  { key: 'attendance', label: '出席統計' },
  { key: 'lineup', label: '打線' },
  { key: 'result', label: '賽事管理' },
] as const
const activeTab = ref<(typeof tabs)[number]['key']>('basic')

// ── 各分頁的表單狀態 ────────────────────────────────────────────
const basic = reactive({
  date: '',
  time: '',
  opponent: '',
  venue: '',
  mapUrl: '',
  city: '' as TaiwanCity | '',
  league: '',
  homeAway: 'home' as 'home' | 'away',
  status: 'scheduled' as GameStatus,
  note: '',
  coverImageUrl: '',
  opponentLogoUrl: '',
})

/**
 * 地圖連結的即時驗證。
 *
 * 真正的防線在 BFF 的 schema，這裡是為了**當下就講**。這一頁是自動儲存的，
 * 沒有送出按鈕 —— 等伺服器回 400 才顯示錯誤的話，使用者看到的會是狀態列
 * 一句「儲存失敗」，而不知道是哪個欄位、為什麼。
 */
const mapUrlError = computed(() =>
  basic.mapUrl && !isGoogleMapsUrl(basic.mapUrl)
    ? '請貼 Google 地圖的連結（maps.app.goo.gl 或 google.com/maps）'
    : '',
)

const attendance = ref<AttendanceEntry[]>([])
const lineup = ref<LineupEntry[]>([])
const pitchers = ref<PitcherEntry[]>([])
const scoreboard = ref<Scoreboard>(emptyScoreboard(0))

/**
 * 計分板，R 一律對齊逐局加總（見 `withSummedRuns()`）。
 *
 * 判定結果與比數都看它，而不是直接看 `scoreboard.value.totals` —— 載入的資料
 * 如果是這條規則之前寫進去的，那個 R 可能停在別的數字。
 */
const board = computed(() => withSummedRuns(scoreboard.value))

/**
 * 表單的完整內容。
 *
 * 自動儲存時整份送出（PATCH），而不是每個分頁各送各的欄位 —— 單一使用者
 * 在單一頁面編輯，沒有互相覆蓋的問題，而一份 payload 換來的是一個 timer、
 * 一個狀態指示、一套錯誤處理。
 */
const formState = computed(() => ({
  ...basic,
  attendance: attendance.value,
  lineup: lineup.value,
  pitchers: pitchers.value,
  scoreboard: board.value,
}))

/** 把伺服器資料灌進表單。載入完成時執行一次。 */
function syncFromGame() {
  const current = game.value
  if (!current) return

  Object.assign(basic, {
    date: current.date,
    time: current.time,
    opponent: current.opponent,
    venue: current.venue,
    mapUrl: current.mapUrl,
    city: current.city,
    league: current.league,
    homeAway: current.homeAway,
    status: current.status,
    note: current.note,
    coverImageUrl: current.coverImageUrl,
    opponentLogoUrl: current.opponentLogoUrl,
  })

  attendance.value = [...current.attendance]
  lineup.value = [...current.lineup]
  pitchers.value = [...current.pitchers]
  scoreboard.value = structuredClone(toRaw(current.scoreboard))
}

const autosave = useAutosave(
  () => formState.value,
  (payload) => updateGame(gameId.value, payload),
)

watch(
  game,
  () => {
    syncFromGame()
    // 灌完資料立刻標記為「已儲存」，否則光是打開頁面就會寫一次資料庫
    autosave.markAsSaved()
  },
  { immediate: true },
)

/**
 * 目前的判定結果。
 *
 * **沒有手動覆寫的選項。** 勝敗完全由「狀態」與「計分板總分」決定，所以這裡
 * 顯示的就是前台會顯示的那一個（同一支 `gameResult()`）—— 後台看到「勝」，
 * 前台就不可能是「敗」。
 *
 * 曾經有一個可以手選的下拉選單，實際發生的事是：改完計分板忘了回頭改它，
 * 於是前台出現「6:3」配上一個「敗」。要讓結果不一樣，就去改計分板。
 */
const result = computed(() => gameResult({ status: basic.status, scoreboard: board.value }))

/**
 * 狀態按鈕的外觀。
 *
 * 「比賽中」用紅色，和前台的 LIVE 標籤是同一個顏色 —— 這顆按鈕按下去，
 * 官網首頁就會變成紅色的即時比數，按鈕本身要先說出這件事。
 */
function statusButtonClass(status: GameStatus): string {
  if (basic.status !== status) return 'border-border text-content-muted hover:bg-surface-muted'
  if (status === 'live') return 'border-danger bg-danger text-white'
  if (status === 'postponed' || status === 'canceled') return 'border-warning bg-warning text-white'
  return 'border-brand-600 bg-brand-600 text-white'
}

function addPitcher() {
  pitchers.value = [
    ...pitchers.value,
    { playerId: '', name: '', number: '', role: 'starter', note: '' },
  ]
}

function updatePitcher(index: number, patch: Partial<PitcherEntry>) {
  const next = [...pitchers.value]
  const entry = next[index]
  if (!entry) return
  next[index] = { ...entry, ...patch }
  pitchers.value = next
}

function onPitcherPlayerChange(index: number, playerId: string) {
  const player = roster.value.find((item) => item.id === playerId)
  updatePitcher(
    index,
    player ? { playerId: player.id, name: player.name, number: player.number } : { playerId: '' },
  )
}

/**
 * 先發投手，做成「先發陣容」分頁上的一個欄位。
 *
 * 它實際上編輯的就是 `pitchers` 裡 `role: 'starter'` 的那一筆 —— 和「賽事管理」
 * 分頁的投手紀錄是同一份資料，不是另外存一個會不同步的欄位。
 *
 * 為什麼要在這裡也放一個：先發投手是**賽前**就決定的事，會印在出賽名單圖卡上，
 * 而投手紀錄整段是為了賽後登錄而設計的。要為了填一個賽前欄位跑去「賽事管理」
 * 分頁，這件事本身就會讓人不填 —— 然後圖卡上永遠少一項。
 */
const startingPitcherId = computed<string>({
  get: () => pitchers.value.find((pitcher) => pitcher.role === 'starter')?.playerId ?? '',
  set: (playerId) => {
    const others = pitchers.value.filter((pitcher) => pitcher.role !== 'starter')
    if (!playerId) {
      pitchers.value = others
      return
    }
    const player = roster.value.find((item) => item.id === playerId)
    if (!player) return
    const existing = pitchers.value.find((pitcher) => pitcher.role === 'starter')
    pitchers.value = [
      {
        ...(existing ?? { note: '' }),
        playerId: player.id,
        name: player.name,
        number: player.number,
        role: 'starter' as const,
      },
      ...others,
    ]
  },
})

/*
 * ── 賽事錄影 ──────────────────────────────────────────────────
 *
 * 片段是錄影頁上傳的，這裡只做兩件事：看有哪些、以及把可見度同步回來。
 * 不放在自動儲存的 `formState` 裡 —— `clips` 刻意不在 `gameInputSchema`
 * 中（理由見 `gameSchema`），它有自己的端點。
 */
const clips = ref([...(game.value?.clips ?? [])])
watch(game, () => (clips.value = [...(game.value?.clips ?? [])]))

const clipsBusy = ref(false)
const clipsMessage = ref('')

const privateClipCount = computed(
  () => clips.value.filter((clip) => clip.privacy === 'private').length,
)

async function syncClipPrivacy() {
  clipsBusy.value = true
  clipsMessage.value = ''
  try {
    const result = await refreshClips(gameId.value)
    clips.value = result.clips
    const remaining = result.clips.filter((clip) => clip.privacy === 'private').length
    clipsMessage.value = remaining
      ? `已更新，還有 ${remaining} 段是私人的`
      : '已更新，所有片段都公開了'
  } catch {
    clipsMessage.value = '更新失敗，請稍後再試'
  } finally {
    clipsBusy.value = false
  }
}

async function deleteClip(videoId: string) {
  clipsBusy.value = true
  try {
    const result = await removeClip(gameId.value, videoId)
    clips.value = result.clips
    clipsMessage.value = '已從本站移除（YouTube 上的影片還在）'
  } finally {
    clipsBusy.value = false
  }
}

const pitcherOptions = computed(() => [
  { value: '', label: '（自行輸入）' },
  ...roster.value.map((player) => ({
    value: player.id,
    label: player.number ? `#${player.number} ${player.name}` : player.name,
  })),
])

useHead({ title: () => (game.value ? `編輯：vs ${game.value.opponent}` : '編輯比賽') })
</script>

<template>
  <div>
    <UiBaseEmpty v-if="error" title="找不到這場比賽" icon="🔍">
      <UiBaseButton variant="secondary" @click="navigateTo('/admin/games')">回到列表</UiBaseButton>
    </UiBaseEmpty>

    <template v-else-if="game">
      <AdminHeader
        :title="`${teamName} vs ${game.opponent}`"
        :description="formatGameDateLong(game.date)"
        back-to="/admin/games"
        back-label="回到賽事列表"
      >
        <template #actions>
          <!-- 錄影是在球場邊用手機開的，所以那是一個獨立的、深底大按鈕的頁面 -->
          <UiBaseButton variant="ghost" @click="navigateTo(`/admin/record/${game.id}`)">
            📹 錄影
          </UiBaseButton>
          <UiBaseButton variant="ghost" @click="navigateTo(`/games/${game.id}`)">
            前台預覽
          </UiBaseButton>
        </template>
      </AdminHeader>

      <!-- 自動儲存的狀態一定要看得見：最危險的是「以為存好了，其實沒有」 -->
      <div class="mb-4 min-h-6">
        <AdminAutosaveStatus
          :status="autosave.status.value"
          :error="autosave.error.value"
          @retry="autosave.retry"
        />
      </div>

      <!-- 分頁 -->
      <div class="mb-6 flex flex-wrap gap-1 border-b border-border" role="tablist">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          type="button"
          role="tab"
          :aria-selected="activeTab === tab.key"
          class="min-h-11 border-b-2 px-4 text-fluid-sm font-medium transition"
          :class="
            activeTab === tab.key
              ? 'border-brand-600 text-brand-600 dark:text-brand-300'
              : 'border-transparent text-content-muted hover:text-content'
          "
          @click="activeTab = tab.key"
        >
          {{ tab.label }}
          <!-- 未儲存的變更用一個小圓點提示，切到別的分頁也看得到 -->
        </button>
      </div>

      <!-- ══ 基本資料 ══════════════════════════════════════════ -->
      <section v-show="activeTab === 'basic'" role="tabpanel" class="max-w-2xl space-y-4">
        <div class="grid gap-4 sm:grid-cols-2">
          <UiBaseInput v-model="basic.date" label="日期" type="date" required />
          <UiBaseInput v-model="basic.time" label="時間" type="time" required />
        </div>

        <UiBaseInput v-model="basic.opponent" label="對戰球隊" required />

        <div class="grid gap-4 sm:grid-cols-2">
          <UiBaseInput v-model="basic.venue" label="場地" />
          <UiBaseInput v-model="basic.league" label="賽事名稱" />
        </div>

        <UiBaseSelect
          v-model="basic.city"
          label="場地所在縣市"
          placeholder="— 不顯示天氣 —"
          :options="TAIWAN_CITIES.map((city) => ({ value: city, label: city }))"
          hint="用來查比賽當天的天氣預報（中央氣象署只提供一週內的預報）。留空就不顯示天氣。"
        />

        <UiBaseInput
          v-model="basic.mapUrl"
          label="Google 地圖連結"
          placeholder="https://maps.app.goo.gl/..."
          hint="留空的話，前台會用上面的場地名稱自動組一個 Google 地圖搜尋連結。手機版 Google 地圖按「分享」複製到的網址可以直接貼。"
          :error="mapUrlError"
        />

        <!--
          比賽狀態不在這裡 —— 它在「賽事管理」分頁。這一頁的欄位是建檔時填一次
          就不再碰的東西，而狀態是比賽當天要按兩次的按鈕，混在一起只會讓它難找。
        -->
        <UiBaseSelect
          v-model="basic.homeAway"
          label="主客場"
          class="sm:max-w-xs"
          :options="[
            { value: 'home', label: '主場（後攻）' },
            { value: 'away', label: '客場（先攻）' },
          ]"
          hint="影響計分板上下半局的排列方式"
        />

        <UiBaseTextarea v-model="basic.note" label="備註" :rows="3" :maxlength="500" />

        <AdminImageField
          v-model="basic.opponentLogoUrl"
          label="對手隊徽"
          folder="games"
          hint="會顯示在首頁的最新比數與近期賽事。留空則顯示對手隊名的首字。"
        />

        <AdminImageField v-model="basic.coverImageUrl" label="比賽照片" folder="games" />
      </section>

      <!-- ══ 出席統計 ══════════════════════════════════════════ -->
      <section v-show="activeTab === 'attendance'" role="tabpanel" class="space-y-4">
        <p class="text-fluid-sm text-content-muted">
          出席名單會顯示在前台的比賽頁（未開打的場次）。
        </p>

        <AdminAttendanceEditor v-model="attendance" :players="roster" />
      </section>

      <!-- ══ 打線 ══════════════════════════════════════════════ -->
      <section v-show="activeTab === 'lineup'" role="tabpanel" class="space-y-4">
        <div>
          <h2 class="text-fluid-lg font-bold">先發陣容</h2>
          <p class="text-fluid-sm text-content-muted">
            比賽前排好的陣容就是賽後的出賽紀錄，只需要維護這一份。
            前台在比賽尚未開打時會標示「預計」，結束後顯示為當天打線。
          </p>
        </div>

        <div class="max-w-sm rounded-xl border border-border bg-surface p-4">
          <UiBaseSelect
            v-model="startingPitcherId"
            label="先發投手"
            placeholder="— 尚未決定 —"
            :options="pitcherOptions.filter((option) => option.value)"
            hint="會顯示在前台的出賽名單圖卡上。和「賽事管理」分頁的投手紀錄是同一筆。"
          />
        </div>

        <AdminLineupEditor v-model="lineup" :players="roster" :attendance="attendance">
          <template #actions>
            <AdminAutosaveStatus
              :status="autosave.status.value"
              :error="autosave.error.value"
              @retry="autosave.retry"
            />
          </template>
        </AdminLineupEditor>
      </section>

      <!-- ══ 賽事管理 ══════════════════════════════════════════ -->
      <section v-show="activeTab === 'result'" role="tabpanel" class="space-y-8">
        <!-- ── 賽事狀態 ────────────────────────────────────────── -->
        <fieldset class="space-y-3">
          <legend class="text-fluid-lg font-bold">賽事狀態</legend>
          <p class="text-fluid-sm text-content-muted">
            按下去就會立刻反映在官網上：「比賽中」會在賽程與首頁顯示紅色的 LIVE
            與即時比數，「比賽結束」會顯示 FINAL 與勝敗。
          </p>

          <div class="flex flex-wrap items-center gap-2" role="group" aria-label="賽事狀態">
            <button
              v-for="status in GAME_FLOW_STATUSES"
              :key="status"
              type="button"
              class="min-h-11 rounded-full border px-5 text-fluid-sm font-semibold transition"
              :class="statusButtonClass(status)"
              :aria-pressed="basic.status === status"
              @click="basic.status = status"
            >
              {{ GAME_STATUS_LABELS[status] }}
            </button>

            <!--
              延賽與取消是岔出主流程的兩條，所以用一條分隔線隔開而不是排成同一排。
              它們還是同一個欄位的值，做成第二個控制項只會讓人不知道該以哪個為準。
            -->
            <span class="mx-1 hidden h-6 w-px bg-border sm:block" aria-hidden="true" />

            <button
              v-for="status in GAME_EXCEPTION_STATUSES"
              :key="status"
              type="button"
              class="min-h-11 rounded-full border px-4 text-fluid-sm font-medium transition"
              :class="statusButtonClass(status)"
              :aria-pressed="basic.status === status"
              @click="basic.status = status"
            >
              {{ GAME_STATUS_LABELS[status] }}
            </button>
          </div>
        </fieldset>

        <hr class="border-border" />

        <div class="space-y-4">
          <div class="flex flex-wrap items-baseline justify-between gap-3">
            <h2 class="text-fluid-lg font-bold">計分板</h2>

            <!--
              判定結果只顯示、不能改：它是計分板總分推導出來的，而且只有
              「比賽結束」才有值 —— 領先不等於贏了。
            -->
            <p v-if="result" class="text-fluid-sm">
              <span class="text-content-muted">判定結果</span>
              <span class="ml-2 font-bold">{{ GAME_RESULT_LABELS[result] }}</span>
              <span class="ml-2 tabular-nums text-content-muted">
                （{{ board.totals.our.r }} : {{ board.totals.opponent.r }}）
              </span>
            </p>
            <p v-else class="text-fluid-sm text-content-muted">
              標記為「比賽結束」後，這裡會依計分板總分自動判定勝敗。
            </p>
          </div>

          <AdminScoreboardEditor
            v-model="scoreboard"
            :our-name="teamName"
            :opponent-name="game.opponent"
            :team-names="teamNames"
          />
        </div>

        <hr class="border-border" />

        <!-- ── 賽事錄影 ──────────────────────────────────────── -->
        <div class="space-y-3">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 class="text-fluid-lg font-bold">賽事錄影</h2>
              <p class="text-fluid-sm text-content-muted">
                片段在
                <NuxtLink
                  :to="`/admin/record/${game.id}`"
                  class="text-brand-600 underline underline-offset-4 dark:text-brand-300"
                >
                  錄影頁
                </NuxtLink>
                錄製並自動上傳。
              </p>
            </div>
            <UiBaseButton
              v-if="clips.length"
              variant="secondary"
              size="sm"
              :loading="clipsBusy"
              @click="syncClipPrivacy"
            >
              更新影片狀態
            </UiBaseButton>
          </div>

          <!--
            ⚠️ 這段說明不能省。

            透過 API 上傳的影片一律是私人的（未通過 YouTube 合規稽核的專案
            強制如此），而**私人的片段前台不會顯示**。不講的話，管理者會
            以為上傳成功就完事了，然後納悶為什麼官網上什麼都沒有。
          -->
          <p
            v-if="privateClipCount"
            class="rounded-lg bg-warning/15 px-3 py-2 text-fluid-sm text-warning"
          >
            有 {{ privateClipCount }} 段還是「私人」，前台不會顯示。請到 YouTube Studio
            改成公開或不公開，再按上面的「更新影片狀態」。
          </p>

          <ul v-if="clips.length" class="space-y-2">
            <li
              v-for="clip in clips"
              :key="clip.videoId"
              class="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-fluid-sm"
            >
              <span class="font-bold">第 {{ clip.inning }} 局{{ HALF_LABELS[clip.half] }}</span>

              <UiBaseBadge :tone="clip.privacy === 'private' ? 'warning' : 'success'" size="sm">
                {{
                  clip.privacy === 'private'
                    ? '私人'
                    : clip.privacy === 'public'
                      ? '公開'
                      : '不公開'
                }}
              </UiBaseBadge>

              <a
                :href="`https://studio.youtube.com/video/${clip.videoId}/edit`"
                target="_blank"
                rel="noopener noreferrer"
                class="text-content-muted underline underline-offset-4 hover:text-brand-600"
              >
                在 YouTube Studio 開啟
              </a>

              <!-- 只移除本站的紀錄，不刪 YouTube 上的影片 -->
              <AdminDeleteButton
                class="ml-auto"
                :loading="clipsBusy"
                @confirm="deleteClip(clip.videoId)"
              />
            </li>
          </ul>
          <p v-else class="text-fluid-sm text-content-muted">還沒有錄影片段。</p>

          <p v-if="clipsMessage" class="text-fluid-sm">{{ clipsMessage }}</p>
        </div>

        <hr class="border-border" />

        <div class="space-y-3">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <h2 class="text-fluid-lg font-bold">投手紀錄</h2>
            <UiBaseButton variant="secondary" size="sm" @click="addPitcher"
              >＋ 新增投手</UiBaseButton
            >
          </div>

          <ul v-if="pitchers.length" class="space-y-2">
            <li
              v-for="(pitcher, index) in pitchers"
              :key="index"
              class="grid items-end gap-3 rounded-xl border border-border bg-surface p-3 sm:grid-cols-[1fr_8rem_1fr_auto]"
            >
              <div class="space-y-2">
                <UiBaseSelect
                  label="投手"
                  :model-value="pitcher.playerId"
                  :options="pitcherOptions"
                  @update:model-value="onPitcherPlayerChange(index, $event)"
                />
                <UiBaseInput
                  v-if="!pitcher.playerId"
                  label="姓名"
                  :model-value="pitcher.name"
                  @update:model-value="updatePitcher(index, { name: $event })"
                />
              </div>

              <UiBaseSelect
                label="角色"
                :model-value="pitcher.role"
                :options="
                  [
                    { value: 'starter', label: '先發' },
                    { value: 'relief', label: '中繼' },
                    { value: 'closer', label: '終結' },
                  ] as Array<{ value: PitcherEntry['role']; label: string }>
                "
                @update:model-value="updatePitcher(index, { role: $event })"
              />

              <UiBaseInput
                label="備註"
                :model-value="pitcher.note"
                placeholder="例如：6 局 2 失分"
                @update:model-value="updatePitcher(index, { note: $event })"
              />

              <UiBaseButton
                variant="ghost"
                size="sm"
                aria-label="移除投手"
                @click="pitchers = pitchers.filter((_, i) => i !== index)"
              >
                ✕
              </UiBaseButton>
            </li>
          </ul>
        </div>
      </section>
    </template>
  </div>
</template>
