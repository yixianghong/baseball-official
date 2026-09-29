<script setup lang="ts">
import type { Game } from '#shared/schemas/game'
import {
  deriveBatting,
  derivePitching,
  formatInningsPitched,
  playLogComplete,
  playLogProgress,
  type BattingLine,
} from '#shared/schemas/box-score'

/**
 * 本場的 box score，由逐打席紀錄推導（`shared/schemas/box-score.ts`）。
 *
 * ## ⚠️ 登錄不完整時不顯示打擊率
 * 這是整個功能能不能存在的前提。當初刻意不做結構化的打擊數據，第二個理由
 * 就是「一個少登三場的 `.412` 比沒有數字糟糕得多」（見 `play.ts` 開頭）
 * —— 而這張表會被截圖傳到群組，上面的每個數字都會被當真。
 *
 * 所以完整性是**推導的**（每個打過的半局都登到三出局，見 `playLogComplete()`），
 * 不是一個要人記得勾的旗標；不完整的場次只顯示實際數到的原始數字，
 * 並在表頭說出「本場登錄 N／M 個半局」。
 *
 * ## 沒有「得分（R）」那一欄
 * 要知道是誰跑回本壘，就得記下每一個跑者的推進 —— 那是專業記錄軟體的
 * 工作量，這個球隊沒有記錄員。誠實地少一欄，好過憑空生一個數字。
 *
 * ## ⚠️ 數字的對齊靠表格，不靠 `tabular-nums`
 * 全站的 `--font-display` 是 Oswald，而 **Oswald 沒有等寬數字** ——
 * `font-variant-numeric: tabular-nums` 在它身上完全無效（實測過）。
 * 這裡用 `<table>` 的欄寬對齊，所以沒有受影響。
 */
const props = defineProps<{
  game: Pick<Game, 'plays' | 'homeAway' | 'scoreboard'>
  ourName: string
  opponentName: string
}>()

const batting = computed(() => deriveBatting(props.game))
const pitching = computed(() => derivePitching(props.game))
const complete = computed(() => playLogComplete(props.game))
const progress = computed(() => playLogProgress(props.game))

const hasData = computed(() => batting.value.our.length > 0 || batting.value.opponent.length > 0)

/** 兩邊的打擊表，用同一個元件畫兩次。 */
const sides = computed(() => [
  { key: 'our' as const, name: props.ourName, lines: batting.value.our },
  { key: 'opponent' as const, name: props.opponentName || '對手', lines: batting.value.opponent },
])

/** `.333`（前面不寫 0，這是棒球的寫法）。 */
function formatAvg(avg: number | null): string {
  if (avg === null) return '—'
  return avg.toFixed(3).replace(/^0/, '')
}

function displayName(line: BattingLine): string {
  return line.name || (line.number ? `#${line.number}` : '—')
}
</script>

