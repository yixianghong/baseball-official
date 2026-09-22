<script setup lang="ts">
import type { Scoreboard } from '#shared/schemas/game'
import { emptyScoreboard, sumInnings } from '#shared/schemas/game'
import { LOW_CONFIDENCE_THRESHOLD } from '#shared/schemas/ai'
import { ApiError } from '~/utils/api-error'

/**
 * 計分板編輯器 —— 支援用照片自動辨識。
 *
 * ## AI 只是把數字填進表單
 * 「辨識」按鈕做的事是：把照片送去 Gemini、拿回逐局得分、**填進下面的欄位**。
 * 它不會儲存任何東西。使用者核對、修改之後按頁面上的「儲存」才會寫入。
 *
 * 後端會驗算「逐局加總 = 總分」，對不起來就降低信心值並附上說明 ——
 * 這是計分板辨識最常出錯的地方，也是最容易被忽略的地方。
 *
 * ## 空格與 0 的差別
 * 欄位留空代表「該半局沒有進行」（顯示為 X），輸入 0 代表「打了但沒得分」。
 * 這在計分板上是兩件完全不同的事，所以輸入介面也保留這個區別。
 */
const props = defineProps<{
  ourName: string
  opponentName: string
  /** 送給 AI 比對「哪一列是我隊」的隊名清單。 */
  teamNames: string[]
}>()

const model = defineModel<Scoreboard>({ required: true })

const { parseScoreboard, loading: aiLoading } = useAiActions()
const fileInput = ref<HTMLInputElement | null>(null)
const aiMessage = ref('')
const aiWarnings = ref<string[]>([])
const aiConfidence = ref<number | null>(null)

const innings = computed(() => model.value.innings)

const sums = computed(() => sumInnings(model.value))
const mismatch = computed(
  () =>
    sums.value.our !== model.value.totals.our.r ||
    sums.value.opponent !== model.value.totals.opponent.r,
)

function ensureBoard() {
  if (model.value.innings.length === 0) {
    model.value = emptyScoreboard(7)
  }
}

function addInning() {
  if (model.value.innings.length >= 20) return
  model.value = {
    ...model.value,
    innings: [
      ...model.value.innings,
      { inning: model.value.innings.length + 1, our: null, opponent: null },
    ],
  }
}

function removeInning() {
  if (model.value.innings.length <= 1) return
  model.value = { ...model.value, innings: model.value.innings.slice(0, -1) }
}

/** 空字串 → null（該半局沒打）；其餘轉成 0～99 的整數。 */
function setScore(index: number, side: 'our' | 'opponent', raw: string) {
  const value = raw === '' ? null : Math.min(Math.max(Math.round(Number(raw)), 0), 99)
  const next = [...model.value.innings]
  const inning = next[index]
  if (!inning) return
  next[index] = { ...inning, [side]: Number.isNaN(value) ? null : value }
  model.value = { ...model.value, innings: next }
}

function setTotal(side: 'our' | 'opponent', field: 'r' | 'h' | 'e', raw: string) {
  const value = Math.min(Math.max(Math.round(Number(raw) || 0), 0), 999)
  model.value = {
    ...model.value,
    totals: { ...model.value.totals, [side]: { ...model.value.totals[side], [field]: value } },
  }
}

/** 把逐局加總寫進 R。手動輸入完之後按一下就好，不必自己加。 */
function applySums() {
  model.value = {
    ...model.value,
    totals: {
      our: { ...model.value.totals.our, r: sums.value.our },
      opponent: { ...model.value.totals.opponent, r: sums.value.opponent },
    },
  }
}

async function handleFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  aiMessage.value = ''
  aiWarnings.value = []
  aiConfidence.value = null

  try {
    const result = await parseScoreboard(file, props.teamNames)

    model.value = {
      innings: result.innings.length ? result.innings : model.value.innings,
      totals: result.totals,
    }
    aiWarnings.value = result.warnings
    aiConfidence.value = result.confidence
    aiMessage.value = result.opponentName
      ? `已辨識完成，圖片中的對手為「${result.opponentName}」。請核對後再儲存。`
      : '已辨識完成，請核對後再儲存。'
  } catch (err) {
    aiMessage.value =
      err instanceof Error && !(err instanceof ApiError) ? err.message : ApiError.from(err).message
  } finally {
    input.value = ''
  }
}
</script>

