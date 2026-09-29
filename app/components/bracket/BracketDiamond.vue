<script setup lang="ts">
/**
 * 樹狀圖上的菱形外框（限期活動，見 `docs/ws-bracket.md`）。
 *
 * ⚠️ **不用 `clip-path`，用「旋轉 45 度的圓角方形」。** clip-path 切得出
 * 完美的菱形，但切掉的是**整個元素**，包含外框、陰影與 `:focus-visible`
 * 的焦點外框 —— 鍵盤使用者會看到一半的框。旋轉的方形四個角還可以是圓的，
 * 這一頁要的 Q 版感覺也剛好是圓角。
 *
 * 邊長要除以 √2，旋轉之後的外接方形才剛好等於指定的 `size`。少了這一步，
 * 菱形會比座標表算的大 41%，每一格都互相疊到而且完全不報錯。
 */
const props = withDefaults(
  defineProps<{
    size: number
    /** 外觀。`pending` 是還沒產生的晉級者（金色的「?」）。 */
    tone?: 'team' | 'pending' | 'advanced' | 'champion' | 'eliminated'
  }>(),
  { tone: 'team' },
)

/** 旋轉後的外接方形要等於 size，所以邊長是 size / √2。 */
const side = computed(() => Math.round(props.size / Math.SQRT2))

const TONES = {
  team: 'bg-surface-raised border-ink/15 dark:border-white/20',
  pending: 'bg-linear-to-br from-accent-300 to-accent-600 border-accent-700/40',
  advanced: 'bg-surface-raised border-accent-500',
  champion: 'bg-linear-to-br from-accent-200 to-accent-500 border-accent-700/50',
  eliminated: 'bg-surface-muted border-border',
} as const
</script>

<template>
  <div
    class="relative grid place-items-center"
    :style="{ width: `${size}px`, height: `${size}px` }"
  >
    <div
      class="absolute rounded-[22%] border-3 shadow-lg transition duration-150"
      :class="TONES[tone]"
      :style="{
        width: `${side}px`,
        height: `${side}px`,
        transform: 'rotate(45deg)',
      }"
    />
    <!-- 內容不跟著轉，所以放在旋轉的方塊**外面**當兄弟節點，不是子節點 -->
    <div class="relative flex flex-col items-center justify-center">
      <slot />
    </div>
  </div>
</template>
