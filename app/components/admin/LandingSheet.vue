<script setup lang="ts">
import {
  defaultBatted,
  FIELDER_SPOTS,
  nearestFielder,
  needsBattedType,
  needsFielder,
  NO_LANDING_RESULTS,
  suggestResults,
  zoneOf,
  ZONE_LABELS,
} from '#shared/schemas/field'
import { POSITION_LABELS, type Position } from '#shared/schemas/player'
import {
  BATTED_LABELS,
  battedTypeSchema,
  PLAY_RESULTS,
  playResultSchema,
  type BattedType,
  type FieldPoint,
  type PlayResult,
} from '#shared/schemas/play'

/**
 * 球放開之後跳出的選單：處理的人、結果。得分與打點在登錄之後的打席列表上調。
 *
 * **出局點結果就登錄**，處理的人已經帶好預設值 —— 常見的情況是
 * 「拖一次、點一次」。多一個每次都要點的步驟，就是當初「欄位越多越沒人填」
 * 的那個理由（見 `play.ts` 開頭）。
 *
 * ## 安打類型是點了安打之後才問
 * 出局的擊球類型從結果本身就知道（飛球出局就是高飛，見 `battedTypeOf()`），
 * 只有安打與失誤上壘需要另外記。曾經把「擊球類型」放在結果按鈕的**上面**，
 * 不論點什麼都先顯示 —— 於是有人先選「高飛」再點「滾地球出局」，剛剛選的
 * 被默默忽略，看起來就像同一件事要回答兩次，而且答案還可能互相矛盾。
 * 現在點了安打才展開三顆按鈕，依落點預選（內野滾地、外野平飛），
 * 點任何一顆就登錄。安打多一下點擊，換到的是落點圖上分得出
 * 「平飛穿越」和「高飛打過外野手頭頂」。
 *
 * ## 處理的人與落點分開
 * 預選的是離落點最近的守備員，但**可以改**：球打在游擊與三壘中間時，
 * 實際是誰接到的只有看的人知道。落點照實記錄，處理的人另外存。
 *
 * ## 選單是排序，不是過濾
 * 規則猜錯的時候（打向外野手但他沒接到），正確的選項還在，只是要多看
 * 一眼或點「更多」。過濾掉的話就只能取消重拖。
 *
 * ## 為什麼是嵌在頁面裡，而不是一個浮在畫面上的 bottom sheet
 * 後台畫面下緣已經有 toast 的 fixed 容器（`UiToastHost`），疊第二層
 * fixed 元素就要處理 z-index 與點擊穿透（CLAUDE.md 列過這兩個坑）。
 * 放在球場正下方、出現時捲到看得見，就沒有這些問題。
 */
const props = defineProps<{
  point: FieldPoint
  batterLabel: string
  /**
   * 這個半局還剩幾個出局。超過的結果按不下去 —— 兩出局時不可能打出雙殺，
   * 登得進去的話那個半局就是 4 個出局，而完整性與投球局數都從它算。
   * 用「按不下去」而不是藏起來：少了一顆按鈕，會讓人以為選單壞了。
   */
  remainingOuts: number
}>()

function tooManyOuts(result: PlayResult): boolean {
  return PLAY_RESULTS[result].outs > props.remainingOuts
}

const emit = defineEmits<{
  confirm: [payload: { result: PlayResult; fielder: Position | null; batted: BattedType | null }]
  cancel: []
}>()

const zone = computed(() => zoneOf(props.point))
const suggestions = computed(() => suggestResults(props.point))

/** 選單上直接顯示的數量。其餘收進「更多」。 */
const VISIBLE = 6

const primary = computed(() => suggestions.value.slice(0, VISIBLE))

/** 「更多」：其餘的建議，加上所有有落點的結果（規則猜錯時的退路）。 */
const more = computed(() => {
  const shown = new Set<PlayResult>(primary.value)
  const rest = suggestions.value.slice(VISIBLE)
  const others = playResultSchema.options.filter(
    (result) =>
      !shown.has(result) &&
      !rest.includes(result) &&
      !(NO_LANDING_RESULTS as readonly string[]).includes(result),
  )
  return [...rest, ...others]
})

const showMore = ref(false)

const fielder = ref<Position>(nearestFielder(props.point).position)
const batted = ref<BattedType>(defaultBatted(props.point))

// 同一張選單換了落點（重新拖一次）時，預設值要跟著換
watch(
  () => props.point,
  (next) => {
    fielder.value = nearestFielder(next).position
    batted.value = defaultBatted(next)
    showMore.value = false
  },
)

const fielderOptions = Object.keys(FIELDER_SPOTS).map((position) => ({
  value: position as Position,
  label: POSITION_LABELS[position as Position],
}))

/** 牆外、界外不必問擊球類型：牆外一定是高飛，界外只剩界外飛球。 */
const askBatted = computed(() => zone.value === 'infield' || zone.value === 'outfield')

/** 點了安打（或失誤上壘）、正在等選安打類型的那個結果。 */
const pendingHit = ref<PlayResult | null>(null)

watch(
  () => props.point,
  () => (pendingHit.value = null),
)

