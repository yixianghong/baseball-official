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

const { data: game, error } = await useGame(gameId)
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

/**
 * 候補：確定出席、但不在先發打線上的人。
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

        <div class="grid gap-8 lg:grid-cols-2">
          <section aria-labelledby="lineup-heading">
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

          <section v-if="game.pitchers.length" aria-labelledby="pitchers-heading">
            <h2 id="pitchers-heading" class="mb-4 text-fluid-xl font-bold">投手</h2>
            <ul class="space-y-2">
              <li
                v-for="pitcher in game.pitchers"
                :key="`${pitcher.playerId}-${pitcher.name}`"
                class="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface-raised px-4 py-3"
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
          </section>
        </div>
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
        :title="isPostponed ? '這場比賽因雨延賽' : '這場比賽已取消'"
        :description="
          game.note || (isPostponed ? '改期後的日期會另行公告。' : '這場比賽不會補行。')
        "
        icon="🌧️"
      />
    </div>
  </div>
</template>
