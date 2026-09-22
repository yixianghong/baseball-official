<script setup lang="ts">
import type { ApiError } from '~/utils/api-error'
import type { AutosaveStatus } from '~/composables/useAutosave'

/**
 * 自動儲存的狀態指示。
 *
 * 自動儲存最危險的地方是「以為存好了，其實沒有」。所以狀態一定要顯示出來，
 * 而且失敗時要能直接重試 —— 使用者不該為了救回剛才的輸入而重新填一次。
 */
defineProps<{ status: AutosaveStatus; error: ApiError | null }>()

const emit = defineEmits<{ retry: [] }>()
</script>

<template>
  <div class="flex flex-wrap items-center gap-2 text-fluid-sm" role="status" aria-live="polite">
    <template v-if="status === 'saving'">
      <span
        class="size-3.5 animate-spin rounded-full border-2 border-content-muted border-t-transparent"
        aria-hidden="true"
      />
      <span class="text-content-muted">儲存中…</span>
    </template>

    <template v-else-if="status === 'pending'">
      <span class="size-2 rounded-full bg-warning" aria-hidden="true" />
      <span class="text-content-muted">尚未儲存</span>
    </template>

    <template v-else-if="status === 'saved'">
      <span class="text-success" aria-hidden="true">✓</span>
      <span class="text-content-muted">已自動儲存</span>
    </template>

    <template v-else-if="status === 'error'">
      <span class="font-medium text-danger"> 儲存失敗{{ error ? `：${error.message}` : '' }} </span>
      <UiBaseButton variant="secondary" size="sm" @click="emit('retry')">重試</UiBaseButton>
    </template>
  </div>
</template>
