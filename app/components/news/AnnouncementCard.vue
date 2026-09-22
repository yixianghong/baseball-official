<script setup lang="ts">
import type { Announcement } from '#shared/schemas/announcement'
import { CATEGORY_LABELS } from '#shared/schemas/announcement'
import { formatDateTime } from '~/utils/format'

/**
 * 公告卡片。首頁與公告牆**共用同一份呈現**，沒有摘要模式。
 *
 * ## 為什麼不做摘要模式
 * 曾經有一個 `compact` 版本：內文裁到四行、附件只顯示「N 個附件」。
 * 實際用起來才發現方向錯了 —— 這個球隊的公告多半是
 * 「一句話 + 一個檔案」（戰績表的內文只有「更新日期 - 2026/05/18」），
 * **附件本身就是公告的內容**。把它收起來，首頁那張卡就等於什麼都沒說。
 *
 * 代價是很長的公告會把首頁撐高。真的遇到時該做的是公告詳細頁，
 * 而不是把內容藏起來假裝版面很整齊。
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
    <!--
      用 object-contain 而不是 cover：公告的封面多半是聯盟的隊徽或賽程圖，
      裁掉邊緣就等於把「這是哪個聯盟」裁掉了。照片裁一點無所謂，
      **有字的圖裁一點就是壞掉**。
      留白處給一層底色，讓它看起來是刻意留的而不是圖沒載到。
    -->
    <img
      v-if="announcement.coverImageUrl"
      :src="announcement.coverImageUrl"
      :alt="''"
      loading="lazy"
      class="aspect-video w-full bg-surface-muted object-contain"
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
        公告內容是 Markdown。安全性的說明見 `app/utils/markdown.ts` ——
        簡而言之：解析器設定成不輸出任何原始 HTML，所以不需要事後清洗。
      -->
      <UiBaseMarkdown class="text-fluid-sm text-content-muted" :source="announcement.content" />

      <!--
        附件放在內文之後、卡片最底下：它是補充資料，不該擠在標題與內容之間。
        `mt-auto` 讓同一列的卡片附件對齊底部。
      -->
      <NewsAttachmentList
        v-if="announcement.attachments.length"
        class="mt-auto pt-1"
        :attachments="announcement.attachments"
      />
    </div>
  </article>
</template>
