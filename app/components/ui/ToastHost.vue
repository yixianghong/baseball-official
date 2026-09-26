<script setup lang="ts">
import type { Toast } from '~/composables/useToast'

/**
 * 浮動提示的容器。
 *
 * 全站只掛一個，目前在 `layouts/admin.vue`。訊息由 `useToast()` 送進來。
 *
 * ## 為什麼不 teleport 到 body
 * `AdminRowMenu` 必須 teleport 是因為它被 `overflow-x-auto` 的表格裁掉，
 * 這裡沒有那個問題（掛在版面最外層，祖先沒有 transform／overflow）。而且
 * **朗讀器的 live region 必須在訊息出現之前就存在於 DOM 裡** —— 用
 * `Teleport v-if` 的話，容器和第一則訊息是同一幀插進去的，那一則就不會被念出來。
 *
 * ## 兩個容易漏掉的地方
 * - 外層要 `pointer-events-none`、每一則自己 `pointer-events-auto`。
 *   否則這個橫跨整個畫面下緣的 fixed 容器會把底下的按鈕全部吃掉，
 *   而它平常是空的、完全看不出來。
 * - `z-index` 要高於 `AdminRowMenu`（遮罩 40、選單 50），否則提示會被那層
 *   全螢幕遮罩壓住，「重試」按鈕點不到。
 */
const { toasts, dismiss } = useToast()

/** 正在執行動作的提示 —— 等待期間要停用按鈕，否則重試會被連按好幾次。 */
const busyId = ref<number | null>(null)

async function runAction(toast: Toast): Promise<void> {
  if (busyId.value !== null) return
  busyId.value = toast.id
  try {
    await toast.action?.handler()
  } finally {
    busyId.value = null
  }
}

/** 深色模式不能靠陰影做層次，所以色調用左緣的色條表示（見 `main.css`）。 */
const toneClasses: Record<Toast['tone'], string> = {
  success: 'border-l-success',
  error: 'border-l-danger',
  info: 'border-l-brand-600',
}

const toneIcons: Record<Toast['tone'], string> = {
  success: '✓',
  error: '⚠',
  info: 'ℹ',
}

const toneIconClasses: Record<Toast['tone'], string> = {
  success: 'text-success',
  error: 'text-danger',
  info: 'text-brand-600 dark:text-brand-300',
}
</script>

<template>
  <!--
    `aria-live` 一律是 polite。assertive 會打斷朗讀器當下正在念的內容，
    而這裡的訊息（含失敗）都會留在畫面上，值不到那個代價。
  -->
  <div
    class="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:items-end"
    role="status"
    aria-live="polite"
    aria-atomic="false"
  >
    <TransitionGroup
      enter-from-class="translate-y-2 opacity-0"
      enter-active-class="transition duration-200 ease-out motion-reduce:transition-none"
      leave-active-class="transition duration-150 ease-in motion-reduce:transition-none"
      leave-to-class="translate-y-1 opacity-0"
      move-class="transition duration-200 motion-reduce:transition-none"
    >
      <div
        v-for="toast in toasts"
        :key="toast.id"
        class="surface-card pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border border-l-4 border-border bg-surface-raised px-4 py-3"
        :class="toneClasses[toast.tone]"
      >
        <span class="mt-px shrink-0" :class="toneIconClasses[toast.tone]" aria-hidden="true">
          {{ toneIcons[toast.tone] }}
        </span>

        <div class="min-w-0 flex-1 space-y-2">
          <p class="text-fluid-sm break-words">{{ toast.message }}</p>

          <UiBaseButton
            v-if="toast.action"
            variant="secondary"
            size="sm"
            :loading="busyId === toast.id"
            @click="runAction(toast)"
          >
            {{ toast.action.label }}
          </UiBaseButton>
        </div>

        <!--
          失敗的提示也關得掉。留一則關不掉的紅色訊息在畫面上並不會讓資料
          更安全 —— 真正的防線是狀態還在（下一次變更會再試一次）以及
          `beforeunload` 的提醒，見 `useAutosave`。
        -->
        <button
          type="button"
          class="-m-1 shrink-0 rounded p-1 text-content-muted transition hover:text-content"
          aria-label="關閉提示"
          @click="dismiss(toast.id)"
        >
          <svg
            class="size-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            aria-hidden="true"
          >
            <path d="M6 6l12 12" />
            <path d="M18 6L6 18" />
          </svg>
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>
