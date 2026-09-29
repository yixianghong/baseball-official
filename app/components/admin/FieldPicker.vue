<script setup lang="ts">
import type { BatSide, FieldPoint, Play } from '#shared/schemas/play'
import {
  FIELD_VIEWBOX,
  fromSvg,
  isInsideField,
  nearestFielder,
  roundPoint,
  toSvg,
  zoneOf,
  ZONE_LABELS,
} from '#shared/schemas/field'
import { POSITION_LABELS } from '#shared/schemas/player'

/**
 * 在球場上拖曳登錄落點。
 *
 * 從本壘的那顆球拖出去，放開的地方就是落點 —— 這個元件只負責「位置」，
 * 放開之後要選什麼結果是 `AdminLandingSheet` 的事。
 *
 * ## 為什麼不需要長按
 * `touch-action: none` **只設在那顆球上**，所以球場其他地方照樣可以捲動
 * 頁面，只有從球開始的手勢才算拖曳。長按反而是多等 150ms，而這個動作
 * 一場要做四十幾次。
 *
 * ## ⚠️ 拖曳把手是 HTML，不是 SVG 裡的元素
 * **Chrome 不理會 SVG 子元素上的 `touch-action`** —— `getComputedStyle()`
 * 明明回傳 `none`，但手指一動瀏覽器就接管手勢、送出 `pointercancel`，
 * 拖曳當場中斷（無頭 Chrome 開觸控模擬實測）。滑鼠完全正常，所以在電腦上
 * 測不出來，**只有手機會壞**，而這個功能正是在手機上用的。
 *
 * 所以球的**圖**畫在 SVG 裡（`pointer-events: none`），真正接手勢的是疊在
 * 上面、跟著球移動的一個透明 HTML 元素。位置用 `viewBox` 換算成百分比，
 * 不必量像素。
 *
 * ## 手指會擋住落點
 * 用手指拖的時候，球畫在手指**上方約 40px**，另外加一條十字準星 ——
 * 落點就是球畫在的地方，不是手指的位置。滑鼠沒有這個問題，所以不偏移
 * （偏移的話反而會讓游標和球對不上）。
 *
 * ## 反悔
 * 拖到球場外面放開＝取消。輕點球而沒有拖動也不算（小於 12px）——
 * 否則捲動頁面時不小心碰到球，就會跳出一個選單。
 */
const props = defineProps<{
  /** 這個半局已經登錄的打席（有落點的會畫成點）。 */
  plays: Play[]
  /** 亮起來的那一筆（列表上點選的）。 */
  activeIndex?: number | null
  /** 打者站哪邊。球從那一側的打擊區出發，純粹是視覺提示。 */
  bats?: BatSide | null
  disabled?: boolean
}>()

const emit = defineEmits<{ drop: [point: FieldPoint] }>()

/** 用手指拖時，球畫在手指上方多少像素。 */
const TOUCH_LIFT_PX = 40
/** 移動少於這個距離不算拖曳。 */
const MIN_DRAG_PX = 12

const base = ref<{ svg: SVGSVGElement | null } | null>(null)

const dragging = ref(false)
const point = ref<FieldPoint | null>(null)
let start: { x: number; y: number } | null = null
let lift = 0

/** 打擊區的位置：右打站三壘側（x 為負），左打站一壘側。 */
const boxX = computed(() => (props.bats === 'L' ? 0.05 : props.bats === 'R' ? -0.05 : 0))
const ballHome = computed(() => ({ x: boxX.value, y: 0.055 }))

function clientToField(clientX: number, clientY: number): FieldPoint | null {
  const svg = base.value?.svg
  const matrix = svg?.getScreenCTM()
  if (!svg || !matrix) return null
  const local = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse())
  return fromSvg({ x: local.x, y: local.y })
}

function onPointerDown(event: PointerEvent): void {
  if (props.disabled) return
  event.preventDefault()
  ;(event.currentTarget as Element).setPointerCapture(event.pointerId)
  dragging.value = true
  start = { x: event.clientX, y: event.clientY }
  lift = event.pointerType === 'touch' ? TOUCH_LIFT_PX : 0
  point.value = null
}

