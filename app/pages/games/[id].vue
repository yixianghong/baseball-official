<script setup lang="ts">
import {
  GAME_RESULT_LABELS,
  GAME_STATUS_LABELS,
  deriveBench,
  gameMapUrl,
  gameResult,
  hasScore,
  isNotPlayed,
} from '#shared/schemas/game'
import { describeCountdown, daysUntil, formatGameDateLong } from '~/utils/format'

/**
 * 比賽詳情。
 *
 * ## 同一個網址，兩種面貌
 * 依 `status` 分流 —— 這正是這個頁面存在的理由：
 *
 * | 狀態 | 顯示 |
 * |---|---|
 * | `scheduled`（尚未開始） | 預計出席名單、先發陣容、比賽資訊 |
 * | `live`（比賽中） | 即時計分板、當天打線、投手 |
 * | `finished`（比賽結束） | 最終計分板、當天打線、投手、勝敗 |
 * | `postponed` / `canceled` | 沒打成的說明 |
 *
 * 打線只有一份（`game.lineup`）：比賽前排好的陣容就是賽後的出賽紀錄，
 * 這裡只是依狀態換個說法 —— 未開打標示「預計」，開打之後就是當天打線。
 *
 * 進行中與已結束看的是同一組區塊（計分板＋名單），差別只在標題與比數旁邊
 * 寫的是 LIVE 還是 FINAL：比賽打到一半時，人想看的東西和打完之後一模一樣。
 *
 * 判斷依 `status` 而不是日期：比賽可能因雨延賽，日期過了卻還沒打。
 *
 * ## 資料只要一次請求
 * 打線、出席、計分板全都內嵌在比賽文件裡（見 `shared/schemas/game.ts`），
 * 所以這頁只有一支 `useGame()`。
 */
const route = useRoute()
const gameId = computed(() => String(route.params.id))

const { data: game, error, refresh } = await useGame(gameId)
const { data: settings } = await useSiteSettings()
const today = useToday()

const teamName = computed(() => settings.value?.teamName ?? '我隊')

const isFinished = computed(() => game.value?.status === 'finished')
const isLive = computed(() => game.value?.status === 'live')
const isPostponed = computed(() => game.value?.status === 'postponed')
/** 進行中與已結束都有比數可看。 */
const showScore = computed(() => (game.value ? hasScore(game.value) : false))
/** 延賽與取消都沒有打成。 */
const notPlayed = computed(() => (game.value ? isNotPlayed(game.value) : false))

/** 勝敗是推導的（只有結束的比賽才有值），不是一個存下來的欄位。 */
const result = computed(() => (game.value ? gameResult(game.value) : null))

const countdown = computed(() =>
  game.value ? describeCountdown(daysUntil(game.value.date, today.value)) : '',
)

const resultTone = computed(() => {
  // 與 GameCard 同一套語彙：勝場用隊徽的金色
  if (result.value === 'win') return 'accent' as const
  if (result.value === 'loss') return 'danger' as const
  return 'neutral' as const
})

const score = computed(() => ({
  our: game.value?.scoreboard.totals.our.r ?? 0,
  opponent: game.value?.scoreboard.totals.opponent.r ?? 0,
}))

/*
 * ── 比賽進行中自動更新 ──────────────────────────────────────────
 *
 * 計分板、比數與影片片段在比賽進行中是後台隨時在改的，而這一頁的 HTML 走
 * CDN 快取（`s-maxage=60`）—— 沒有輪詢的話，開著頁面等比數的人要自己
 * 重新整理才看得到變化，而那正是最不會想動手的時候。
 *
 * ## 三個「不要浪費請求」的條件
 * - **只有進行中才輪詢**：已結束或還沒開打的比賽不會再變。
 *   狀態在輪詢中翻成 `finished` 時，那一次請求會抓到最終結果，然後自己停掉。
 * - **分頁在背景就暫停**：對著看不見的畫面發請求沒有意義，手機還會耗電。
 * - 間隔可用 `NUXT_PUBLIC_GAME_POLL_MS` 調整，設 0 就整個關掉。
 *
 * ## 為什麼是輪詢 `/api/games/[id]` 而不是加 CDN 快取
 * 後台讀的是同一支端點，替它加上共用快取會讓「我明明存檔了」變成客訴
 * （見「部署」章節）。以這個站的觀看規模，120 秒一次的原站請求微不足道。
 */
