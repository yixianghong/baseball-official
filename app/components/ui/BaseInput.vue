<script setup lang="ts">
/**
 * 基礎輸入框，內建錯誤訊息與無障礙屬性串接。
 *
 * ## 與 BFF 錯誤格式的整合
 * `error` 直接傳 `ApiError.fieldErrors[欄位名]?.[0]` 即可：
 * ```vue
 * <UiBaseInput v-model="form.email" label="Email" :error="error?.fieldErrors.email?.[0]" />
 * ```
 *
 * ## 無障礙處理
 * - `label` 與 input 用 `for`/`id` 正確關聯
 * - 錯誤訊息用 `aria-describedby` 綁定，螢幕閱讀器會一起讀出來
 * - `aria-invalid` 讓輔助科技知道這個欄位有問題
 * - `font-size` 至少 16px，否則 iOS Safari 聚焦時會自動放大整個頁面
 *
 * ## ⚠️ `inputmode`、`maxlength` 要宣告成 prop
 * 沒宣告的屬性會落到外層的 `<div>` 上，而不是 `<input>`。曾經在逐局紀錄的
 * 「對手打者背號」上寫了 `inputmode="numeric"`，結果它掛在 div 上，
 * 手機一直跳出一般鍵盤 —— 畫面上看不出任何異常。
 *
 * ## `digits`：只收數字
 * 背號這種欄位，打錯一個字母就是一筆對不上的紀錄。擋的方式是**當下把非數字
 * 拿掉**（包含貼上），而不是等送出時才報錯。只在 `digits` 時才介入：
 * 一般欄位維持原本的 `v-model` —— 它會等中文輸入法選完字才更新，
 * 自己接 `input` 事件的話，注音打到一半就會被寫進 model。
 */
const props = withDefaults(
  defineProps<{
    label: string
    type?: string
    error?: string
    hint?: string
    required?: boolean
    autocomplete?: string
    placeholder?: string
    inputmode?: 'text' | 'numeric' | 'decimal' | 'tel' | 'email' | 'url' | 'search'
    maxlength?: number
    /** 只收數字（背號這類欄位）。非數字會在輸入當下被拿掉。 */
    digits?: boolean
  }>(),
  { type: 'text', required: false },
)

const model = defineModel<string>({ required: true })

const id = useId()
const errorId = computed(() => `${id}-error`)
const hintId = computed(() => `${id}-hint`)

/**
 * `digits` 時把非數字拿掉。
 *
 * 要同時改 `input.value`：model 的值如果沒變（打了一個字母），Vue 不會
 * 重新渲染 input，那個字母就會一直留在畫面上。
 */
function onInput(event: Event): void {
  if (!props.digits) return
  const input = event.target as HTMLInputElement
  let cleaned = input.value.replace(/\D/g, '')
  if (props.maxlength) cleaned = cleaned.slice(0, props.maxlength)
  if (input.value !== cleaned) input.value = cleaned
  model.value = cleaned
}

/**
 * 讓呼叫端把游標移進來（`inputRef.focus()`）。
 *
 * ⚠️ **`ref` 放在元件上拿到的是元件實例，不是裡面的 `<input>`** —— 沒有這個
 * `expose` 的話，呼叫端只能去 `$el.querySelector('input')`，而那會在元件內部
 * 結構改變時安靜地失效。
 */
const inputRef = useTemplateRef<HTMLInputElement>('input')

defineExpose({
  focus: (options?: FocusOptions) => inputRef.value?.focus(options),
})

const describedBy = computed(() => {
  const ids = []
  if (props.hint) ids.push(hintId.value)
  if (props.error) ids.push(errorId.value)
  return ids.length ? ids.join(' ') : undefined
})
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <label :for="id" class="text-fluid-sm font-medium">
      {{ label }}
      <span v-if="required" class="text-danger" aria-hidden="true">*</span>
    </label>

    <input
      :id="id"
      ref="input"
      v-model="model"
      :type="type"
      :required="required"
      :autocomplete="autocomplete"
      :placeholder="placeholder"
      :inputmode="inputmode ?? (digits ? 'numeric' : undefined)"
      :maxlength="maxlength"
      :pattern="digits ? '[0-9]*' : undefined"
      :aria-invalid="Boolean(error)"
      :aria-describedby="describedBy"
      class="min-h-11 rounded-lg border bg-surface px-3 text-base transition placeholder:text-content-muted"
      :class="error ? 'border-danger' : 'border-border focus:border-brand-500'"
      @input="onInput"
    />

    <p v-if="hint && !error" :id="hintId" class="text-xs text-content-muted">
      {{ hint }}
    </p>

    <p v-if="error" :id="errorId" class="text-xs text-danger" role="alert">
      {{ error }}
    </p>
  </div>
</template>
