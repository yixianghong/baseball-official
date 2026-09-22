<script setup lang="ts">
import { renderMarkdown } from '~/utils/markdown'

/**
 * 呈現一段 Markdown。公告內容用它，後台的預覽也用同一個元件 ——
 * 「預覽」與「前台實際長相」因此不可能不一致。
 */
const props = defineProps<{ source: string }>()

const html = computed(() => renderMarkdown(props.source))
</script>

<template>
  <!--
    這裡用 v-html 是刻意的，而且是安全的：`renderMarkdown()` 設定了
    `html: false`，原始碼裡的標籤一律被跳脫成文字，解析器不可能產生
    `<script>` 或事件屬性。連結也另外過了白名單。詳見 `app/utils/markdown.ts`。
  -->
  <!-- eslint-disable-next-line vue/no-v-html -->
  <div class="markdown" v-html="html" />
</template>