const pollMs = Number(useRuntimeConfig().public.gamePollMs) || 0
const documentVisibility = useDocumentVisibility()

const { pause: pausePolling, resume: resumePolling } = useIntervalFn(
  () => refresh(),
  // `useIntervalFn` 不收 0，關閉輪詢是靠下面的 `shouldPoll` 永遠為 false
  pollMs || 60_000,
  { immediate: false },
)

/*
 * ⚠️ `watchEffect` 會立刻執行一次，所以它必須放在用到的 `const` **之後**
 * （見 CLAUDE.md 的坑）。這裡用到 `isLive`、`pollMs` 與上面兩個控制函式。
 */
watchEffect(() => {
  const shouldPoll = pollMs > 0 && isLive.value && documentVisibility.value === 'visible'
  if (shouldPoll) resumePolling()
  else pausePolling()
})

/**
 * 候補：確定出席、但今天沒有上場的人（不在打線也不在投手紀錄上）。
 * 推導而來，不是另外存的欄位 —— 理由見 `deriveBench()`。
 */
const bench = computed(() => (game.value ? deriveBench(game.value) : []))

/** 地圖連結。後台沒填時用場地名稱組搜尋連結，見 `gameMapUrl()`。 */
const mapUrl = computed(() => (game.value ? gameMapUrl(game.value) : ''))

/**
 * 當天天氣。只有還沒打的場次才查 —— 已經打完的比賽顯示「預報」沒有意義，
 * 而且氣象署也查不到過去的日期。
 */
const { data: weather } = useGameWeather(gameId)

/**
 * 天氣那一欄要不要出現。
 *
 * 沒有指定縣市、或站台沒設定授權碼時 `GameWeather` 自己會不顯示，但主視覺的
 * `<dt>當天天氣</dt>` 是外面這一層畫的 —— 不一起判斷就會留下一個空標籤。
 *
 * 開打之後（進行中、已結束）就不顯示了：那一欄寫的是「預報」，而球已經在打了。
 *
 * ⚠️ **這個判斷不能把 `pending` 算進去。** 天氣是 `server: false` 查的，
 * SSR 階段的狀態是 idle（不是 pending），但瀏覽器一 hydrate 就立刻變成
 * pending —— 兩邊畫出來的東西不一樣，就是 hydration mismatch。
 * 代價是資料回來時版面會跳一下，這比渲染錯誤好。
 */
const showWeather = computed(
  () =>
    !showScore.value &&
    weather.value !== null &&
    weather.value.status !== 'no-city' &&
    weather.value.status !== 'not-configured',
)

/** 未來場次若還沒登錄先發，顯示提示而不是一片空白。 */
const hasLineup = computed(() => (game.value?.lineup.length ?? 0) > 0)
const hasAttendance = computed(() => (game.value?.attendance.length ?? 0) > 0)
const hasScoreboard = computed(() => (game.value?.scoreboard.innings.length ?? 0) > 0)

useHead({
  title: () => (game.value ? `${teamName.value} vs ${game.value.opponent}` : '比賽'),
})
</script>

