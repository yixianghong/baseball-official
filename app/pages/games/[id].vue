<script setup lang="ts">
import {
  GAME_RESULT_LABELS,
  GAME_STATUS_LABELS,
  deriveBench,
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
 * | `scheduled`（未來） | 預計出席名單、先發陣容、比賽資訊 |
 * | `finished`（過去） | 計分板、當天打線、投手、比賽結果 |
 *
 * 打線只有一份（`game.lineup`）：比賽前排好的陣容就是賽後的出賽紀錄，
 * 這裡只是依狀態換個說法 —— 未開打標示「預計」，結束後就是當天打線。
 * | `canceled` | 取消說明 |
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
const isPostponed = computed(() => game.value?.status === 'postponed')
/** 延賽與取消都沒有打成。 */
const notPlayed = computed(() => (game.value ? isNotPlayed(game.value) : false))

const countdown = computed(() =>
  game.value ? describeCountdown(daysUntil(game.value.date, today.value)) : '',
)

const resultTone = computed(() => {
  // 與 GameCard 同一套語彙：勝場用隊徽的金色
  if (game.value?.result === 'win') return 'accent' as const
  if (game.value?.result === 'loss') return 'danger' as const
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
            <UiBaseBadge v-else-if="isFinished && game.result" :tone="resultTone" on-dark>
              {{ GAME_RESULT_LABELS[game.result] }}
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

            <!-- 已結束的比賽，比數是最重要的資訊，字級拉到最大 -->
            <p v-if="isFinished" class="text-fluid-3xl font-black tabular-nums">
              <span :class="score.our >= score.opponent ? '' : 'text-white/70'">{{
                score.our
              }}</span>
              <span class="mx-2 text-white/50">:</span>
              <span :class="score.opponent > score.our ? '' : 'text-white/70'">
                {{ score.opponent }}
              </span>
            </p>
          </div>

          <dl class="mt-6 grid gap-4 border-t border-white/20 pt-5 text-fluid-sm sm:grid-cols-3">
            <div>
              <dt class="text-white/60">場地</dt>
              <dd class="font-medium">{{ game.venue || '未定' }}</dd>
            </div>
            <div>
              <dt class="text-white/60">主客場</dt>
              <dd class="font-medium">
                {{ game.homeAway === 'home' ? '主場（後攻）' : '客場（先攻）' }}
              </dd>
            </div>
            <div v-if="game.note">
              <dt class="text-white/60">備註</dt>
              <dd class="whitespace-pre-wrap font-medium">{{ game.note }}</dd>
            </div>
          </dl>
        </div>
      </header>

      <!-- ══ 已結束：計分板 + 打線 + 投手 ═══════════════════════ -->
      <template v-if="isFinished">
        <section aria-labelledby="scoreboard-heading">
          <h2 id="scoreboard-heading" class="mb-4 text-fluid-xl font-bold">計分板</h2>

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
            description="比賽結果登錄後會顯示在這裡。"
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
