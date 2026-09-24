<script setup lang="ts">
import type { WeatherResult } from '#shared/schemas/weather'
import type { Game } from '#shared/schemas/game'
import {
  GAME_RESULT_LABELS,
  GAME_STATUS_LABELS,
  gameResult,
  hasScore,
  isNotPlayed,
} from '#shared/schemas/game'
import { describeCountdown, daysUntil, formatGameDate } from '~/utils/format'

/**
 * 賽程／結果卡片。近期賽程、比賽結果、首頁都用同一個元件。
 *
 * 三種比賽要強調的資訊不同：
 * - **未來**：什麼時候、還有幾天、在哪裡打
 * - **進行中**：現在幾比幾（LIVE）
 * - **過去**：贏了還是輸了、比數多少（FINAL）
 *
 * 用同一個元件並依 `status` 切換，而不是寫兩個長得很像的元件 ——
 * 卡片的外框、間距、hover 行為只需要維護一份。
 */
const props = defineProps<{
  /** 這場比賽的天氣。只有未開打的場次才有意義，過去的比賽不必傳。 */
  weather?: WeatherResult | null
  game: Game
  /** 我隊名稱，用於顯示對戰組合。 */
  ourName: string
  /** `YYYY-MM-DD` 的今天，由頁面傳入以避免 SSR 與瀏覽器算出不同結果。 */
  today: string
}>()

const isFinished = computed(() => props.game.status === 'finished')
const isLive = computed(() => props.game.status === 'live')
/** 進行中與已結束都有比數可看；延賽與取消沒有打成，不該顯示比數。 */
const showScore = computed(() => hasScore(props.game))
const notPlayed = computed(() => isNotPlayed(props.game))

/** 勝敗是推導的，不是存下來的欄位 —— 只有結束的比賽才有值。 */
const result = computed(() => gameResult(props.game))

const countdown = computed(() => describeCountdown(daysUntil(props.game.date, props.today)))

const resultTone = computed(() => {
  // 勝場用隊徽的金色而不是綠色：綠與品牌 teal 太接近，一排卡片掃過去
  // 會分不出哪個是隊色、哪個是「贏了」。
  if (result.value === 'win') return 'accent' as const
  if (result.value === 'loss') return 'danger' as const
  return 'neutral' as const
})

/**
 * 左側的狀態色條。
 *
 * 首頁的「下一場比賽」本來就用這個手法（左邊一條品牌色），但賽程／結果的
 * 卡片只有一圈灰邊 —— 兩種卡片語言擺在同一頁上看起來像兩個網站拼起來的。
 * 統一之後，色條順便帶了資訊：掃過一排卡片就知道哪場贏、哪場輸、哪場還沒打。
 *
 * 顏色沿用 `resultTone` 的同一套語彙（勝場用金色而不是綠色，理由見上面）。
 */
const accentClass = computed(() => {
  if (notPlayed.value) return 'border-l-warning'
  // 進行中用紅色，和 LIVE 標籤同一個顏色 —— 一排賽程卡片裡它要最先被看到
  if (isLive.value) return 'border-l-danger'
  if (!isFinished.value) return 'border-l-brand-600'
  if (result.value === 'win') return 'border-l-accent-500'
  if (result.value === 'loss') return 'border-l-danger'
  return 'border-l-border'
})

const score = computed(() => ({
  our: props.game.scoreboard.totals.our.r,
  opponent: props.game.scoreboard.totals.opponent.r,
}))
</script>

<template>
  <NuxtLink
    :to="`/games/${game.id}`"
    class="surface-card lift group flex flex-col gap-3 rounded-xl border border-l-4 border-border bg-surface-raised p-5"
    :class="accentClass"
  >
    <div class="flex items-start justify-between gap-3">
      <div class="flex items-center gap-2">
        <span class="text-fluid-lg font-bold tabular-nums">{{ formatGameDate(game.date) }}</span>
        <span class="text-fluid-sm text-content-muted tabular-nums">{{ game.time }}</span>
      </div>

      <UiBaseBadge v-if="notPlayed" :tone="game.status === 'postponed' ? 'warning' : 'neutral'">
        {{ GAME_STATUS_LABELS[game.status] }}
      </UiBaseBadge>
      <GameLiveBadge v-else-if="isLive" />
      <UiBaseBadge v-else-if="result" :tone="resultTone">
        {{ GAME_RESULT_LABELS[result] }}
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
          <!-- 已經開打的比賽不顯示「預報」，那沒有意義 -->
          <GameWeather v-if="!showScore && !notPlayed" :weather="weather ?? null" variant="mini" />
        </p>
      </div>

      <!-- 開打之後比數就是最重要的資訊，放在最顯眼的位置 -->
      <div v-if="showScore" class="shrink-0 text-right">
        <!--
          「FINAL」是給已結束的場次的：少了它，一個停在 3:2 的比數看不出來
          是打完了還是正在打。進行中的場次不重複寫 LIVE —— 右上角已經有了。
        -->
        <p v-if="isFinished" class="text-[0.65rem] font-bold tracking-widest text-content-muted">
          FINAL
        </p>
        <p
          class="text-fluid-xl font-bold tabular-nums"
          :class="isLive ? 'text-danger' : ''"
          :aria-label="`比數 ${score.our} 比 ${score.opponent}`"
        >
          <span
            :class="
              !isLive && score.our >= score.opponent ? 'text-brand-600 dark:text-brand-300' : ''
            "
          >
            {{ score.our }}
          </span>
          <span class="mx-1" :class="isLive ? 'text-danger/60' : 'text-content-muted'">:</span>
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
