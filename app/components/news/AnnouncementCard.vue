<script setup lang="ts">
import type { Announcement } from '#shared/schemas/announcement'
import { CATEGORY_LABELS } from '#shared/schemas/announcement'
import { formatDateTime } from '~/utils/format'

/**
 * 公告卡片。
 *
 * ## 進場動畫
 * `v-reveal` 會把還在視窗外的卡片先藏起來，捲到時再淺入。
 * `delay` 讓同一列的卡片依序浮現 —— 全部同時出現會顯得很突兀。
 *
 * 動畫純粹是視覺效果：卡片**預設就是看得見的**，JavaScript 沒執行時
 * 內容照常顯示（見 `main.css` 的 `.reveal` 與 `app/plugins/reveal.ts`）。
 */
const props = defineProps<{
  announcement: Announcement
  /** 進場延遲毫秒數，由列表依索引遞增傳入。 */
  delay?: number
  /** 摘要模式：首頁用，只顯示前幾行。 */
  compact?: boolean
}>()

const tone = computed(() => {
  switch (props.announcement.category) {
    case 'game':
      return 'brand' as const
    case 'training':
      return 'success' as const
    case 'event':
      return 'accent' as const
    case 'recruit':
      return 'warning' as const
    default:
      return 'neutral' as const
  }
})
</script>

<template>
  <article
    v-reveal="delay ?? 0"
    class="reveal surface-card lift flex flex-col overflow-hidden rounded-xl border bg-surface-raised"
    :class="
      announcement.pinned
        ? 'border-accent-500/40 hover:border-accent-500'
        : 'border-border hover:border-brand-400'
    "
  >
    <img
      v-if="announcement.coverImageUrl"
      :src="announcement.coverImageUrl"
      :alt="''"
      loading="lazy"
      class="aspect-video w-full object-cover"
    />

    <div class="flex flex-1 flex-col gap-3 p-5">
      <div class="flex flex-wrap items-center gap-2">
        <UiBaseBadge v-if="announcement.pinned" tone="accent" size="sm">置頂</UiBaseBadge>
        <UiBaseBadge :tone="tone" size="sm">
          {{ CATEGORY_LABELS[announcement.category] }}
        </UiBaseBadge>
        <UiBaseBadge v-if="announcement.status === 'draft'" tone="warning" size="sm">
          草稿
        </UiBaseBadge>
        <time class="ml-auto text-xs text-content-muted tabular-nums">
          {{ formatDateTime(announcement.publishedAt) }}
        </time>
      </div>

      <h3 class="text-fluid-lg font-semibold leading-snug">
        {{ announcement.title }}
      </h3>

      <!--
        公告內容是純文字，換行以 \n 保存。用 whitespace-pre-wrap 呈現，
        既保留了作者的分段，又不必引入 Markdown 解析與它帶來的 XSS 風險。
      -->
      <p
        class="whitespace-pre-wrap text-fluid-sm leading-relaxed text-content-muted"
        :class="compact ? 'line-clamp-3' : ''"
      >
        {{ announcement.content }}
      </p>
    </div>
  </article>
</template>
