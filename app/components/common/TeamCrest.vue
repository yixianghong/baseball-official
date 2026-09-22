<script setup lang="ts">
/**
 * 隊徽。沒有圖片時退回顯示隊名首字。
 *
 * 比分帶與近期賽事的每一格都需要一個「代表這支球隊的圓形圖案」，而對手
 * 多半沒有隊徽可用。與其讓那一格空著讓版面塌掉，不如用首字撐住 ——
 * 視覺重量一致，整排看起來仍然整齊。
 */
withDefaults(
  defineProps<{
    name: string
    logoUrl?: string
    /**
     * `hero` 會隨斷點縮放 —— 首頁比分帶在手機上若用固定的大尺寸，
     * 兩個隊徽加上比分就會撐破 390px 的視窗寬度。
     */
    size?: 'sm' | 'md' | 'lg' | 'hero'
    /** 深色底上使用時，佔位圓的配色要反過來。 */
    onDark?: boolean
  }>(),
  { size: 'md', onDark: false },
)

const sizeClasses: Record<string, string> = {
  sm: 'size-12 text-base',
  md: 'size-16 text-xl',
  lg: 'size-24 text-3xl',
  hero: 'size-14 text-lg sm:size-20 sm:text-2xl md:size-24 md:text-3xl',
}
</script>

<template>
  <span
    class="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-black"
    :class="[
      sizeClasses[size],
      onDark ? 'bg-white/10 text-white' : 'bg-brand-600/10 text-brand-700',
    ]"
  >
    <!--
      `object-contain` 而不是 cover：隊徽是識別圖，裁掉一塊就不是那個標誌了。
      橫式字標（寬高比 3:1）用 cover 會只剩中間一段，完全認不出來。
      留一點內距，圖才不會頂到圓形容器的邊。
    -->
    <img v-if="logoUrl" :src="logoUrl" :alt="`${name} 隊徽`" class="size-full object-contain p-1" />
    <span v-else>{{ name.charAt(0) }}</span>
  </span>
</template>