<template>
  <div class="space-y-4">
    <!-- ── AI 辨識 ─────────────────────────────────────────────── -->
    <div class="rounded-xl border border-dashed border-brand-300 bg-brand-600/5 p-4">
      <div class="flex flex-wrap items-center gap-3">
        <div class="min-w-0 flex-1">
          <p class="font-medium">用照片自動填入</p>
          <p class="mt-0.5 text-fluid-sm text-content-muted">
            上傳計分板照片，系統會讀出逐局得分與 R／H／E 填進下方欄位，儲存前仍可修改。
          </p>
        </div>
        <UiBaseButton :loading="aiLoading" @click="fileInput?.click()">
          {{ aiLoading ? '辨識中…' : '選擇計分板照片' }}
        </UiBaseButton>
        <input ref="fileInput" type="file" accept="image/*" class="hidden" @change="handleFile" />
      </div>

      <p v-if="aiLoading" class="mt-3 text-fluid-sm text-content-muted">
        辨識通常需要 10～30 秒，請不要關閉頁面。
      </p>

      <p v-if="aiMessage" class="mt-3 text-fluid-sm">{{ aiMessage }}</p>

      <p
        v-if="aiConfidence !== null && aiConfidence < LOW_CONFIDENCE_THRESHOLD"
        class="mt-2 rounded-lg bg-warning/15 px-3 py-2 text-fluid-sm text-warning"
      >
        辨識信心偏低（{{ Math.round(aiConfidence * 100) }}%），請仔細核對每一格數字。
      </p>

      <ul v-if="aiWarnings.length" class="mt-2 space-y-1">
        <li v-for="warning in aiWarnings" :key="warning" class="text-fluid-sm text-warning">
          ・{{ warning }}
        </li>
      </ul>
    </div>

    <!-- ── 手動編輯 ───────────────────────────────────────────── -->
    <div v-if="!innings.length" class="flex justify-center">
      <UiBaseButton variant="secondary" @click="ensureBoard">建立計分板（7 局）</UiBaseButton>
    </div>

    <template v-else>
      <div class="overflow-x-auto rounded-xl border border-border">
        <table class="w-full min-w-max border-collapse text-center text-fluid-sm">
          <thead>
            <tr class="bg-surface-muted">
              <th scope="col" class="sticky left-0 z-10 bg-surface-muted px-3 py-2 text-left">
                球隊
              </th>
              <th v-for="inning in innings" :key="inning.inning" scope="col" class="w-14 px-1 py-2">
                {{ inning.inning }}
              </th>
              <th scope="col" class="w-16 border-l border-border px-1 py-2 font-bold">R</th>
              <th scope="col" class="w-16 px-1 py-2">H</th>
              <th scope="col" class="w-16 px-1 py-2">E</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="side in ['our', 'opponent'] as const"
              :key="side"
              class="border-t border-border"
            >
              <th
                scope="row"
                class="sticky left-0 z-10 max-w-40 truncate bg-surface px-3 py-2 text-left font-semibold"
              >
                {{ side === 'our' ? ourName : opponentName || '對手' }}
              </th>

              <td v-for="(inning, index) in innings" :key="inning.inning" class="px-1 py-1.5">
                <input
                  :value="inning[side] === null ? '' : inning[side]"
                  type="number"
                  min="0"
                  max="99"
                  placeholder="X"
                  :aria-label="`${side === 'our' ? ourName : opponentName} 第 ${inning.inning} 局得分`"
                  class="h-10 w-12 rounded-lg border border-border bg-surface text-center tabular-nums"
                  @input="setScore(index, side, ($event.target as HTMLInputElement).value)"
                />
              </td>

              <td class="border-l border-border px-1 py-1.5">
                <input
                  :value="model.totals[side].r"
                  type="number"
                  min="0"
                  :aria-label="`${side === 'our' ? ourName : opponentName} 總得分`"
                  class="h-10 w-14 rounded-lg border border-border bg-surface text-center font-bold tabular-nums"
                  @input="setTotal(side, 'r', ($event.target as HTMLInputElement).value)"
                />
              </td>
              <td class="px-1 py-1.5">
                <input
                  :value="model.totals[side].h"
                  type="number"
                  min="0"
                  :aria-label="`${side === 'our' ? ourName : opponentName} 安打數`"
                  class="h-10 w-14 rounded-lg border border-border bg-surface text-center tabular-nums"
                  @input="setTotal(side, 'h', ($event.target as HTMLInputElement).value)"
                />
              </td>
              <td class="px-1 py-1.5">
                <input
                  :value="model.totals[side].e"
                  type="number"
                  min="0"
                  :aria-label="`${side === 'our' ? ourName : opponentName} 失誤數`"
                  class="h-10 w-14 rounded-lg border border-border bg-surface text-center tabular-nums"
                  @input="setTotal(side, 'e', ($event.target as HTMLInputElement).value)"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <UiBaseButton variant="secondary" size="sm" @click="addInning">＋ 延長一局</UiBaseButton>
        <UiBaseButton variant="ghost" size="sm" @click="removeInning">－ 減少一局</UiBaseButton>
        <UiBaseButton variant="ghost" size="sm" @click="applySums">
          用逐局加總填入 R（{{ sums.our }} : {{ sums.opponent }}）
        </UiBaseButton>
      </div>

      <p v-if="mismatch" class="rounded-lg bg-warning/15 px-3 py-2 text-fluid-sm text-warning">
        逐局加總（{{ sums.our }} : {{ sums.opponent }}）與總分 R（{{ model.totals.our.r }} :
        {{ model.totals.opponent.r }}）不一致。若是因為沒有逐局紀錄可以忽略，否則請修正。
      </p>

      <p class="text-xs text-content-muted">
        提示：欄位留空代表該半局沒有進行（顯示為 X），輸入 0 代表打了但沒有得分。
      </p>
    </template>
  </div>
</template>
