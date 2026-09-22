<script setup lang="ts">
import { MAX_GAME_QUERY_LIMIT } from '#shared/schemas/game'
import { clampMonth, formatMonth, toMonthKey } from '~/utils/calendar'
/**
 * 比賽結果。
 *
 * 已結束的場次由新到舊。頂部顯示所選年度的總戰績 —— 這是球隊最在意的
 * 一個數字，不該讓人自己去數。
 */
const today = useToday()
const { data: settings } = await useSiteSettings()

const selectedYear = ref<string>('')
const yearFilter = computed(() => (selectedYear.value ? Number(selectedYear.value) : undefined))

// year 是 ref，改變時 useGames 內部的 computed query 會觸發重新載入
const {
  data: games,
  pending,
  error,
  refresh,
} = await useGames({ scope: 'past', year: yearFilter, limit: MAX_GAME_QUERY_LIMIT })

// 年份選項由目前這批資料推導。第一次載入時沒有篩選，所以拿得到所有年份；
// 之後篩選了年份也不重算，避免選單在選了某一年之後只剩那一年。
const yearOptions = ref<string[]>([])
watchEffect(() => {
  if (yearFilter.value || !games.value) return
  const years = [...new Set(games.value.map((game) => game.date.slice(0, 4)))].sort().reverse()
  yearOptions.value = years
})

const teamName = computed(() => settings.value?.teamName ?? '')

/*
 * ── 月曆 ────────────────────────────────────────────────────────
 *
 * 場次一多，「由新到舊的一長串卡片」就只剩捲動這個找法。球賽是綁在日期上的
 * 事件，人回想的方式是「上個月那場」，月曆正好是這個心智模型。
 *
 * 月曆負責找，下方的卡片負責看細節 —— 只保留當月的場次，不再一次列出全部。
 */
const availableMonths = computed(() => [
  ...new Set((games.value ?? []).map((game) => toMonthKey(game.date))),
])

const selectedMonth = ref('')

/*
 * 預設停在最近有比賽的那個月，並確保選到的月份沒有超出範圍。
 *
 * 用 `watchEffect` 而不是初始化時指定：資料是非同步載入的，建立的當下
 * 還沒有值。切換年度之後原本選的月份可能已經不屬於這一年，也要拉回來。
 *
 * ⚠️ 判斷條件是「超出最早～最晚的範圍」，**不是「這個月有沒有比賽」**。
 * 詳見 `clampMonth()` —— 用後者會讓「上一個月」在遇到空月份時看起來壞掉。
 */
watchEffect(() => {
  selectedMonth.value = clampMonth(selectedMonth.value, availableMonths.value)
})

/** 當月的場次，由新到舊。 */
const monthGames = computed(() =>
  (games.value ?? []).filter((game) => toMonthKey(game.date) === selectedMonth.value),
)

const record = computed(() => {
  // 延賽的場次也列在這一頁，但它沒有打成，不該算進戰績的場次數
  const played = (games.value ?? []).filter((game) => game.status === 'finished')
  return {
    win: played.filter((game) => game.result === 'win').length,
    loss: played.filter((game) => game.result === 'loss').length,
    tie: played.filter((game) => game.result === 'tie').length,
    total: played.length,
  }
})

/** 列在這一頁但沒打成的場次數，顯示在戰績旁邊當註記。 */
const postponedCount = computed(
  () => (games.value ?? []).filter((game) => game.status === 'postponed').length,
)

useHead({ title: '比賽結果' })
</script>

<template>
  <div>
    <CommonPageHero
      en="RESULTS"
      zh="比賽結果"
      description="點擊任一場比賽可查看當天打線與計分板。"
    />

    <div class="container-content py-12 md:py-16">
      <div v-if="yearOptions.length > 1" class="mb-6 w-40">
        <UiBaseSelect
          v-model="selectedYear"
          label="年度"
          placeholder="全部年度"
          :options="yearOptions.map((year) => ({ value: year, label: `${year} 年` }))"
        />
      </div>

      <div
        v-if="record.total"
        class="mb-6 flex flex-wrap items-center gap-x-8 gap-y-2 rounded-xl border border-border bg-surface-muted px-5 py-4"
      >
        <p class="text-fluid-sm text-content-muted">
          {{ selectedYear ? `${selectedYear} 年` : '累計' }}戰績
        </p>
        <p class="flex items-baseline gap-4 text-fluid-lg font-bold tabular-nums">
          <span class="text-accent-700 dark:text-accent-400">{{ record.win }} 勝</span>
          <span class="text-danger">{{ record.loss }} 敗</span>
          <span v-if="record.tie" class="text-content-muted">{{ record.tie }} 和</span>
        </p>
        <p class="text-fluid-sm text-content-muted">
          共 {{ record.total }} 場
          <span v-if="postponedCount">（另有 {{ postponedCount }} 場因雨延賽）</span>
        </p>
      </div>

      <UiBaseSpinner v-if="pending" label="比賽結果載入中…" />

      <UiBaseError v-else-if="error" :error="error" @retry="refresh" />

      <template v-else-if="games?.length">
        <GameCalendar
          v-model:month="selectedMonth"
          class="mb-6"
          :games="games"
          :available-months="availableMonths"
        />

        <h2 class="mb-4 text-fluid-lg font-bold">
          {{ formatMonth(selectedMonth) }}
          <span class="ml-1 text-fluid-sm font-normal text-content-muted">
            {{ monthGames.length }} 場
          </span>
        </h2>

        <div v-if="monthGames.length" class="grid gap-4 md:grid-cols-2">
          <GameCard
            v-for="(game, index) in monthGames"
            :key="game.id"
            v-reveal="(index % 2) * 90"
            class="reveal"
            :game="game"
            :our-name="teamName"
            :today="today"
          />
        </div>

        <p v-else class="text-fluid-sm text-content-muted">這個月沒有比賽。</p>
      </template>

      <UiBaseEmpty
        v-else
        title="還沒有比賽結果"
        description="比賽結束後，戰績與計分板會顯示在這裡。"
        icon="🏆"
      />
    </div>
  </div>
</template>
