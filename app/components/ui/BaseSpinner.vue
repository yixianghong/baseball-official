<script setup lang="ts">
/** 載入指示。資料載入中與 AI 辨識進行中共用。 */
withDefaults(defineProps<{ label?: string }>(), { label: '載入中…' })
</script>

<template>
  <div class="flex items-center justify-center gap-3 py-10 text-content-muted" role="status">
    <span
      class="size-5 animate-spin rounded-full border-2 border-current border-t-transparent"
      aria-hidden="true"
    />
    <span class="text-fluid-sm">{{ label }}</span>
  </div>
</template>
