<script setup lang="ts">
import type { HomeAway, Scoreboard } from '#shared/schemas/game'
import { scoreboardSides, sumInnings } from '#shared/schemas/game'

/**
 * 計分板。
 *
 * ## 上下半局是算出來的，不是存出來的
 * 資料層存的是「我隊／對手」各局得分（見 `shared/schemas/game.ts` 的說明），
 * 但計分板的呈現慣例是「上面那列是先攻（客隊）」。排序走共用的
 * `scoreboardSides()` —— 同一份資料，換個主客場就換個順序，
 * 不需要在資料庫裡存兩份，**後台的編輯器也用同一支函式**。
 *
 * ## `null` 顯示為 `X`
 * 後攻方領先時最後半局不用打，那一格是 `X` 而不是 `0`。
 * 這個區別對看得懂計分板的人來說很重要，所以刻意保留。
 *
 * ## 手機上的處理
 * 局數多的時候表格一定超出螢幕寬度。左側隊名欄用 `sticky` 釘住，
 * 其餘橫向捲動 —— 這比把字縮到看不見好。
 */
const props = defineProps<{
  scoreboard: Scoreboard
  homeAway: HomeAway
  ourName: string
  opponentName: string
}>()

/**
 * 由上而下的兩列，上面那列是先攻。
 *
 * 排序走共用的 `scoreboardSides()` —— 後台的編輯器用的是同一支，
 * 兩邊各寫各的就會出現「同一場比賽在後台與前台順序相反」。
 */
const rows = computed(() =>
  scoreboardSides(props.homeAway).map((side) => ({
    key: side,
    name: side === 'our' ? props.ourName : props.opponentName,
    isOurs: side === 'our',
    scores: props.scoreboard.innings.map((inning) => inning[side]),
    totals: props.scoreboard.totals[side],
  })),
)

const innings = computed(() => props.scoreboard.innings.map((inning) => inning.inning))

/**
 * 逐局加總與總分不一致時提醒。
 *
 * 多半發生在 AI 辨識之後沒有核對，或手動輸入時漏了一格。
 * 與其安靜地顯示一個錯的計分板，不如把它指出來。
 */
const mismatch = computed(() => {
  const sums = sumInnings(props.scoreboard)
  return (
    sums.our !== props.scoreboard.totals.our.r ||
    sums.opponent !== props.scoreboard.totals.opponent.r
  )
})
</script>

<template>
  <div class="space-y-2">
    <div class="overflow-x-auto rounded-xl border border-border">
      <table class="w-full min-w-max border-collapse text-center text-fluid-sm">
        <caption class="sr-only">
          比賽計分板，各局得分與總計
        </caption>
        <thead>
          <tr class="bg-surface-muted">
            <th
              scope="col"
              class="sticky left-0 z-10 bg-surface-muted px-4 py-2.5 text-left font-semibold"
            >
              球隊
            </th>
            <th
              v-for="inning in innings"
              :key="inning"
              scope="col"
              class="w-10 px-2 py-2.5 font-semibold"
            >
              {{ inning }}
            </th>
            <th scope="col" class="w-12 border-l border-border px-2 py-2.5 font-bold">R</th>
            <th scope="col" class="w-12 px-2 py-2.5 font-semibold">H</th>
            <th scope="col" class="w-12 px-2 py-2.5 font-semibold">E</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in rows"
            :key="row.key"
            class="border-t border-border"
            :class="row.isOurs ? 'bg-brand-600/5' : ''"
          >
            <th
              scope="row"
              class="sticky left-0 z-10 max-w-[10rem] truncate px-4 py-2.5 text-left font-semibold"
              :class="
                row.isOurs ? 'bg-brand-600/5 text-brand-600 dark:text-brand-300' : 'bg-surface'
              "
            >
              {{ row.name }}
            </th>
            <td v-for="(score, index) in row.scores" :key="index" class="px-2 py-2.5 tabular-nums">
              <!-- null = 該半局沒有進行（例如後攻方已領先），計分板慣例寫 X -->
              <span v-if="score === null" class="text-content-muted">X</span>
              <span v-else>{{ score }}</span>
            </td>
            <td class="border-l border-border px-2 py-2.5 text-fluid-base font-bold tabular-nums">
              {{ row.totals.r }}
            </td>
            <td class="px-2 py-2.5 tabular-nums">{{ row.totals.h }}</td>
            <td class="px-2 py-2.5 tabular-nums">{{ row.totals.e }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <p v-if="mismatch" class="text-xs text-warning">
      提醒：逐局得分的加總與總分（R）不一致，請確認記錄是否有誤。
    </p>
  </div>
</template>
