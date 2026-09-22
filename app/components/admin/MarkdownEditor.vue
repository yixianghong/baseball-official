<script setup lang="ts">
import type { TextEdit } from '~/utils/markdown-edit'
import { insertBlock, insertLink, toggleLinePrefix, toggleWrap } from '~/utils/markdown-edit'

/**
 * Markdown 編輯器。
 *
 * ## 為什麼是「原始碼 + 預覽」而不是所見即所得
 * 所見即所得的編輯器要自己維護一份文件模型，貼上外部內容時產生的髒標記
 * 是長期的麻煩來源。這裡存的本來就是 Markdown 純文字，讓人直接編輯它
 * 沒有任何轉換損失，也不需要多一個上百 KB 的相依套件。
 *
 * ## 預覽與前台是同一個元件
 * 預覽用的是 `UiBaseMarkdown` —— 前台公告卡片用的也是它。
 * 「後台預覽看起來沒問題，發布之後卻跑版」這件事因此不可能發生。
 *
 * 工具列的文字操作全部在 `~/utils/markdown-edit`，是可以單獨測的純函式。
 */
const props = withDefaults(
  defineProps<{
    label: string
    rows?: number
    error?: string
    hint?: string
    required?: boolean
    maxlength?: number
  }>(),
  { rows: 14, required: false },
)

const model = defineModel<string>({ required: true })

const id = useId()
const errorId = computed(() => `${id}-error`)
const hintId = computed(() => `${id}-hint`)
const describedBy = computed(() =>
  [props.hint ? hintId.value : '', props.error ? errorId.value : ''].filter(Boolean).join(' '),
)

const mode = ref<'write' | 'preview'>('write')
const textarea = ref<HTMLTextAreaElement | null>(null)

/**
 * 套用一次文字操作。
 *
 * 游標位置要等 Vue 把新的值寫回 textarea 之後才設得上去 —— 提早設會被
 * 接下來的 DOM 更新蓋掉，症狀是「按完粗體，游標跳到最後面」。
 */
async function apply(edit: TextEdit) {
  model.value = edit.text
  await nextTick()
  const element = textarea.value
  if (!element) return
  element.focus()
  element.setSelectionRange(edit.start, edit.end)
}

function run(transform: (text: string, start: number, end: number) => TextEdit) {
  const element = textarea.value
  if (!element) return
  void apply(transform(model.value, element.selectionStart, element.selectionEnd))
}

const tools = [
  { label: '粗體', title: '粗體（⌘/Ctrl + B）', run: () => wrap('**', '粗體') },
  { label: '斜體', title: '斜體（⌘/Ctrl + I）', run: () => wrap('*', '斜體') },
  { label: '標題', title: '標題', run: () => prefix(() => '## ', /^#{1,6} /) },
  { label: '清單', title: '項目清單', run: () => prefix(() => '- ', /^[-*+] /) },
  { label: '編號', title: '編號清單', run: () => prefix((i) => `${i + 1}. `, /^\d+\. /) },
  { label: '引用', title: '引用', run: () => prefix(() => '> ', /^> /) },
  { label: '連結', title: '連結（⌘/Ctrl + K）', run: () => run(insertLink) },
  { label: '分隔線', title: '分隔線', run: () => run((t, s, e) => insertBlock(t, s, e, '---')) },
]

function wrap(marker: string, placeholder: string) {
  run((text, start, end) => toggleWrap(text, start, end, marker, placeholder))
}

function prefix(make: (index: number) => string, match: RegExp) {
  run((text, start, end) => toggleLinePrefix(text, start, end, make, match))
}

/** 快捷鍵。瀏覽器對 ⌘B 沒有預設行為，但還是擋掉以免和擴充套件打架。 */
function onKeydown(event: KeyboardEvent) {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return
  const handlers: Record<string, () => void> = {
    b: () => wrap('**', '粗體'),
    i: () => wrap('*', '斜體'),
    k: () => run(insertLink),
  }
  const handler = handlers[event.key.toLowerCase()]
  if (!handler) return
  event.preventDefault()
  handler()
}
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

    <div
      class="overflow-hidden rounded-lg border"
      :class="error ? 'border-danger' : 'border-border'"
    >
      <!-- ── 工具列 ─────────────────────────────────────────────── -->
      <div class="flex flex-wrap items-center gap-1 border-b border-border bg-surface-muted p-1.5">
        <button
          v-for="tool in tools"
          :key="tool.label"
          type="button"
          class="min-h-8 rounded px-2 text-xs font-medium transition hover:bg-surface-raised disabled:opacity-40"
          :class="tool.label === '粗體' ? 'font-bold' : ''"
          :title="tool.title"
          :aria-label="tool.title"
          :disabled="mode === 'preview'"
          @click="tool.run"
        >
          {{ tool.label }}
        </button>

        <!-- 編輯／預覽切換推到最右邊，和左邊的插入動作分開 -->
        <div class="ml-auto flex gap-1">
          <button
            v-for="tab in [
              { value: 'write' as const, label: '編輯' },
              { value: 'preview' as const, label: '預覽' },
            ]"
            :key="tab.value"
            type="button"
            class="min-h-8 rounded px-2.5 text-xs font-medium transition"
            :class="
              mode === tab.value
                ? 'bg-brand-600 text-white'
                : 'text-content-muted hover:bg-surface-raised'
            "
            :aria-pressed="mode === tab.value"
            @click="mode = tab.value"
          >
            {{ tab.label }}
          </button>
        </div>
      </div>

      <!--
        textarea 用 v-show 而不是 v-if：v-if 會在切到預覽時把元素整個移除，
        回來時捲動位置與游標都沒了，而寫長公告時這非常惱人。
      -->
      <textarea
        v-show="mode === 'write'"
        :id="id"
        ref="textarea"
        v-model="model"
        :rows="rows"
        :required="required"
        :maxlength="maxlength"
        :aria-invalid="Boolean(error)"
        :aria-describedby="describedBy || undefined"
        class="block w-full resize-y bg-surface px-3 py-2 font-mono text-fluid-sm leading-relaxed"
        placeholder="支援 Markdown 語法"
        @keydown="onKeydown"
      />

      <div
        v-if="mode === 'preview'"
        class="bg-surface px-3 py-2"
        :style="{ minHeight: `${rows}em` }"
      >
        <UiBaseMarkdown v-if="model.trim()" :source="model" />
        <p v-else class="text-fluid-sm text-content-muted">還沒有內容。</p>
      </div>
    </div>

    <p v-if="hint && !error" :id="hintId" class="text-xs text-content-muted">{{ hint }}</p>
    <p v-if="error" :id="errorId" class="text-xs text-danger" role="alert">{{ error }}</p>
  </div>
</template>
