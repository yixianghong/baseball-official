<script setup lang="ts">
/**
 * 狀態標籤。比賽狀態、公告分類、勝敗結果都用它。
 *
 * ## 為什麼需要 `onDark`
 * `dark:` 變體看的是「網站主題是不是深色」，不是「這個標籤底下是什麼顏色」。
 * 比賽詳情頁的標題卡在淺色主題下也是深藍底，那裡的標籤若沿用淺色主題的
 * 配色（深色文字配淡色底），在深藍上幾乎看不見。
 *
 * 放在深色區塊裡的標籤請明確傳 `on-dark`。
 */
withDefaults(
  defineProps<{
    tone?: 'neutral' | 'brand' | 'accent' | 'success' | 'warning' | 'danger'
    size?: 'sm' | 'md'
    /** 標籤位在深色底上（例如比賽詳情頁的標題卡）。 */
    onDark?: boolean
  }>(),
  { tone: 'neutral', size: 'md', onDark: false },
)

const toneClasses: Record<string, string> = {
  neutral: 'bg-surface-muted text-content-muted',
  brand: 'bg-brand-600/10 text-brand-700 dark:bg-brand-400/15 dark:text-brand-300',
  // 金色在白底上對比偏弱，文字用 700 這一階；深色主題則回到明亮的 400
  accent: 'bg-accent-500/15 text-accent-700 dark:bg-accent-400/15 dark:text-accent-400',
  success: 'bg-success/12 text-success',
  warning: 'bg-warning/15 text-warning',
  danger: 'bg-danger/12 text-danger',
}

/** 深色底上的配色：一律用半透明白底 + 該色系最明亮的那一階。 */
const onDarkClasses: Record<string, string> = {
  neutral: 'bg-white/15 text-white/90',
  brand: 'bg-brand-400/20 text-brand-200',
  accent: 'bg-accent-400/20 text-accent-300',
  success: 'bg-success/25 text-white',
  warning: 'bg-warning/25 text-warning',
  danger: 'bg-danger/25 text-white',
}

const sizeClasses: Record<string, string> = {
  sm: 'px-2 py-0.5 text-[0.7rem]',
  md: 'px-2.5 py-1 text-xs',
}
</script>

<template>
  <span
    class="inline-flex items-center gap-1 rounded-full font-semibold whitespace-nowrap"
    :class="[onDark ? onDarkClasses[tone] : toneClasses[tone], sizeClasses[size]]"
  >
    <slot />
  </span>
</template>
