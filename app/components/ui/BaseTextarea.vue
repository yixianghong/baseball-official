<script setup lang="ts">
/** 多行輸入。公告內容、球員簡介、比賽備註都用它。 */
const props = withDefaults(
  defineProps<{
    label: string
    rows?: number
    error?: string
    hint?: string
    required?: boolean
    placeholder?: string
    /** 顯示 `已輸入 / 上限` 的字數提示。 */
    maxlength?: number
  }>(),
  { rows: 5, required: false },
)

const model = defineModel<string>({ required: true })

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
    <div class="flex items-baseline justify-between gap-2">
      <label :for="id" class="text-fluid-sm font-medium">
        {{ label }}
        <span v-if="required" class="text-danger" aria-hidden="true">*</span>
      </label>
      <span v-if="maxlength" class="text-xs text-content-muted">
        {{ model.length }} / {{ maxlength }}
      </span>
    </div>

    <textarea
      :id="id"
      v-model="model"
      :rows="rows"
      :required="required"
      :maxlength="maxlength"
      :placeholder="placeholder"
      :aria-invalid="Boolean(error)"
      :aria-describedby="describedBy"
      class="rounded-lg border bg-surface px-3 py-2 text-base leading-relaxed transition placeholder:text-content-muted"
      :class="error ? 'border-danger' : 'border-border focus:border-brand-500'"
    />

    <p v-if="hint && !error" :id="hintId" class="text-xs text-content-muted">{{ hint }}</p>
    <p v-if="error" :id="errorId" class="text-xs text-danger" role="alert">{{ error }}</p>
  </div>
</template>
