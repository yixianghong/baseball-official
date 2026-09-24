<script setup lang="ts">
import type { Scoreboard } from '#shared/schemas/game'
import { emptyScoreboard, sumInnings, withSummedRuns } from '#shared/schemas/game'
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
 *
 * ## R 不能輸入
 * 總得分一律是逐局加總（`withSummedRuns()`），所以它是一格唯讀的數字而不是
 * 輸入框。這裡曾經有一顆「用逐局加總填入 R」的按鈕 —— 那等於把「保持一致」
 * 外包給使用者記得按，沒按的下場是逐局 3:1、R 欄 0:0，而前台的比數、勝敗、
 * 戰績全部讀 R。H／E 沒有逐局欄位可以加總，所以維持人工輸入。
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

/**
 * 畫面上顯示的 R。
 *
 * 直接算逐局加總而不是讀 `model.totals`：載入的資料如果是這條規則之前寫進去的，
 * 兩者可能對不上，而這一格要顯示的是**現在這張表算出來的數字**。
 */
const runs = computed(() => sumInnings(model.value))

/**
 * 所有改動都經過這裡，順手把 R 對齊逐局。
 *
 * 不這麼做的話，`model` 裡的 R 會停在舊值 —— 畫面上的 R 是算出來的（看起來
 * 沒問題），送出去的卻是舊的那一個。repository 也會再保證一次，但那是為了
 * AI 與批次匯入等其他入口；表單自己送出的內容本來就該是對的。
 */
function update(next: Scoreboard) {
  model.value = withSummedRuns(next)
}

function ensureBoard() {
  if (model.value.innings.length === 0) {
    update(emptyScoreboard(7))
  }
}

function addInning() {
  if (model.value.innings.length >= 20) return
  update({
    ...model.value,
    innings: [
      ...model.value.innings,
      { inning: model.value.innings.length + 1, our: null, opponent: null },
    ],
  })
}

function removeInning() {
  if (model.value.innings.length <= 1) return
  update({ ...model.value, innings: model.value.innings.slice(0, -1) })
}

/** 空字串 → null（該半局沒打）；其餘轉成 0～99 的整數。 */
function setScore(index: number, side: 'our' | 'opponent', raw: string) {
  const value = raw === '' ? null : Math.min(Math.max(Math.round(Number(raw)), 0), 99)
  const next = [...model.value.innings]
  const inning = next[index]
  if (!inning) return
  next[index] = { ...inning, [side]: Number.isNaN(value) ? null : value }
  update({ ...model.value, innings: next })
}

/** 只有 H／E 需要它 —— R 是加總出來的，沒有對應的輸入框。 */
function setTotal(side: 'our' | 'opponent', field: 'h' | 'e', raw: string) {
  const value = Math.min(Math.max(Math.round(Number(raw) || 0), 0), 999)
  update({
    ...model.value,
    totals: { ...model.value.totals, [side]: { ...model.value.totals[side], [field]: value } },
  })
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

    /*
     * AI 讀到的 R 不採用：R 一律是逐局加總。模型讀錯一格逐局得分時，
     * 兩者本來就會對不上，而伺服器端已經在 `warnings` 裡把這件事講出來。
     */
    update({
      innings: result.innings.length ? result.innings : model.value.innings,
      totals: result.totals,
    })
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
            上傳計分板照片，系統會讀出逐局得分與 H／E 填進下方欄位，儲存前仍可修改。
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

              <!-- R 是逐局加總，不是輸入框：兩個來源就會有對不上的一天 -->
              <td class="border-l border-border bg-surface-muted px-1 py-1.5">
                <span
                  class="inline-flex h-10 w-14 items-center justify-center font-bold tabular-nums"
                >
                  {{ runs[side] }}
                </span>
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
      </div>

      <p class="text-xs text-content-muted">
        提示：欄位留空代表該半局沒有進行（顯示為 X），輸入 0 代表打了但沒有得分。
        R（總得分）由逐局自動加總，不需要也不能手動填。
      </p>
    </template>
  </div>
</template>
