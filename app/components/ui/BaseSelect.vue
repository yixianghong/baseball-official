<script setup lang="ts" generic="T extends string">
/**
 * 下拉選單。與 `BaseInput` 同一套無障礙處理與錯誤顯示慣例。
 *
 * ## 為什麼是泛型元件
 * 表單裡的選單欄位多半不是任意字串，而是像 `'home' | 'away'` 這種字面量
 * 聯集。若把 model 寫死成 `string`，每個呼叫端都得寫
 * `@update:model-value="form.homeAway = $event as 'home' | 'away'"` ——
 * 一個只為了消除型別錯誤的斷言，既囉嗦又把真正的型別檢查繞過去了。
 *
 * 宣告成泛型之後，`v-model="form.homeAway"` 直接可用，而且 `options` 裡
 * 打錯的 value 會在編譯期就被抓出來。
 *
 * options 用 `{ value, label }` 而非兩個平行陣列，呼叫端不會對錯順序。
 */
const props = withDefaults(
  defineProps<{
    label: string
    options: ReadonlyArray<{ value: T; label: string }>
    error?: string
    hint?: string
    required?: boolean
    /** 允許不選，顯示為第一個選項。 */
    placeholder?: string
  }>(),
  { required: false },
)

const model = defineModel<T>({ required: true })

const id = useId()
const errorId = computed(() => `${id}-error`)
const hintId = computed(() => `${id}-hint`)
const describedBy = computed(() => {
  const ids: string[] = []
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

    <select
      :id="id"
      v-model="model"
      :required="required"
      :aria-invalid="Boolean(error)"
      :aria-describedby="describedBy"
      class="min-h-11 rounded-lg border bg-surface px-3 text-base transition"
      :class="error ? 'border-danger' : 'border-border focus:border-brand-500'"
    >
      <option v-if="placeholder" value="">{{ placeholder }}</option>
      <option v-for="option in options" :key="option.value" :value="option.value">
        {{ option.label }}
      </option>
    </select>

    <p v-if="hint && !error" :id="hintId" class="text-xs text-content-muted">{{ hint }}</p>
    <p v-if="error" :id="errorId" class="text-xs text-danger" role="alert">{{ error }}</p>
  </div>
</template>
