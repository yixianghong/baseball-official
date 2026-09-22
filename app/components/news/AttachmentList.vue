<script setup lang="ts">
import type { Attachment } from '#shared/schemas/attachment'
import { attachmentType, isImageAttachment } from '#shared/schemas/attachment'
import { formatBytes } from '~/utils/image'

/**
 * 公告附件清單。
 *
 * ## 點下去會「開啟」還是「下載」，由瀏覽器決定
 * 我們送的是 `Content-Disposition: inline` + 正確的 `Content-Type`，所以
 * 圖片與 PDF 直接開起來看，Word／Excel 則自動變成下載 —— 這正是大家對
 * 一個附件連結的預期。
 *
 * 刻意**不加 `download` 屬性**：檔案放在 storage.googleapis.com，跨網域時
 * 瀏覽器會忽略 `download`，於是「下載」按鈕有時下載、有時開新分頁。
 * 一個行為不穩定的按鈕比沒有按鈕更糟。
 *
 * ## 圖片用縮圖當圖示
 * 一排 📎 看不出哪個是上週的合照。縮圖是這裡最有資訊量的東西。
 */
const props = defineProps<{ attachments: Attachment[] }>()

const items = computed(() =>
  props.attachments.map((attachment) => ({
    ...attachment,
    isImage: isImageAttachment(attachment.contentType),
    type: attachmentType(attachment.contentType),
  })),
)
</script>

<template>
  <div v-if="attachments.length">
    <ul class="flex flex-col gap-1.5">
      <li v-for="item in items" :key="item.url">
        <a
          :href="item.url"
          target="_blank"
          rel="noopener noreferrer"
          class="flex items-center gap-2.5 rounded-lg border border-border bg-surface px-2.5 py-2 transition hover:border-brand-400 hover:bg-surface-muted"
        >
          <img
            v-if="item.isImage"
            :src="item.url"
            alt=""
            loading="lazy"
            class="size-9 shrink-0 rounded bg-surface-muted object-contain"
          />
          <span
            v-else
            class="flex size-9 shrink-0 items-center justify-center rounded bg-surface-muted text-fluid-base"
            aria-hidden="true"
          >
            {{ item.type.icon }}
          </span>

          <span class="min-w-0 flex-1">
            <!-- 檔名可能很長，而且中文可以在任何字之間斷行 -->
            <span class="block truncate text-fluid-sm font-medium">{{ item.name }}</span>
            <span class="block text-xs text-content-muted">
              {{ item.type.label }}
              <template v-if="item.size">．{{ formatBytes(item.size) }}</template>
            </span>
          </span>

          <span class="shrink-0 text-content-muted" aria-hidden="true">↗</span>
        </a>
      </li>
    </ul>
  </div>
</template>
