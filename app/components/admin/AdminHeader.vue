<script setup lang="ts">
/** 後台頁面標題列。標題、說明與右側動作區。 */
defineProps<{ title: string; description?: string; backTo?: string; backLabel?: string }>()
</script>

<template>
  <header class="mb-6">
    <NuxtLink
      v-if="backTo"
      :to="backTo"
      class="mb-3 inline-flex text-fluid-sm text-content-muted hover:text-brand-600"
    >
      ← {{ backLabel ?? '返回' }}
    </NuxtLink>

    <div class="flex flex-wrap items-start justify-between gap-4">
      <div class="min-w-0">
        <!--
          `#meta` 插槽排在標題右邊（窄螢幕換到下一行），放「這是一筆什麼狀態的資料」
          這種要和標題一起被看到的東西 —— 例如單場比賽的狀態與比數：
          那一頁有五個分頁，狀態按鈕只在其中一個，切走之後就看不到這場是不是已經結束。
        -->
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 class="min-w-0 text-fluid-xl font-bold [overflow-wrap:anywhere]">{{ title }}</h1>
          <slot name="meta" />
        </div>
        <p v-if="description" class="mt-1 text-fluid-sm text-content-muted">{{ description }}</p>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <slot name="actions" />
      </div>
    </div>
  </header>
</template>
