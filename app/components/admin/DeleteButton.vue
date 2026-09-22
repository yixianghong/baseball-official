<script setup lang="ts">
/**
 * 兩段式刪除按鈕。
 *
 * ## 為什麼不用 `window.confirm`
 * 原生對話框會凍結整個瀏覽器分頁（包括任何自動化工具），樣式也無法統一，
 * 而且在手機上的位置很突兀。這裡改成「按第一下變成『確定刪除？』，
 * 再按一下才真的執行」，同樣有防手滑的效果，且不阻塞任何東西。
 *
 * 五秒沒有動作就自動還原，避免一個處於「等待確認」狀態的按鈕一直留在畫面上。
 */
const props = withDefaults(
  defineProps<{ label?: string; confirmLabel?: string; loading?: boolean }>(),
  {
    label: '刪除',
    confirmLabel: '確定刪除？',
  },
)

const emit = defineEmits<{ confirm: [] }>()

const armed = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined

function handleClick() {
  if (!armed.value) {
    armed.value = true
    timer = setTimeout(() => (armed.value = false), 5000)
    return
  }

  clearTimeout(timer)
  armed.value = false
  emit('confirm')
}

onUnmounted(() => clearTimeout(timer))
</script>

<template>
  <UiBaseButton
    :variant="armed ? 'danger' : 'ghost'"
    size="sm"
    :loading="props.loading"
    @click="handleClick"
  >
    {{ armed ? confirmLabel : label }}
  </UiBaseButton>
</template>
