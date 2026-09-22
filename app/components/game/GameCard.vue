<script setup lang="ts">
import type { Game } from '#shared/schemas/game'
import { GAME_RESULT_LABELS, GAME_STATUS_LABELS, isNotPlayed } from '#shared/schemas/game'
import { describeCountdown, daysUntil, formatGameDate } from '~/utils/format'

/**
 * 賽程／結果卡片。近期賽程、比賽結果、首頁都用同一個元件。
 *
 * 未來與過去的比賽要強調的資訊不同：
 * - **未來**：什麼時候、還有幾天、在哪裡打
 * - **過去**：贏了還是輸了、比數多少
 *
 * 用同一個元件並依 `status` 切換，而不是寫兩個長得很像的元件 ——
 * 卡片的外框、間距、hover 行為只需要維護一份。
 */
const props = defineProps<{
  game: Game
  /** 我隊名稱，用於顯示對戰組合。 */
  ourName: string
  /** `YYYY-MM-DD` 的今天，由頁面傳入以避免 SSR 與瀏覽器算出不同結果。 */
  today: string
}>()

const isFinished = computed(() => props.game.status === 'finished')
/** 延賽與取消都沒有打成，不該顯示比數。 */
const notPlayed = computed(() => isNotPlayed(props.game))

const countdown = computed(() => describeCountdown(daysUntil(props.game.date, props.today)))

const resultTone = computed(() => {
  // 勝場用隊徽的金色而不是綠色：綠與品牌 teal 太接近，一排卡片掃過去
  // 會分不出哪個是隊色、哪個是「贏了」。
  if (props.game.result === 'win') return 'accent' as const
  if (props.game.result === 'loss') return 'danger' as const
  return 'neutral' as const
})

const score = computed(() => ({
  our: props.game.scoreboard.totals.our.r,
  opponent: props.game.scoreboard.totals.opponent.r,
}))
</script>

<template>
  <NuxtLink
    :to="`/games/${game.id}`"
    class="group flex flex-col gap-3 rounded-xl border border-border bg-surface-raised p-5 transition hover:border-brand-400 hover:shadow-sm"
  >
    <div class="flex items-start justify-between gap-3">
      <div class="flex items-center gap-2">
        <span class="text-fluid-lg font-bold tabular-nums">{{ formatGameDate(game.date) }}</span>
        <span class="text-fluid-sm text-content-muted tabular-nums">{{ game.time }}</span>
      </div>

      <UiBaseBadge v-if="notPlayed" :tone="game.status === 'postponed' ? 'warning' : 'neutral'">
        {{ GAME_STATUS_LABELS[game.status] }}
      </UiBaseBadge>
      <UiBaseBadge v-else-if="isFinished && game.result" :tone="resultTone">
        {{ GAME_RESULT_LABELS[game.result] }}
      </UiBaseBadge>
      <UiBaseBadge v-else tone="brand">{{ countdown }}</UiBaseBadge>
    </div>

    <div class="flex items-center justify-between gap-4">
      <div class="min-w-0 flex-1">
        <p class="truncate text-fluid-base font-semibold">
          {{ ourName }}
          <span class="mx-1.5 text-content-muted">vs</span>
          {{ game.opponent }}
        </p>
        <p class="mt-0.5 flex flex-wrap items-center gap-x-2 text-fluid-sm text-content-muted">
          <span>{{ game.homeAway === 'home' ? '主場' : '客場' }}</span>
          <span v-if="game.venue">· {{ game.venue }}</span>
          <span v-if="game.league">· {{ game.league }}</span>
        </p>
      </div>

      <!-- 已結束的比賽把比數放在最顯眼的位置，這是大家點進來最想看的 -->
      <div v-if="isFinished" class="shrink-0 text-right">
        <p class="text-fluid-xl font-bold tabular-nums">
          <span :class="score.our >= score.opponent ? 'text-brand-600 dark:text-brand-300' : ''">
            {{ score.our }}
          </span>
          <span class="mx-1 text-content-muted">:</span>
          <span>{{ score.opponent }}</span>
        </p>
      </div>
      <span
        v-else
        class="shrink-0 text-content-muted transition group-hover:translate-x-0.5 group-hover:text-brand-600"
        aria-hidden="true"
      >
        →
      </span>
    </div>
  </NuxtLink>
</template>
