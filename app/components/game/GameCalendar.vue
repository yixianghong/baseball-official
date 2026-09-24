<script setup lang="ts">
import type { Game } from '#shared/schemas/game'
import { GAME_STATUS_LABELS, gameResult, isNotPlayed } from '#shared/schemas/game'
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

/*
 * ── 年月選擇器 ──────────────────────────────────────────────────
 *
 * 點標題直接選年月。場次橫跨好幾年之後，一個月一個月按會按到天荒地老，
 * 而下拉選單只列得出「有比賽的月份」—— 使用者想去的可能是中間的空月份。
 *
 * 超出範圍的年月一律停用而不是讓人點了再彈回來：點得下去卻沒反應，
 * 跟按鈕壞掉沒有兩樣（這個坑剛踩過）。
 */
const pickerOpen = ref(false)
const pickerYear = ref(0)
const pickerRef = ref<HTMLElement | null>(null)

onClickOutside(pickerRef, () => (pickerOpen.value = false))
onKeyStroke('Escape', () => (pickerOpen.value = false))

function togglePicker() {
  pickerOpen.value = !pickerOpen.value
  // 每次打開都從目前所在的年份開始，而不是停在上次翻到的地方
  if (pickerOpen.value) pickerYear.value = Number(props.month.slice(0, 4))
}

/** 最早～最晚之間的所有年份（含中間完全沒比賽的年）。 */
const years = computed(() => {
  const sorted = [...props.availableMonths].sort()
  const first = Number((sorted[0] ?? props.month).slice(0, 4))
  const last = Number((sorted.at(-1) ?? props.month).slice(0, 4))
  return Array.from({ length: Math.max(1, last - first + 1) }, (_, i) => first + i)
})

const canPrevYear = computed(() => pickerYear.value > (years.value[0] ?? 0))
const canNextYear = computed(() => pickerYear.value < (years.value.at(-1) ?? 0))

/** 每個月有幾場，選擇器上用小圓點標出來。 */
const countByMonth = computed(() => {
  const map = new Map<string, number>()
  for (const game of props.games) {
    const key = toMonthKey(game.date)
    map.set(key, (map.get(key) ?? 0) + 1)
  }
  return map
})

/** 選擇器上的 12 個月。 */
const pickerMonths = computed(() =>
  Array.from({ length: 12 }, (_, i) => {
    const key = `${pickerYear.value}-${String(i + 1).padStart(2, '0')}`
    return {
      key,
      label: `${i + 1} 月`,
      count: countByMonth.value.get(key) ?? 0,
      // 超出「最早～最晚」的範圍就選不了，選了也只會被 clampMonth 拉回來
      selectable: key >= bounds.value.first && key <= bounds.value.last,
      current: key === props.month,
    }
  }),
)

function pick(key: string) {
  emit('update:month', key)
  pickerOpen.value = false
}

/** 格子上小圓點的顏色。與賽程卡左側的色條同一套語彙。 */
function dotClass(game: Game): string {
  if (isNotPlayed(game)) return 'bg-warning'
  const result = gameResult(game)
  if (result === 'win') return 'bg-accent-500'
  if (result === 'loss') return 'bg-danger'
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
  <div class="surface-card rounded-xl border border-border bg-surface-raised p-4 md:p-5">
    <!-- ══ 月份導覽 ═════════════════════════════════════════════ -->
    <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div ref="pickerRef" class="relative flex items-center gap-1">
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

        <!-- 標題本身是按鈕：點了直接選年月 -->
        <button
          type="button"
          class="flex min-h-9 min-w-32 items-center justify-center gap-1 rounded-lg px-2 text-fluid-lg font-bold tabular-nums transition hover:bg-surface-muted"
          :aria-expanded="pickerOpen"
          aria-haspopup="dialog"
          @click="togglePicker"
        >
          {{ formatMonth(month) }}
          <svg
            class="size-4 shrink-0 text-content-muted transition"
            :class="pickerOpen ? 'rotate-180' : ''"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M12 15.4 5.3 8.7a1 1 0 0 1 1.4-1.4l5.3 5.3 5.3-5.3a1 1 0 1 1 1.4 1.4Z" />
          </svg>
        </button>

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

        <!-- ══ 年月選擇器 ═══════════════════════════════════════ -->
        <div
          v-if="pickerOpen"
          class="surface-card absolute top-full left-0 z-30 mt-2 w-72 rounded-xl border border-border bg-surface-raised p-3"
          role="dialog"
          aria-label="選擇年月"
        >
          <div class="mb-2 flex items-center justify-between">
            <button
              type="button"
              class="flex size-8 items-center justify-center rounded-lg border border-border transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40"
              :disabled="!canPrevYear"
              aria-label="上一年"
              @click="pickerYear -= 1"
            >
              <svg class="size-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path
                  d="M15.4 4.6a1 1 0 0 1 0 1.4L9.4 12l6 6a1 1 0 1 1-1.4 1.4l-6.7-6.7a1 1 0 0 1 0-1.4L14 4.6a1 1 0 0 1 1.4 0Z"
                />
              </svg>
            </button>

            <p class="text-fluid-base font-bold tabular-nums">{{ pickerYear }} 年</p>

            <button
              type="button"
              class="flex size-8 items-center justify-center rounded-lg border border-border transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40"
              :disabled="!canNextYear"
              aria-label="下一年"
              @click="pickerYear += 1"
            >
              <svg class="size-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path
                  d="M8.6 4.6a1 1 0 0 0 0 1.4l6 6-6 6a1 1 0 1 0 1.4 1.4l6.7-6.7a1 1 0 0 0 0-1.4L10 4.6a1 1 0 0 0-1.4 0Z"
                />
              </svg>
            </button>
          </div>

          <!--
            12 個月一次攤開。小圓點代表那個月有比賽 —— 沒有點的月份照樣選得進去
            （球隊整個月沒出賽很正常），只有超出「最早～最晚」範圍的才停用。
            點得下去卻沒反應跟按鈕壞掉沒有兩樣，這個坑剛踩過。
          -->
          <div class="grid grid-cols-4 gap-1">
            <button
              v-for="item in pickerMonths"
              :key="item.key"
              type="button"
              class="flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-lg border text-fluid-sm font-medium transition disabled:cursor-not-allowed disabled:border-transparent disabled:opacity-30"
              :class="
                item.current
                  ? 'border-brand-600 bg-brand-600/10 font-bold text-brand-700 dark:text-brand-300'
                  : 'border-transparent hover:bg-surface-muted'
              "
              :disabled="!item.selectable"
              :aria-current="item.current ? 'true' : undefined"
              @click="pick(item.key)"
            >
              {{ item.label }}
              <span
                class="size-1 rounded-full"
                :class="item.count ? 'bg-accent-500' : 'bg-transparent'"
                aria-hidden="true"
              />
              <span v-if="item.count" class="sr-only">{{ item.count }} 場</span>
            </button>
          </div>
        </div>
      </div>
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
