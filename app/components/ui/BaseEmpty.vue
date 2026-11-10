<script setup lang="ts">
/**
 * 空狀態。
 *
 * 列表沒有資料時顯示「目前還沒有…」比顯示一片空白好 —— 使用者才知道
 * 是真的沒有資料，而不是載入失敗或自己操作錯了。
 */
defineProps<{ title: string; description?: string; icon?: string }>()
</script>

<template>
  <div
    class="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-6 py-12 text-center"
  >
    <!--
      `#icon` 插槽給後台放 `AdminIcon`（線條圖示）。前台照舊傳 `icon` 字串，
      兩條路並存，所以後台換掉 emoji 不會動到前台的任何一個空狀態。
    -->
    <span v-if="$slots.icon" class="text-content-muted" aria-hidden="true">
      <slot name="icon" />
    </span>
    <span v-else-if="icon" class="text-3xl" aria-hidden="true">{{ icon }}</span>
    <p class="font-medium">{{ title }}</p>
    <p v-if="description" class="max-w-md text-fluid-sm text-content-muted">{{ description }}</p>
    <div class="mt-2">
      <slot />
    </div>
  </div>
</template>