<template>
  <section v-if="hasData" aria-labelledby="box-score-heading" class="space-y-4">
    <div class="flex flex-wrap items-baseline justify-between gap-2">
      <h2 id="box-score-heading" class="text-fluid-xl font-bold">成績表</h2>

      <!--
        ⚠️ 這一行不能省。沒有它的話，一張只登了四個半局的表看起來和
        完整的那張一模一樣 —— 而讀的人不會知道少了一半。
      -->
      <p v-if="!complete" class="text-fluid-sm text-warning">
        本場登錄 {{ progress.logged }}／{{ progress.played }} 個半局，數字尚未完整，因此不列打擊率。
      </p>
    </div>

    <div v-for="side in sides" :key="side.key" class="space-y-2">
      <h3 class="text-fluid-base font-bold text-content-muted">{{ side.name }}</h3>

      <div v-if="side.lines.length" class="overflow-x-auto">
        <table class="w-full min-w-[34rem] border-collapse text-fluid-sm">
          <caption class="sr-only">
            {{
              side.name
            }}的打擊成績
          </caption>
          <thead>
            <tr class="bg-surface-muted text-content-muted">
              <th scope="col" class="px-3 py-2 text-left font-medium">打者</th>
              <th scope="col" class="w-12 px-1 py-2 font-medium" title="打席">打席</th>
              <th scope="col" class="w-12 px-1 py-2 font-medium" title="打數">打數</th>
              <th scope="col" class="w-12 px-1 py-2 font-medium" title="安打">安打</th>
              <th scope="col" class="w-12 px-1 py-2 font-medium" title="打點">打點</th>
              <th scope="col" class="w-12 px-1 py-2 font-medium" title="四壞球保送">四壞</th>
              <th scope="col" class="w-12 px-1 py-2 font-medium" title="三振">三振</th>
              <th v-if="complete" scope="col" class="w-16 px-1 py-2 font-medium">打擊率</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(line, index) in side.lines"
              :key="`${line.playerId}-${line.number}-${index}`"
              class="border-t border-border"
            >
              <th scope="row" class="px-3 py-2 text-left font-medium">
                <NuxtLink
                  v-if="line.playerId"
                  :to="`/players/${line.playerId}`"
                  class="hover:text-brand-600"
                >
                  <span v-if="line.number" class="mr-1 text-content-muted">#{{ line.number }}</span>
                  {{ displayName(line) }}
                </NuxtLink>
                <!-- 名冊上沒有的人（對手、臨時支援）不連到球員頁 —— 那一頁不存在 -->
                <span v-else>
                  <span v-if="line.number && line.name" class="mr-1 text-content-muted">
                    #{{ line.number }}
                  </span>
                  {{ displayName(line) }}
                </span>
              </th>
              <td class="px-1 py-2 text-center">{{ line.pa }}</td>
              <td class="px-1 py-2 text-center">{{ line.ab }}</td>
              <td class="px-1 py-2 text-center font-bold">{{ line.h }}</td>
              <td class="px-1 py-2 text-center">{{ line.rbi }}</td>
              <td class="px-1 py-2 text-center">{{ line.bb }}</td>
              <td class="px-1 py-2 text-center">{{ line.so }}</td>
              <td v-if="complete" class="px-1 py-2 text-center font-bold">
                {{ formatAvg(line.avg) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p v-else class="text-fluid-sm text-content-muted">還沒有這一隊的逐打席紀錄。</p>
    </div>

    <!--
      投手表只有我隊 —— 對手的投手我們沒有名冊，逐打席上也不記。
      表格結構和打擊一樣，只是欄位不同。
    -->
    <div v-if="pitching.length" class="space-y-2">
      <h3 class="text-fluid-base font-bold text-content-muted">{{ ourName }} 投手</h3>
      <div class="overflow-x-auto">
        <table class="w-full min-w-[26rem] border-collapse text-fluid-sm">
          <caption class="sr-only">
            {{
              ourName
            }}的投手成績
          </caption>
          <thead>
            <tr class="bg-surface-muted text-content-muted">
              <th scope="col" class="px-3 py-2 text-left font-medium">投手</th>
              <th scope="col" class="w-16 px-1 py-2 font-medium" title="投球局數">局數</th>
              <th scope="col" class="w-12 px-1 py-2 font-medium" title="被安打">被安</th>
              <th scope="col" class="w-12 px-1 py-2 font-medium" title="三振">三振</th>
              <th scope="col" class="w-12 px-1 py-2 font-medium" title="四壞球保送">四壞</th>
              <th scope="col" class="w-12 px-1 py-2 font-medium" title="失分">失分</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(line, index) in pitching"
              :key="`${line.playerId}-${index}`"
              class="border-t border-border"
            >
              <th scope="row" class="px-3 py-2 text-left font-medium">
                <NuxtLink
                  v-if="line.playerId"
                  :to="`/players/${line.playerId}`"
                  class="hover:text-brand-600"
                >
                  <span v-if="line.number" class="mr-1 text-content-muted">#{{ line.number }}</span>
                  {{ line.name }}
                </NuxtLink>
                <span v-else>{{ line.name }}</span>
              </th>
              <!--
                「6.2」是六又三分之二局，不是十進位的 6.2 ——
                所以它是字串，不要把兩個投手的局數加起來
              -->
              <td class="px-1 py-2 text-center font-bold">{{ formatInningsPitched(line.outs) }}</td>
              <td class="px-1 py-2 text-center">{{ line.h }}</td>
              <td class="px-1 py-2 text-center">{{ line.so }}</td>
              <td class="px-1 py-2 text-center">{{ line.bb }}</td>
              <td class="px-1 py-2 text-center">{{ line.runs }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <p class="text-xs text-content-muted">
      成績由「逐局紀錄」的逐打席累計而成。不含個人得分與殘壘 ——
      那需要逐一記下跑者的推進，這個球隊沒有記錄員。
    </p>
  </section>
</template>
