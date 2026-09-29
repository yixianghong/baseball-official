<script setup lang="ts">
import { toSvg } from '#shared/schemas/field'
import { battedTypeOf, PLAY_RESULTS, type Play } from '#shared/schemas/play'

/**
 * 落點圖上的一個點。後台的逐局登錄與前台的落點圖共用，所以兩邊的圖例一致。
 *
 * - **形狀是擊球類型**：滾地●、平飛■、高飛▲（出局從結果推導，見 `battedTypeOf()`）
 * - **紅色實心是安打**，空心是出局或上壘（前台圖例只寫「實心＝安打」）
 *
 * 用形狀而不是只用顏色區分：色弱的人分不出綠和紅，而這張圖最常被問的
 * 問題正是「這支是安打還是出局」。
 */
const props = defineProps<{
  play: Pick<Play, 'location' | 'result' | 'batted'>
  /** 亮起來（後台點選列表上的那一筆時）。 */
  active?: boolean
}>()

const point = computed(() => (props.play.location ? toSvg(props.play.location) : null))
const batted = computed(() => battedTypeOf(props.play))
const hit = computed(() => PLAY_RESULTS[props.play.result].hit)

const SIZE = 0.022

const trianglePoints = computed(() => {
  if (!point.value) return ''
  const { x, y } = point.value
  return `${x},${y - SIZE * 1.15} ${x - SIZE},${y + SIZE * 0.75} ${x + SIZE},${y + SIZE * 0.75}`
})

const shapeClass = computed(() => [
  hit.value ? 'fill-danger stroke-danger' : 'fill-surface stroke-content',
  // 選中的那一筆加粗外框。⚠️ 不能用紅色 —— 安打本身就是紅色，選中與否會看不出來
  props.active ? 'stroke-ink dark:stroke-white' : '',
])
</script>

<template>
  <g v-if="point">
    <!-- 亮起來的那一筆多一圈，大到手指蓋住也看得到 -->
    <circle
      v-if="active"
      :cx="point.x"
      :cy="point.y"
      r="0.05"
      class="fill-ink/10 stroke-ink dark:fill-white/15 dark:stroke-white"
      stroke-width="0.005"
    />
    <polygon
      v-if="batted === 'fly'"
      :points="trianglePoints"
      :class="shapeClass"
      stroke-width="0.006"
    />
    <rect
      v-else-if="batted === 'line'"
      :x="point.x - SIZE * 0.85"
      :y="point.y - SIZE * 0.85"
      :width="SIZE * 1.7"
      :height="SIZE * 1.7"
      :class="shapeClass"
      stroke-width="0.006"
    />
    <circle
      v-else
      :cx="point.x"
      :cy="point.y"
      :r="SIZE * 0.9"
      :class="shapeClass"
      stroke-width="0.006"
    />
    <title>{{ PLAY_RESULTS[play.result].label }}</title>
  </g>
</template>
