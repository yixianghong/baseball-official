<script setup lang="ts">
import {
  BASES,
  FIELDER_SHORT,
  FIELDER_SPOTS,
  fairTerritoryPath,
  fencePath,
  infieldPath,
  toSvg,
  viewBoxString,
} from '#shared/schemas/field'
import type { Position } from '#shared/schemas/player'

/**
 * 球場底圖（SVG）。
 *
 * 後台的拖曳登錄（`AdminFieldPicker`）與前台的落點圖（`GameSprayChart`）
 * **共用這一張** —— 座標也都來自 `shared/schemas/field.ts`。各畫各的話，
 * 登錄時放在游擊方向的球，在前台圖上可能畫到三壘手身上。
 *
 * 上面要疊什麼（拖曳中的球、已登錄的落點）由 slot 決定；slot 裡的座標
 * 已經是 SVG 座標，請用 `toSvg()` 轉換。
 *
 * `role="group"` 而不是 `img`：`img` 會讓裡面的東西全部變成裝飾，後台那顆可以
 * 拖的球就從輔助技術上消失了。
 *
 * ## 顏色走 CSS 而不是 `isDark`
 * 前台的比賽頁會被 CDN 快取送給所有訪客，SSR 輸出不能依配色偏好而不同
 * （見 CLAUDE.md「公開頁面走 CDN 快取」）。所以一律用 Tailwind 的 `dark:`。
 */
defineProps<{
  /** 要亮起來的守備員（拖曳中離球最近的那一位）。 */
  highlight?: Position | null
  /** 是否畫守備員。前台落點圖畫的是「球去了哪」，守備員圖示反而是雜訊。 */
  showFielders?: boolean
}>()

const svgRef = ref<SVGSVGElement | null>(null)
defineExpose({ svg: svgRef })

const fielders = Object.entries(FIELDER_SPOTS).map(([position, spot]) => ({
  position: position as Exclude<Position, 'DH'>,
  ...toSvg(spot),
}))

const bases = [BASES.first, BASES.second, BASES.third].map(toSvg)
</script>

<template>
  <svg
    ref="svgRef"
    :viewBox="viewBoxString()"
    class="block h-auto w-full select-none"
    role="group"
    aria-label="棒球場"
  >
    <!-- 界外區（整張底色） -->
    <rect x="-0.9" y="-1.15" width="1.8" height="1.27" class="fill-surface-muted" />
    <!-- 界內：外野草地 -->
    <path :d="fairTerritoryPath()" class="fill-brand-600/15 dark:fill-brand-400/15" />
    <!-- 內野紅土 -->
    <path :d="infieldPath()" class="fill-accent-500/25" />

    <!-- 全壘打牆 -->
    <path
      :d="fencePath()"
      class="fill-none stroke-brand-700 dark:stroke-brand-300"
      stroke-width="0.012"
    />
    <!-- 界外線 -->
    <line
      x1="0"
      y1="0"
      :x2="-Math.SQRT1_2"
      :y2="-Math.SQRT1_2"
      class="stroke-content-muted"
      stroke-width="0.006"
    />
    <line
      x1="0"
      y1="0"
      :x2="Math.SQRT1_2"
      :y2="-Math.SQRT1_2"
      class="stroke-content-muted"
      stroke-width="0.006"
    />

    <!-- 壘包 -->
    <rect
      v-for="(base, index) in bases"
      :key="index"
      :x="base.x - 0.014"
      :y="base.y - 0.014"
      width="0.028"
      height="0.028"
      :transform="`rotate(45 ${base.x} ${base.y})`"
      class="fill-surface stroke-content-muted"
      stroke-width="0.004"
    />
    <!-- 本壘板 -->
    <path
      d="M -0.015 -0.012 L 0.015 -0.012 L 0.015 0 L 0 0.013 L -0.015 0 Z"
      class="fill-surface stroke-content-muted"
      stroke-width="0.004"
    />

    <!-- 守備員 -->
    <template v-if="showFielders">
      <g v-for="fielder in fielders" :key="fielder.position">
        <circle
          :cx="fielder.x"
          :cy="fielder.y"
          r="0.038"
          class="transition-colors"
          :class="
            highlight === fielder.position
              ? 'fill-brand-600 stroke-brand-700'
              : 'fill-surface stroke-border'
          "
          stroke-width="0.005"
        />
        <text
          :x="fielder.x"
          :y="fielder.y + 0.016"
          text-anchor="middle"
          font-size="0.044"
          font-weight="700"
          :class="highlight === fielder.position ? 'fill-white' : 'fill-content-muted'"
        >
          {{ FIELDER_SHORT[fielder.position] }}
        </text>
      </g>
    </template>

    <slot />
  </svg>
</template>
