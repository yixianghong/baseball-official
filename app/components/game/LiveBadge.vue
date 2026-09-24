<script setup lang="ts">
/**
 * 「比賽中」的標籤。
 *
 * ## 為什麼是實心紅底，而不是 `UiBaseBadge` 的 `danger`
 * `BaseBadge` 的每一種色調都是半透明底色 + 同色系文字，那是為了讓一排狀態
 * 標籤安靜地並排。LIVE 要的正好相反 —— 它必須從一頁卡片裡跳出來，而且在
 * 淺色與深色主題、白底卡片與深藍主視覺上都是同一個樣子。實心紅底是唯一
 * 不需要為每種底色各配一套的做法。
 *
 * ## 那顆會呼吸的點
 * 紅色在這個網站上還有「敗」的意思（見 `GameCard` 的左側色條），靜止的紅色
 * 標籤不一定讀得出「正在進行」。會動的點才是「此刻」的訊號 —— 而且它包在
 * `motion-safe:` 裡，系統設定了減少動態效果時就只是一顆靜止的點。
 */
withDefaults(defineProps<{ size?: 'sm' | 'md' }>(), { size: 'md' })

const sizeClasses: Record<string, string> = {
  sm: 'gap-1 px-2 py-0.5 text-[0.7rem]',
  md: 'gap-1.5 px-2.5 py-1 text-xs',
}
</script>

<template>
  <span
    class="inline-flex items-center rounded-full bg-danger font-bold tracking-widest whitespace-nowrap text-white"
    :class="sizeClasses[size]"
  >
    <span class="size-1.5 shrink-0 rounded-full bg-white motion-safe:animate-pulse" />
    LIVE
    <span class="sr-only">（比賽進行中）</span>
  </span>
</template>
