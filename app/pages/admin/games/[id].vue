<script setup lang="ts">
import type {
  AttendanceEntry,
  GameResult,
  GameStatus,
  LineupEntry,
  PitcherEntry,
  Scoreboard,
} from '#shared/schemas/game'
import {
  deriveResult,
  emptyScoreboard,
  GAME_RESULT_LABELS,
  GAME_STATUS_LABELS,
  isGoogleMapsUrl,
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
 * 未開打的比賽前台顯示「出席＋先發陣容」，已結束的顯示「打線＋計分板」。
 * 後台四個分頁一律都在 —— 比賽結束後仍可能要回頭補出席紀錄。
 */
definePageMeta({ layout: 'admin', middleware: 'auth' })

const route = useRoute()
const gameId = computed(() => String(route.params.id))

const { data: game, error } = await useGame(gameId)
const { data: players } = await usePlayers()
const { data: settings } = await useSiteSettings()
const { updateGame } = useGameActions()

const teamName = computed(() => settings.value?.teamName ?? '我隊')
const teamNames = computed(() => (settings.value ? teamNameCandidates(settings.value) : []))
const roster = computed(() => players.value ?? [])

/** 狀態選項直接由標籤表產生 —— 之後新增狀態只要改 shared 那一份。 */
const statusOptions = (Object.keys(GAME_STATUS_LABELS) as GameStatus[]).map((status) => ({
  value: status,
  label: GAME_STATUS_LABELS[status],
}))

const tabs = [
  { key: 'basic', label: '基本資料' },
  { key: 'attendance', label: '出席統計' },
  { key: 'lineup', label: '打線' },
  { key: 'result', label: '計分板與結果' },
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
  status: 'scheduled' as 'scheduled' | 'finished' | 'canceled',
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
/** 空字串代表「依計分板自動判定」。做成選項之一，型別才不必和 placeholder 打架。 */
const resultOverride = ref<GameResult | ''>('')

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
  scoreboard: scoreboard.value,
  result: resultOverride.value || null,
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
  resultOverride.value = current.result ?? ''
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
 * 標記為已結束。
 *
 * 這一步刻意保持手動：自動儲存負責的是「把你填的東西存起來」，
 * 而「這場比賽打完了」是一個決定，不該因為你開始填計分板就被代為認定。
 */
function markAsFinished() {
  basic.status = 'finished'
}

const autoResult = computed(() => deriveResult(scoreboard.value.totals))

const resultOptions = computed<Array<{ value: GameResult | ''; label: string }>>(() => [
  { value: '', label: `自動判定（目前為「${GAME_RESULT_LABELS[autoResult.value]}」）` },
  { value: 'win', label: '勝' },
  { value: 'loss', label: '敗' },
  { value: 'tie', label: '和' },
])

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
        back-label="回到賽程列表"
      >
        <template #actions>
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

        <div class="grid gap-4 sm:grid-cols-2">
          <UiBaseSelect
            v-model="basic.homeAway"
            label="主客場"
            :options="[
              { value: 'home', label: '主場（後攻）' },
              { value: 'away', label: '客場（先攻）' },
            ]"
            hint="影響計分板上下半局的排列方式"
          />
          <UiBaseSelect
            v-model="basic.status"
            label="比賽狀態"
            :options="statusOptions"
            hint="「已結束」會在前台改為顯示打線與計分板；「因雨延賽」會列在比賽結果頁並標注"
          />
        </div>

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

      <!-- ══ 計分板與結果 ══════════════════════════════════════ -->
      <section v-show="activeTab === 'result'" role="tabpanel" class="space-y-8">
        <div class="space-y-4">
          <h2 class="text-fluid-lg font-bold">計分板</h2>

          <AdminScoreboardEditor
            v-model="scoreboard"
            :our-name="teamName"
            :opponent-name="game.opponent"
            :team-names="teamNames"
          />

          <UiBaseSelect
            v-model="resultOverride"
            label="比賽結果"
            :options="resultOptions"
            hint="選「自動判定」則依計分板總分決定勝敗。裁定比賽等特殊情況才需要手動指定。"
            class="max-w-xs"
          />

          <div v-if="basic.status !== 'finished'" class="flex flex-wrap items-center gap-3">
            <UiBaseButton variant="secondary" @click="markAsFinished">標記為已結束</UiBaseButton>
            <span class="text-fluid-sm text-content-muted">
              計分板會自動儲存；標記為已結束之後，前台才會改為顯示打線與計分板。
            </span>
          </div>
          <p v-else class="text-fluid-sm text-success">✓ 這場比賽已標記為結束。</p>
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
