<script setup lang="ts">
import type { Attachment } from '#shared/schemas/attachment'
import {
  ATTACHMENT_ACCEPT,
  attachmentType,
  isImageAttachment,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
} from '#shared/schemas/attachment'
import { formatBytes } from '~/utils/image'
import { ApiError } from '~/utils/api-error'

/**
 * 附件欄位：上傳、列出、移除。
 *
 * 一次可以選好幾個檔案，但**逐一上傳**而不是並發：附件可以到 6MB，
 * 同時送四個會讓行動網路上的上傳全部變慢，而且哪一個失敗了也說不清楚。
 * 逐一送則可以在失敗時明確指出是哪個檔案，前面成功的也留著。
 */
const model = defineModel<Attachment[]>({ required: true })

const { uploadAttachment, loading } = useUploadActions()
const fileInput = ref<HTMLInputElement | null>(null)
const message = ref('')
const failed = ref(false)

const full = computed(() => model.value.length >= MAX_ATTACHMENTS)

async function handleFiles(event: Event) {
  const input = event.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  // 清空才能重複選同一個檔案
  input.value = ''
  if (files.length === 0) return

  message.value = ''
  failed.value = false

  for (const file of files) {
    if (model.value.length >= MAX_ATTACHMENTS) {
      message.value = `最多只能附 ${MAX_ATTACHMENTS} 個檔案，其餘未上傳`
      failed.value = true
      return
    }

    try {
      const attachment = await uploadAttachment(file)
      model.value = [...model.value, attachment]
      message.value = `已上傳 ${attachment.name}`
    } catch (err) {
      // prepareAttachment 丟的是給人看的訊息，API 的錯誤則統一走 ApiError
      message.value =
        err instanceof Error && !(err instanceof ApiError)
          ? err.message
          : ApiError.from(err).message
      failed.value = true
      return
    }
  }
}

function remove(index: number) {
  // 只從公告上移除，不刪 Storage 上的檔案 —— 同一個檔案可能被別則公告引用，
  // 而「儲存前反悔」也不該讓檔案真的消失。
  model.value = model.value.filter((_, i) => i !== index)
  message.value = ''
  failed.value = false
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="flex items-baseline justify-between gap-2">
      <span class="text-fluid-sm font-medium">附件</span>
      <span class="text-xs text-content-muted">{{ model.length }} / {{ MAX_ATTACHMENTS }}</span>
    </div>

    <ul v-if="model.length" class="flex flex-col gap-1.5">
      <li
        v-for="(attachment, index) in model"
        :key="attachment.url"
        class="flex items-center gap-2.5 rounded-lg border border-border bg-surface-muted px-2.5 py-2"
      >
        <img
          v-if="isImageAttachment(attachment.contentType)"
          :src="attachment.url"
          alt=""
          class="size-9 shrink-0 rounded bg-surface-muted object-contain"
        />
        <span
          v-else
          class="flex size-9 shrink-0 items-center justify-center rounded bg-surface text-fluid-base"
          aria-hidden="true"
        >
          {{ attachmentType(attachment.contentType).icon }}
        </span>

        <span class="min-w-0 flex-1">
          <span class="block truncate text-fluid-sm font-medium">{{ attachment.name }}</span>
          <span class="block text-xs text-content-muted">
            {{ attachmentType(attachment.contentType).label }}
            <template v-if="attachment.size">．{{ formatBytes(attachment.size) }}</template>
          </span>
        </span>

        <UiBaseButton
          variant="ghost"
          size="sm"
          :aria-label="`移除 ${attachment.name}`"
          @click="remove(index)"
        >
          ✕
        </UiBaseButton>
      </li>
    </ul>

    <div>
      <UiBaseButton
        variant="secondary"
        size="sm"
        :loading="loading"
        :disabled="full"
        @click="fileInput?.click()"
      >
        選擇檔案
      </UiBaseButton>
    </div>

    <input
      ref="fileInput"
      type="file"
      multiple
      :accept="ATTACHMENT_ACCEPT"
      class="hidden"
      @change="handleFiles"
    />

    <p class="text-xs text-content-muted">
      圖片、PDF、Word、Excel 或純文字，單檔最大 {{ formatBytes(MAX_ATTACHMENT_BYTES) }}。
      前台點擊後會開啟或下載。
    </p>
    <p v-if="message" class="text-xs" :class="failed ? 'text-danger' : 'text-content-muted'">
      {{ message }}
    </p>
  </div>
</template>
