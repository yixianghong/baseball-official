<script setup lang="ts">
import type { Game } from '#shared/schemas/game'
import { GAME_STATUS_LABELS, isNotPlayed } from '#shared/schemas/game'
import {
  buildMonthGrid,
  formatMonth,
  shiftMonth,
  toMonthKey,
  WEEKDAY_LABELS,
} from '~/utils/calendar'

/**
 * 比賽月曆。
 *
 * ## 為什麼結果頁需要月曆
 * 場次一多，「由新到舊的一長串卡片」就只剩下捲動這個找法 —— 想找某場特定的
 * 比賽，得記得它大概是第幾張。而球賽是**綁在日期上**的事件，人回想的方式是
 * 「上個月那場」「暑假那場」，月曆正好是這個心智模型。
 *
 * ## 格子本身就是連結
 * 有比賽的日子直接連到那場比賽，不必先選日期再點卡片。一天有多場時
 * 連到第一場，其餘在下方的列表裡。
 */
const props = defineProps<{
  games: Game[]
  /** 目前顯示的月份，`YYYY-MM`。 */
  month: string
  /** 可選的月份範圍（用來停用超出範圍的上／下一月）。 */
  availableMonths: string[]
}>()

const emit = defineEmits<{ 'update:month': [string] }>()

const cells = computed(() => buildMonthGrid(props.month))

/** 日期 → 那天的比賽。同一天可能有兩場（雙重賽）。 */
const byDate = computed(() => {
  const map = new Map<string, Game[]>()
  for (const game of props.games) {
    const list = map.get(game.date) ?? []
    list.push(game)
    map.set(game.date, list)
  }
  return map
})

const bounds = computed(() => {
  const sorted = [...props.availableMonths].sort()
  return { first: sorted[0] ?? props.month, last: sorted.at(-1) ?? props.month }
})

const canGoPrev = computed(() => props.month > bounds.value.first)
const canGoNext = computed(() => props.month < bounds.value.last)

/** 每個月有幾場，給快速跳轉的選單用。場次一多，一個月一個月按太慢。 */
const monthOptions = computed(() =>
  [...props.availableMonths]
    .sort()
    .reverse()
    .map((key) => {
      const count = props.games.filter((game) => toMonthKey(game.date) === key).length
      return { value: key, label: `${formatMonth(key)}（${count} 場）` }
    }),
)

/** 格子上小圓點的顏色。與賽程卡左側的色條同一套語彙。 */
function dotClass(game: Game): string {
  if (isNotPlayed(game)) return 'bg-warning'
  if (game.result === 'win') return 'bg-accent-500'
  if (game.result === 'loss') return 'bg-danger'
  return 'bg-content-muted'
}

function describe(games: Game[]): string {
  const first = games[0]!
  const status = isNotPlayed(first) ? GAME_STATUS_LABELS[first.status] : ''
  const score = isNotPlayed(first)
    ? ''
    : `${first.scoreboard.totals.our.r}:${first.scoreboard.totals.opponent.r}`
  return [`vs ${first.opponent}`, score, status].filter(Boolean).join(' ')
}
</script>

<template>
  <div class="rounded-xl border border-border bg-surface-raised p-4 md:p-5">
    <!-- ══ 月份導覽 ═════════════════════════════════════════════ -->
    <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div class="flex items-center gap-1">
        <button
          type="button"
          class="flex size-9 items-center justify-center rounded-lg border border-border transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="!canGoPrev"
          aria-label="上一個月"
          @click="emit('update:month', shiftMonth(month, -1))"
        >
          <svg class="size-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path
              d="M15.4 4.6a1 1 0 0 1 0 1.4L9.4 12l6 6a1 1 0 1 1-1.4 1.4l-6.7-6.7a1 1 0 0 1 0-1.4L14 4.6a1 1 0 0 1 1.4 0Z"
            />
          </svg>
        </button>

        <p class="min-w-32 text-center text-fluid-lg font-bold tabular-nums">
          {{ formatMonth(month) }}
        </p>

        <button
          type="button"
          class="flex size-9 items-center justify-center rounded-lg border border-border transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="!canGoNext"
          aria-label="下一個月"
          @click="emit('update:month', shiftMonth(month, 1))"
        >
          <svg class="size-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path
              d="M8.6 4.6a1 1 0 0 0 0 1.4l6 6-6 6a1 1 0 1 0 1.4 1.4l6.7-6.7a1 1 0 0 0 0-1.4L10 4.6a1 1 0 0 0-1.4 0Z"
            />
          </svg>
        </button>
      </div>

      <!-- 比賽稀疏時一個月一個月按太慢，給一個直接跳的選單 -->
      <UiBaseSelect
        v-if="monthOptions.length > 1"
        :model-value="month"
        label=""
        class="w-48"
        :options="monthOptions"
        @update:model-value="emit('update:month', String($event))"
      />
    </div>

    <!-- ══ 月曆 ═════════════════════════════════════════════════ -->
    <div class="grid grid-cols-7 gap-1 text-center">
      <p
        v-for="label in WEEKDAY_LABELS"
        :key="label"
        class="py-1 text-xs font-semibold text-content-muted"
      >
        {{ label }}
      </p>

      <template v-for="cell in cells" :key="cell.date">
        <!-- 有比賽：整格是連結 -->
        <NuxtLink
          v-if="cell.inMonth && byDate.get(cell.date)?.length"
          :to="`/games/${byDate.get(cell.date)![0]!.id}`"
          class="flex min-h-14 flex-col items-center justify-center gap-1 rounded-lg border border-brand-600/40 bg-brand-600/5 transition hover:border-brand-500 hover:bg-brand-600/10"
          :title="describe(byDate.get(cell.date)!)"
        >
          <span class="text-fluid-sm font-bold tabular-nums">{{ cell.day }}</span>
          <span class="flex gap-0.5">
            <span
              v-for="game in byDate.get(cell.date)"
              :key="game.id"
              class="size-1.5 rounded-full"
              :class="dotClass(game)"
            />
          </span>
          <span class="sr-only">{{ describe(byDate.get(cell.date)!) }}</span>
        </NuxtLink>

        <!-- 沒有比賽：只是一個日期 -->
        <p
          v-else
          class="flex min-h-14 items-center justify-center text-fluid-sm tabular-nums"
          :class="cell.inMonth ? 'text-content-muted' : 'text-content-muted/35'"
        >
          {{ cell.day }}
        </p>
      </template>
    </div>
  </div>
</template>
