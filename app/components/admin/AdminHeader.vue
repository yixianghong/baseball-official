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
      <div>
        <h1 class="text-fluid-xl font-bold">{{ title }}</h1>
        <p v-if="description" class="mt-1 text-fluid-sm text-content-muted">{{ description }}</p>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <slot name="actions" />
      </div>
    </div>
  </header>
</template>
