<script setup lang="ts">
import type { UploadFolder } from '~/composables/api/useMediaApi'
import { formatBytes, prepareImage } from '~/utils/image'
import { ApiError } from '~/utils/api-error'

/**
 * 圖片欄位：上傳、預覽、移除，或直接貼外部網址。
 *
 * 保留「貼網址」這條路的理由很實際：Firebase Storage 還沒開通時仍然要能
 * 放圖片；有些球隊的照片本來就放在雲端硬碟或社群上。
 *
 * 壓縮在 `useUploadActions()` 裡完成（長邊 1600px），所以這個元件不需要
 * 知道任何圖片處理細節。
 */
const props = defineProps<{ label: string; folder: UploadFolder; hint?: string }>()

const model = defineModel<string>({ required: true })

const { uploadImage, loading } = useUploadActions()
const fileInput = ref<HTMLInputElement | null>(null)
const message = ref('')
const showUrlInput = ref(false)

async function handleFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  message.value = ''
  try {
    // 先在本地算一次大小，讓使用者知道壓縮後送出去的是多少
    const prepared = await prepareImage(file)
    const { url } = await uploadImage(file, props.folder)
    model.value = url
    message.value = `已上傳（${formatBytes(prepared.bytes)}）`
  } catch (err) {
    message.value =
      err instanceof Error && !(err instanceof ApiError) ? err.message : ApiError.from(err).message
  } finally {
    // 清空才能重複選同一個檔案
    input.value = ''
  }
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <span class="text-fluid-sm font-medium">{{ label }}</span>

    <div class="flex flex-wrap items-start gap-4">
      <div
        class="flex size-28 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-surface-muted"
      >
        <img v-if="model" :src="model" alt="目前的圖片" class="size-full object-cover" />
        <span v-else class="text-2xl text-content-muted" aria-hidden="true">🖼️</span>
      </div>

      <div class="flex min-w-0 flex-1 flex-col gap-2">
        <div class="flex flex-wrap gap-2">
          <UiBaseButton
            variant="secondary"
            size="sm"
            :loading="loading"
            @click="fileInput?.click()"
          >
            選擇圖片
          </UiBaseButton>
          <UiBaseButton variant="ghost" size="sm" @click="showUrlInput = !showUrlInput">
            {{ showUrlInput ? '收起網址' : '貼上網址' }}
          </UiBaseButton>
          <UiBaseButton v-if="model" variant="ghost" size="sm" @click="model = ''">
            移除
          </UiBaseButton>
        </div>

        <input ref="fileInput" type="file" accept="image/*" class="hidden" @change="handleFile" />

        <UiBaseInput v-if="showUrlInput" v-model="model" label="圖片網址" placeholder="https://…" />

        <p v-if="hint" class="text-xs text-content-muted">{{ hint }}</p>
        <p v-if="message" class="text-xs text-content-muted">{{ message }}</p>
      </div>
    </div>
  </div>
</template>