<template>
  <div class="container-content py-10 md:py-14">
    <NuxtLink
      :to="isFinished ? '/results' : '/schedule'"
      class="mb-6 inline-flex text-fluid-sm text-content-muted hover:text-brand-600"
    >
      ← 回到{{ isFinished ? '比賽結果' : '近期賽程' }}
    </NuxtLink>

    <UiBaseEmpty v-if="error" title="找不到這場比賽" description="它可能已經被刪除。" icon="🔍" />

    <div v-else-if="game" class="space-y-10">
      <!-- ── 比賽標題列 ─────────────────────────────────────────── -->
      <!-- 比賽標題卡用深藍實心：這是整頁的主角，白底卡片撐不起比數要有的份量 -->
      <header class="relative overflow-hidden rounded-2xl bg-ink text-white">
        <div class="field-pattern absolute inset-0 opacity-60" aria-hidden="true" />
        <div class="relative p-6 md:p-10">
          <div class="flex flex-wrap items-center gap-3">
            <!-- 標題卡是深藍底，標籤要用深底配色才看得清楚 -->
            <UiBaseBadge v-if="notPlayed" :tone="isPostponed ? 'warning' : 'neutral'" on-dark>
              {{ GAME_STATUS_LABELS[game.status] }}
            </UiBaseBadge>
            <GameLiveBadge v-else-if="isLive" />
            <UiBaseBadge v-else-if="result" :tone="resultTone" on-dark>
              {{ GAME_RESULT_LABELS[result] }}
            </UiBaseBadge>
            <UiBaseBadge v-else tone="brand" on-dark>{{ countdown }}</UiBaseBadge>

            <span v-if="game.league" class="text-fluid-sm text-white/70">{{ game.league }}</span>
          </div>

          <div class="mt-5 flex flex-wrap items-center justify-between gap-6">
            <div>
              <h1 class="flex flex-wrap items-center gap-3 text-fluid-2xl font-black">
                {{ teamName }}
                <span class="text-white/60">vs</span>
                <CommonTeamCrest
                  :name="game.opponent"
                  :logo-url="game.opponentLogoUrl"
                  size="md"
                  on-dark
                />
                {{ game.opponent }}
              </h1>
              <p class="mt-2 text-white/70">{{ formatGameDateLong(game.date) }} {{ game.time }}</p>
            </div>

            <!-- 開打之後，比數是最重要的資訊，字級拉到最大 -->
            <div v-if="showScore" class="text-right">
              <!--
                比數旁邊一定要寫出它是「最終」還是「此刻」：一個 6:3 自己
                說不出比賽打完了沒有。
              -->
              <p class="text-fluid-sm font-bold tracking-[0.3em] text-white/60">
                {{ isLive ? 'LIVE' : 'FINAL' }}
              </p>
              <p
                class="text-fluid-3xl font-black tabular-nums"
                :aria-label="`比數 ${score.our} 比 ${score.opponent}`"
              >
                <span :class="isLive || score.our >= score.opponent ? '' : 'text-white/70'">{{
                  score.our
                }}</span>
                <span class="mx-2 text-white/50">:</span>
                <span :class="isLive || score.opponent > score.our ? '' : 'text-white/70'">
                  {{ score.opponent }}
                </span>
              </p>
            </div>
          </div>

          <dl class="mt-6 grid gap-4 border-t border-white/20 pt-5 text-fluid-sm sm:grid-cols-3">
            <div>
              <dt class="text-white/60">場地</dt>
              <dd class="font-medium">
                <!--
                  有地圖連結就讓場地名稱本身可以點。另外開分頁，並且加上
                  `rel="noopener"` —— 少了它，被開啟的頁面可以透過
                  `window.opener` 把原分頁導去別的地方。
                -->
                <a
                  v-if="mapUrl"
                  :href="mapUrl"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="inline-flex items-center gap-1.5 underline decoration-white/40 underline-offset-4 transition hover:decoration-white"
                >
                  {{ game.venue || '未定' }}
                  <svg
                    class="size-4 shrink-0"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path
                      d="M12 2a7 7 0 0 0-7 7c0 5.2 6.3 12.3 6.6 12.6a.5.5 0 0 0 .8 0C12.7 21.3 19 14.2 19 9a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z"
                    />
                  </svg>
                  <span class="sr-only">（在 Google 地圖開啟）</span>
                </a>
                <template v-else>{{ game.venue || '未定' }}</template>
              </dd>
            </div>
            <div>
              <dt class="text-white/60">主客場</dt>
              <dd class="font-medium">
                {{ game.homeAway === 'home' ? '主場（後攻）' : '客場（先攻）' }}
              </dd>
            </div>
            <!--
              天氣放在主視覺裡：決定要不要去，天氣多半是先看的那一個。
              沒有縣市、或站台沒設定授權碼時，`GameWeather` 整塊不顯示 ——
              所以這裡的 `v-if` 跟著它的條件走，才不會留下一個空的「當天天氣」標籤。
            -->
            <div v-if="showWeather">
              <dt class="text-white/60">當天天氣</dt>
              <dd class="font-medium">
                <GameWeather :weather="weather" />
              </dd>
            </div>
            <div v-if="game.note">
              <dt class="text-white/60">備註</dt>
              <dd class="whitespace-pre-wrap font-medium">{{ game.note }}</dd>
            </div>
          </dl>
        </div>
      </header>

      <!-- ══ 進行中／已結束：計分板 + 打線 + 投手 ═══════════════ -->
      <template v-if="showScore">
        <section aria-labelledby="scoreboard-heading">
          <div class="mb-4 flex flex-wrap items-center gap-3">
            <h2 id="scoreboard-heading" class="text-fluid-xl font-bold">計分板</h2>
            <!-- 進行中的計分板是「目前為止」，不講清楚會被當成最終比數 -->
            <span v-if="isLive" class="text-fluid-sm text-content-muted">
              比賽進行中，逐局得分會隨著登錄更新。
            </span>
          </div>

          <GameScoreboard
            v-if="hasScoreboard"
            :scoreboard="game.scoreboard"
            :home-away="game.homeAway"
            :our-name="teamName"
            :opponent-name="game.opponent"
          />
          <UiBaseEmpty
            v-else
            title="尚未登錄計分板"
            :description="isLive ? '逐局得分登錄後會顯示在這裡。' : '比賽結果登錄後會顯示在這裡。'"
            icon="🔢"
          />
        </section>

        <!--
          出賽名單自己一列，但寬度收在 `max-w-xl`。

          ⚠️ 不能讓它吃滿整個容器：`useShareRoster()` 截的就是這張卡本身，
          所以版面寬度直接決定**下載下來的 PNG 有多寬** —— 在桌機上撐滿
          會截出一張又扁又寬、貼進群組幾乎看不清楚的圖。
          這個寬度大致等於它原本在兩欄格線裡的寬度。
        -->
        <section aria-labelledby="lineup-heading" class="max-w-xl">
          <h2 id="lineup-heading" class="mb-4 text-fluid-xl font-bold">出賽名單</h2>

          <!--
            圖卡是唯一的呈現方式（先發打序與候補都在裡面），所以它必須語意
            完整 —— 名字是連結、守位帶中文全名。不要再補一份表格上來。
          -->
          <GameLineupCard
            v-if="game.lineup.length"
            :entries="game.lineup"
            :team-name="teamName"
            :team-logo-url="settings?.logoUrl"
            :opponent="game.opponent"
            :opponent-logo-url="game.opponentLogoUrl"
            :bench="bench"
            :date="game.date"
            :time="game.time"
            :venue="game.venue"
            :pitchers="game.pitchers"
          />
          <UiBaseEmpty v-else title="尚未登錄出賽名單" icon="📋" />
        </section>

        <!--
          ══ 本場紀錄 ══
          投手與打擊是同一件事的兩面（這一場我們打得怎麼樣），所以收在同一個
          標題底下，各自用 `<h3>` 分開 —— 而不是兩個平行的 `<h2>`，那會讓
          目錄上出現兩個看起來不相干的區塊。

          **上下排而不是左右並排**：投手通常一到三個人，打者九到十二個。
          並排的話左欄兩列、右欄十二列，中間空一大塊，看起來像壞掉了。

          兩種紀錄的成績都是後台一個字一個字打進去的純文字
          （`batterEntrySchema` 說明了為什麼不是數字欄位），
          所以這裡照原樣顯示，不做任何解析或加總。
        -->
        <section
          v-if="game.pitchers.length || game.batters.length"
          aria-labelledby="records-heading"
          class="space-y-6"
        >
          <h2 id="records-heading" class="text-fluid-xl font-bold">本場紀錄</h2>

          <div v-if="game.pitchers.length">
            <h3 class="mb-3 text-fluid-base font-bold text-content-muted">投手</h3>
            <ul class="grid gap-2 sm:grid-cols-2">
              <li
                v-for="pitcher in game.pitchers"
                :key="`${pitcher.playerId}-${pitcher.name}`"
                class="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border bg-surface-raised px-4 py-3"
              >
                <UiBaseBadge tone="brand" size="sm">
                  {{
                    pitcher.role === 'starter'
                      ? '先發'
                      : pitcher.role === 'closer'
                        ? '終結'
                        : '中繼'
                  }}
                </UiBaseBadge>
                <NuxtLink
                  v-if="pitcher.playerId"
                  :to="`/players/${pitcher.playerId}`"
                  class="font-medium hover:text-brand-600"
                >
                  <span v-if="pitcher.number" class="mr-1 text-content-muted tabular-nums">
                    #{{ pitcher.number }}
                  </span>
                  {{ pitcher.name }}
                </NuxtLink>
                <span v-else class="font-medium">{{ pitcher.name }}</span>
                <span v-if="pitcher.note" class="text-fluid-sm text-content-muted">
                  {{ pitcher.note }}
                </span>
              </li>
            </ul>
          </div>

          <div v-if="game.batters.length">
            <h3 class="mb-3 text-fluid-base font-bold text-content-muted">打擊</h3>
            <ul class="grid gap-2 sm:grid-cols-2">
              <li
                v-for="batter in game.batters"
                :key="`${batter.playerId}-${batter.name}`"
                class="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border bg-surface-raised px-4 py-3"
              >
                <NuxtLink
                  v-if="batter.playerId"
                  :to="`/players/${batter.playerId}`"
                  class="font-medium hover:text-brand-600"
                >
                  <span v-if="batter.number" class="mr-1 text-content-muted tabular-nums">
                    #{{ batter.number }}
                  </span>
                  {{ batter.name }}
                </NuxtLink>
                <!-- 名冊上沒有的人（臨時支援）不連到球員頁 —— 那一頁不存在 -->
                <span v-else class="font-medium">
                  <span v-if="batter.number" class="mr-1 text-content-muted tabular-nums">
                    #{{ batter.number }}
                  </span>
                  {{ batter.name }}
                </span>
                <span v-if="batter.note" class="text-fluid-sm text-content-muted">
                  {{ batter.note }}
                </span>
              </li>
            </ul>
          </div>
        </section>
      </template>

      <!-- ══ 未來：出席 + 先發陣容 ═════════════════════════════ -->
      <template v-else-if="!notPlayed">
        <div class="grid gap-8 lg:grid-cols-2">
          <section aria-labelledby="attendance-heading">
            <h2 id="attendance-heading" class="mb-4 text-fluid-xl font-bold">預計出席</h2>
            <GameAttendance v-if="hasAttendance" :entries="game.attendance" />
            <UiBaseEmpty
              v-else
              title="尚未開始統計出席"
              description="隊員回報後，出席名單會顯示在這裡。"
              icon="🙋"
            />
          </section>

          <section aria-labelledby="probable-heading">
            <h2 id="probable-heading" class="mb-4 text-fluid-xl font-bold">出賽名單</h2>

            <GameLineupCard
              v-if="hasLineup"
              :entries="game.lineup"
              :team-name="teamName"
              :team-logo-url="settings?.logoUrl"
              :opponent="game.opponent"
              :opponent-logo-url="game.opponentLogoUrl"
              :bench="bench"
              :date="game.date"
              :time="game.time"
              :venue="game.venue"
              :pitchers="game.pitchers"
            />
            <UiBaseEmpty
              v-else
              title="尚未安排出賽名單"
              description="教練團排定後會公布在這裡。"
              icon="📝"
            />

            <!-- 「預計」這件事原本寫在表格底下，表格拿掉了就移到這裡 -->
            <p v-if="hasLineup" class="mt-3 text-fluid-sm text-content-muted">
              名單為預計出賽，實際以當天為準。
            </p>
          </section>
        </div>
      </template>

      <!-- ══ 延賽／取消 ════════════════════════════════════════ -->
      <UiBaseEmpty
        v-else
        :title="isPostponed ? '這場比賽已延賽' : '這場比賽已取消'"
        :description="
          game.note || (isPostponed ? '改期後的日期會另行公告。' : '這場比賽不會補行。')
        "
      />

      <!--
        ══ 本場影片 ══
        **整頁最後一塊**，而且不分狀態都放這裡。

        影片是「看完文字資訊之後才會想點的東西」：比數在最上面的主視覺、
        計分板與名單在中間，這三樣是點進比賽頁的人真正要查的。影片十四段
        排成網格，夾在中間會把後面的內容整個推到捲動範圍外 ——
        要看逐局得分的人得先捲過一整片縮圖。

        沒有可顯示的片段時 `GameClips` 自己整塊不渲染（私人影片也會被濾掉），
        所以延賽／取消的場次不會多出一個空標題。
      -->
      <GameClips :clips="game.clips" :finished="isFinished" />
    </div>
  </div>
</template>