function confirm(result: PlayResult, type: BattedType | null): void {
  emit('confirm', {
    result,
    // 只有出局、失誤、野選才記處理的人；安打記 null（穿越的球沒有人處理）
    fielder: needsFielder(result) ? fielder.value : null,
    // 只有安打與失誤才存擊球類型；出局的類型從結果推導
    batted: needsBattedType(result) ? type : null,
  })
}

function pick(result: PlayResult): void {
  if (tooManyOuts(result)) return
  if (needsBattedType(result) && askBatted.value) {
    pendingHit.value = result
    batted.value = defaultBatted(props.point)
    return
  }
  confirm(result, needsBattedType(result) ? defaultBatted(props.point) : null)
}

const root = ref<HTMLElement | null>(null)
onMounted(() => root.value?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }))
</script>

<template>
  <div
    ref="root"
    class="space-y-3 rounded-xl border border-brand-600/40 bg-surface p-3 shadow-sm"
    role="group"
    :aria-label="`${batterLabel} 的打席結果`"
  >
    <div class="flex flex-wrap items-baseline justify-between gap-2">
      <p class="text-fluid-sm font-bold">
        {{ batterLabel }}
        <span class="ml-1 font-normal text-content-muted">打到{{ ZONE_LABELS[zone] }}</span>
      </p>
      <button
        type="button"
        class="min-h-9 px-2 text-fluid-sm text-content-muted underline underline-offset-4"
        @click="emit('cancel')"
      >
        取消
      </button>
    </div>

    <div class="flex flex-wrap items-end gap-3">
      <!--
        牆外（全壘打）不會有人處理球。點了安打之後也藏起來：安打不記處理的人，
        留著它就又是一個「選了也沒用」的欄位。
      -->
      <UiBaseSelect
        v-if="zone !== 'beyond' && !pendingHit"
        v-model="fielder"
        label="處理的人"
        class="w-32"
        :options="fielderOptions"
      />
    </div>

    <!-- ── 點了安打：問它是怎麼打出去的 ── -->
    <div v-if="pendingHit" class="space-y-2 rounded-lg bg-brand-600/5 p-3">
      <p class="text-fluid-sm font-bold">
        {{ PLAY_RESULTS[pendingHit].label }}：{{
          PLAY_RESULTS[pendingHit].hit ? '安打類型' : '擊球類型'
        }}？
      </p>
      <div class="grid grid-cols-3 gap-1.5" role="group" aria-label="安打類型">
        <button
          v-for="type in battedTypeSchema.options"
          :key="type"
          type="button"
          class="min-h-12 rounded-lg border text-fluid-sm font-bold transition"
          :class="
            batted === type
              ? 'border-brand-600 bg-brand-600 text-white'
              : 'border-border hover:bg-surface-muted'
          "
          @click="confirm(pendingHit, type)"
        >
          {{ BATTED_LABELS[type] }}
        </button>
      </div>
      <p class="text-xs text-content-muted">
        反白的是依落點預選的（內野滾地、外野平飛），點任何一顆就登錄。
        <button type="button" class="ml-1 underline underline-offset-4" @click="pendingHit = null">
          改選其他結果
        </button>
      </p>
    </div>

    <template v-else>
      <p class="text-xs text-content-muted">
        處理的人只在出局、失誤、野選時記錄。出局點一下就登錄，安打會再問一次是怎麼打出去的。
      </p>

      <!--
        ⚠️ **安打和出局要一眼分得出來。** 這張選單上每一顆按鈕的字數都差不多
        （「一壘安打」「滾地球出局」），全部長一樣的時候，場邊的人是在讀字
        而不是在認按鈕 —— 而他正一邊看球一邊點。安打用實心的強調色，
        出局與失誤維持線框。
      -->
      <div class="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        <button
          v-for="result in primary"
          :key="result"
          type="button"
          class="min-h-12 rounded-lg border px-2 text-fluid-sm font-bold transition disabled:opacity-40"
          :class="
            PLAY_RESULTS[result].hit
              ? 'border-brand-600 bg-brand-600 text-white hover:bg-brand-700'
              : 'border-border hover:bg-surface-muted'
          "
          :disabled="tooManyOuts(result)"
          :title="tooManyOuts(result) ? `只剩 ${remainingOuts} 個出局` : undefined"
          @click="pick(result)"
        >
          {{ PLAY_RESULTS[result].label }}
        </button>
      </div>

      <button
        v-if="more.length"
        type="button"
        class="min-h-11 text-fluid-sm text-content-muted underline underline-offset-4"
        :aria-expanded="showMore"
        @click="showMore = !showMore"
      >
        {{ showMore ? '收起' : '更多結果' }}
      </button>

      <div v-if="showMore" class="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        <button
          v-for="result in more"
          :key="result"
          type="button"
          class="min-h-11 rounded-lg border px-2 text-xs transition disabled:opacity-40"
          :class="
            PLAY_RESULTS[result].hit
              ? 'border-brand-600 text-brand-700 hover:bg-brand-600/10 dark:text-brand-300'
              : 'border-border hover:bg-surface-muted'
          "
          :disabled="tooManyOuts(result)"
          :title="tooManyOuts(result) ? `只剩 ${remainingOuts} 個出局` : undefined"
          @click="pick(result)"
        >
          {{ PLAY_RESULTS[result].label }}
        </button>
      </div>
    </template>
  </div>
</template>