function onPointerMove(event: PointerEvent): void {
  if (!dragging.value || !start) return
  const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y)
  if (moved < MIN_DRAG_PX && !point.value) return
  point.value = clientToField(event.clientX, event.clientY - lift)
}

function finish(commit: boolean): void {
  const landed = point.value
  dragging.value = false
  point.value = null
  start = null
  if (commit && landed && isInsideField(landed)) emit('drop', roundPoint(landed))
}

/** 拖曳中的提示：「外野 · 靠近中」。 */
const hint = computed(() => {
  if (!point.value) return ''
  const zone = zoneOf(point.value)
  if (!isInsideField(point.value)) return '放開＝取消'
  if (zone === 'beyond' || zone === 'foul') return ZONE_LABELS[zone]
  return `${ZONE_LABELS[zone]} · 靠近${POSITION_LABELS[nearestFielder(point.value).position]}`
})

const highlight = computed(() => {
  if (!point.value || !isInsideField(point.value)) return null
  const zone = zoneOf(point.value)
  return zone === 'infield' || zone === 'outfield' ? nearestFielder(point.value).position : null
})

const ballSvg = computed(() => toSvg(point.value ?? ballHome.value))

/** 把手在容器裡的位置（百分比）。SVG 的寬高比固定，所以直接用 viewBox 換算。 */
const handleStyle = computed(() => ({
  left: `${((ballSvg.value.x - FIELD_VIEWBOX.x) / FIELD_VIEWBOX.width) * 100}%`,
  top: `${((ballSvg.value.y - FIELD_VIEWBOX.y) / FIELD_VIEWBOX.height) * 100}%`,
}))
</script>

<template>
  <div class="relative">
    <GameFieldBase ref="base" :highlight="highlight" show-fielders>
      <!-- 已登錄的落點 -->
      <GameSprayMarker
        v-for="(play, index) in plays"
        :key="index"
        :play="play"
        :active="activeIndex === index"
      />

      <!-- 打擊區 -->
      <rect
        :x="boxX - 0.022"
        y="-0.03"
        width="0.044"
        height="0.07"
        class="fill-none stroke-content-muted"
        stroke-width="0.004"
        stroke-dasharray="0.01 0.008"
      />

      <!-- 拖曳中的十字準星（手指蓋住球的時候靠它對位） -->
      <g v-if="dragging && point" class="pointer-events-none">
        <line
          :x1="ballSvg.x - 0.09"
          :y1="ballSvg.y"
          :x2="ballSvg.x + 0.09"
          :y2="ballSvg.y"
          class="stroke-danger"
          stroke-width="0.004"
        />
        <line
          :x1="ballSvg.x"
          :y1="ballSvg.y - 0.09"
          :x2="ballSvg.x"
          :y2="ballSvg.y + 0.09"
          class="stroke-danger"
          stroke-width="0.004"
        />
      </g>

      <!-- 那顆球（只負責畫；接手勢的是下面疊在上面的 HTML 把手） -->
      <circle
        :cx="ballSvg.x"
        :cy="ballSvg.y"
        r="0.026"
        class="pointer-events-none fill-white stroke-danger"
        :class="disabled ? 'opacity-40' : ''"
        stroke-width="0.006"
      />
    </GameFieldBase>

    <!--
      拖曳把手。⚠️ 必須是 HTML 元素：Chrome 不理會 SVG 子元素上的
      `touch-action`，手指一動就送出 pointercancel（見檔案開頭的說明）。
      44px 是 iOS 建議的最小觸控範圍 —— 那顆球畫出來只有十幾 px。
    -->
    <div
      class="absolute size-11 -translate-x-1/2 -translate-y-1/2 touch-none rounded-full"
      :class="disabled ? 'cursor-not-allowed' : 'cursor-grab active:cursor-grabbing'"
      :style="handleStyle"
      role="button"
      tabindex="-1"
      :aria-disabled="disabled"
      aria-label="從這裡拖曳到球的落點"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="finish(true)"
      @pointercancel="finish(false)"
    />

    <p
      v-if="hint"
      class="pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 rounded-full bg-ink/80 px-3 py-1 text-xs font-bold text-white"
      aria-live="polite"
    >
      {{ hint }}
    </p>
  </div>
</template>
