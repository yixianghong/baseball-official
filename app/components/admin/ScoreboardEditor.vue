<script setup lang="ts">
import type { HomeAway, Scoreboard } from '#shared/schemas/game'
import { emptyScoreboard, scoreboardSides, sumInnings, withSummedRuns } from '#shared/schemas/game'
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
 * ## 列的順序跟前台一樣
 * 上面那列是**先攻**（客隊），依 `homeAway` 決定，走的是和前台計分板同一支
 * `scoreboardSides()`。這裡原本寫死「我隊在上」，於是主場的比賽在後台是
 * 「我隊／對手」、前台是「對手／我隊」—— 而計分板正是拿來核對的東西，
 * 順序相反看起來就像資料被改過。改主客場時這兩列會跟著對調，那是正確的。
 *
 * ## R 不能輸入
 * 總得分一律是逐局加總（`withSummedRuns()`），所以它是一格唯讀的數字而不是
 * 輸入框。這裡曾經有一顆「用逐局加總填入 R」的按鈕 —— 那等於把「保持一致」
 * 外包給使用者記得按，沒按的下場是逐局 3:1、R 欄 0:0，而前台的比數、勝敗、
 * 戰績全部讀 R。H／E 在逐打席涵蓋那一隊的所有半局時由打席推導（見 `derivedTotals`），
 * 否則人工輸入。
 */
const props = defineProps<{
  ourName: string
  opponentName: string
  /** 決定哪一列在上面（先攻）。和前台用同一條規則。 */
  homeAway: HomeAway
  /** 送給 AI 比對「哪一列是我隊」的隊名清單。 */
  teamNames: string[]
  /**
   * 哪幾格的得分是由逐打席推導出來的（`{ inning, side }`）。
   *
   * 這些格子在這裡是**唯讀**的：一個半局只要有任何一筆打席，那一格就完全
   * 由打席加總決定（見 `applyPlayDerivedScores()`）。同時開放手填的話，
   * 同一格會有兩個來源，而它們對不上的時候畫面上完全看不出來。
   *
   * 逐格判斷而不是整張表二選一 —— 登錄一定是零碎的：先補了第 3 局上，
   * 對手的半局還沒登。
   */
  derivedCells?: Array<{ inning: number; side: 'our' | 'opponent' }>
  /**
   * H／E 由逐打席推導時的值（沒有推導的欄位是 `undefined`）。
   *
   * 推導的那幾格顯示這個值、而且唯讀 —— 和逐局得分同一套做法。
   * 值從這裡傳進來而不是讀 `model`：本機的表單在打席寫回之前可能還停在舊值。
   * 規則見 `applyPlayDerivedScores()`：一隊每個打過的半局都有打席，那一隊的
   * H（與對方的 E）才推導，否則維持手填。
   */
  derivedTotals?: Record<'our' | 'opponent', { h?: number; e?: number }>
}>()

const model = defineModel<Scoreboard>({ required: true })

const { parseScoreboard, loading: aiLoading } = useAiActions()
const fileInput = ref<HTMLInputElement | null>(null)
const aiMessage = ref('')
const aiWarnings = ref<string[]>([])
const aiConfidence = ref<number | null>(null)

const innings = computed(() => model.value.innings)

/** 由上而下的兩列，上面那列是先攻。與前台共用同一支函式。 */
const sides = computed(() => scoreboardSides(props.homeAway))

/**
 * 畫面上顯示的 R。
 *
 * 直接算逐局加總而不是讀 `model.totals`：載入的資料如果是這條規則之前寫進去的，
 * 兩者可能對不上，而這一格要顯示的是**現在這張表算出來的數字**。
 */
const runs = computed(() => sumInnings(model.value))

/** 這一格是不是由逐打席推導的。用 Set 而不是每格跑一次 `some()`。 */
const derivedKeys = computed(
  () => new Set((props.derivedCells ?? []).map((cell) => `${cell.inning}-${cell.side}`)),
)

function isDerived(inning: number, side: 'our' | 'opponent'): boolean {
  return derivedKeys.value.has(`${inning}-${side}`)
}

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
            <tr v-for="side in sides" :key="side" class="border-t border-border">
              <th
                scope="row"
                class="sticky left-0 z-10 max-w-40 truncate bg-surface px-3 py-2 text-left font-semibold"
              >
                {{ side === 'our' ? ourName : opponentName || '對手' }}
              </th>

              <td v-for="(inning, index) in innings" :key="inning.inning" class="px-1 py-1.5">
                <!--
                  ⚠️ **有逐打席的那一格是唯讀的**，而且一定要說出原因。
                  一格數字突然改不動、畫面上又什麼都沒講的話，看起來就是壞了。
                -->
                <span
                  v-if="isDerived(inning.inning, side)"
                  class="inline-flex h-10 w-12 items-center justify-center rounded-lg bg-brand-600/10 font-bold tabular-nums text-brand-600 dark:text-brand-300"
                  :title="`第 ${inning.inning} 局的逐打席加總，請到「逐局紀錄」分頁修改`"
                >
                  {{ inning[side] }}
                </span>
                <input
                  v-else
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
                <span
                  v-if="derivedTotals?.[side]?.h !== undefined"
                  class="inline-flex h-10 w-14 items-center justify-center rounded-lg bg-brand-600/10 font-bold tabular-nums text-brand-600 dark:text-brand-300"
                  :aria-label="`${side === 'our' ? ourName : opponentName} 安打數（由逐打席推導）`"
                  title="由「逐局紀錄」的逐打席加總，請到那裡修改"
                >
                  {{ derivedTotals?.[side]?.h }}
                </span>
                <input
                  v-else
                  :value="model.totals[side].h"
                  type="number"
                  min="0"
                  :aria-label="`${side === 'our' ? ourName : opponentName} 安打數`"
                  class="h-10 w-14 rounded-lg border border-border bg-surface text-center tabular-nums"
                  @input="setTotal(side, 'h', ($event.target as HTMLInputElement).value)"
                />
              </td>
              <td class="px-1 py-1.5">
                <span
                  v-if="derivedTotals?.[side]?.e !== undefined"
                  class="inline-flex h-10 w-14 items-center justify-center rounded-lg bg-brand-600/10 font-bold tabular-nums text-brand-600 dark:text-brand-300"
                  :aria-label="`${side === 'our' ? ourName : opponentName} 失誤數（由逐打席推導）`"
                  title="由「逐局紀錄」的逐打席加總，請到那裡修改"
                >
                  {{ derivedTotals?.[side]?.e }}
                </span>
                <input
                  v-else
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

      <!--
        表格底下原本有兩段說明，都拿掉了。

        一段是「提示：…」（先攻在上、留空＝沒打這半局、R 是加總）—— 那三件事
        畫面上本來就看得到：隊名寫在列首、空格與 X 是同一件事的兩個樣子、
        R 那一欄是唯讀的樣式。

        一段是「有底色的格子是逐打席加總，在這裡不能改」。CLAUDE.md 原本
        要求它一定要在（「一格數字改不動而畫面上又沒說原因，看起來就是壞掉了」），
        ⚠️ **前提後來變了**：計分板已經搬進「逐局紀錄」分頁，就排在逐打席登錄的
        正上方 —— 資料來源和它本人在同一個畫面上。而且**每一格推導值自己帶
        `title`**（「由『逐局紀錄』的逐打席加總，請到那裡修改」），滑鼠停著或長按
        就看得到。

        ⚠️ 要再拿掉那些 `title` 的話，就得把這段文字加回來 —— 那時畫面上就真的
        沒有任何地方說得出原因了。
      -->
    </template>
  </div>
</template>
