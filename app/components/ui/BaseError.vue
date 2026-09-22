<script setup lang="ts">
import type { ApiError } from '~/utils/api-error'

/**
 * 載入失敗的提示。
 *
 * ## 為什麼需要它
 * 列表頁很容易寫成「載入中 → 有資料就顯示 → 否則顯示空狀態」，漏掉錯誤這一態。
 * 那會讓「請求失敗」長得跟「真的沒有資料」一模一樣 —— 使用者明明剛新增完，
 * 畫面卻說「還沒有資料」，完全看不出是哪裡出錯，也不知道該不該重新輸入一次。
 *
 * `requestId` 一併顯示：它同時出現在伺服器日誌裡，回報問題時提供這組 ID
 * 就能直接撈出完整的請求軌跡（見 `shared/types/api.ts`）。
 */
defineProps<{ error: ApiError; title?: string }>()

const emit = defineEmits<{ retry: [] }>()
</script>

<template>
  <div class="rounded-xl border border-danger/40 bg-danger/5 px-5 py-6">
    <p class="font-semibold text-danger">{{ title ?? '資料載入失敗' }}</p>
    <p class="mt-1 text-fluid-sm text-content">{{ error.message }}</p>

    <div class="mt-4 flex flex-wrap items-center gap-3">
      <UiBaseButton variant="secondary" size="sm" @click="emit('retry')">重新載入</UiBaseButton>
      <span v-if="error.requestId !== 'unknown'" class="text-xs text-content-muted">
        錯誤代碼 {{ error.code }}・追蹤 ID {{ error.requestId }}
      </span>
    </div>
  </div>
</template>
