<script setup lang="ts">
/**
 * 後台版面上的「還在上傳」指示器。
 *
 * 上傳佇列活在 plugin 上，所以換頁不會中斷 —— 但少了這個指示器，
 * 「還在背景傳」和「已經悄悄死掉」在畫面上長得一模一樣，而一個檔案要傳
 * 幾十分鐘，那段時間裡使用者會做很多事。它就是那段時間裡唯一的證據。
 *
 * 沒有正在傳的東西時整個不渲染 —— 後台版面上不需要一個常駐的空狀態。
 */
const { count, progress, gameId } = useClipUploadStatus()
</script>

<template>
  <NuxtLink
    v-if="count"
    :to="gameId ? `/admin/upload/${gameId}` : '/admin/games'"
    class="flex min-h-11 w-full items-center gap-2.5 rounded-lg bg-brand-600/10 px-3 text-fluid-sm text-brand-700 transition hover:bg-brand-600/20 md:w-auto dark:text-brand-300"
  >
    <span aria-hidden="true">⬆️</span>
    <span class="min-w-0 flex-1">
      上傳中 {{ count }} 個
      <span class="tabular-nums">（{{ progress }}%）</span>
    </span>
  </NuxtLink>
</template>
