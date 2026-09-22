<script setup lang="ts">
import type {
  Announcement,
  AnnouncementCategory,
  AnnouncementForm,
} from '#shared/schemas/announcement'
import { CATEGORY_LABELS } from '#shared/schemas/announcement'
import { formatDateTime } from '~/utils/format'

/**
 * 公告管理。
 *
 * 草稿與已發布在同一個列表裡，用標籤區分。草稿不會出現在前台，但登入後
 * 可以用同一個網址預覽 —— 發布前想先看看排版時很有用。
 */
definePageMeta({ layout: 'admin', middleware: 'auth' })

const { data: announcements, refresh, pending } = await useAdminAnnouncements()
const {
  createAnnouncement,
  updateAnnouncement,
  removeAnnouncement,
  loading: saving,
  error,
} = useAnnouncementActions()

const editingId = ref<string | null>(null)

const emptyForm = (): AnnouncementForm => ({
  title: '',
  content: '',
  category: 'general',
  pinned: false,
  status: 'published',
  publishedAt: '',
  coverImageUrl: '',
})

const form = ref<AnnouncementForm>(emptyForm())

const categoryOptions = (Object.keys(CATEGORY_LABELS) as AnnouncementCategory[]).map((key) => ({
  value: key,
  label: CATEGORY_LABELS[key],
}))

function startCreate() {
  editingId.value = 'new'
  form.value = emptyForm()
}

function startEdit(announcement: Announcement) {
  editingId.value = announcement.id
  form.value = {
    title: announcement.title,
    content: announcement.content,
    category: announcement.category,
    pinned: announcement.pinned,
    status: announcement.status,
    publishedAt: announcement.publishedAt,
    coverImageUrl: announcement.coverImageUrl,
  }
}

async function submit(status?: 'draft' | 'published') {
  if (status) form.value.status = status

  if (editingId.value === 'new') {
    await createAnnouncement(form.value)
  } else if (editingId.value) {
    await updateAnnouncement(editingId.value, form.value)
  }

  editingId.value = null
  await refresh()
}

async function handleDelete(id: string) {
  await removeAnnouncement(id)
  if (editingId.value === id) editingId.value = null
  await refresh()
}

/** 直接在列表上切換置頂，不必進編輯表單。 */
async function togglePinned(announcement: Announcement) {
  await updateAnnouncement(announcement.id, { pinned: !announcement.pinned })
  await refresh()
}

useHead({ title: '公告管理' })
</script>

<template>
  <div>
    <AdminHeader title="公告" description="發布球隊消息。置頂的公告會排在公告牆最前面。">
      <template #actions>
        <UiBaseButton @click="startCreate">＋ 新增公告</UiBaseButton>
      </template>
    </AdminHeader>

    <div class="grid gap-6" :class="editingId ? 'xl:grid-cols-[1fr_28rem]' : ''">
      <!-- ── 列表 ─────────────────────────────────────────────── -->
      <div>
        <UiBaseSpinner v-if="pending" />

        <ul v-else-if="announcements?.length" class="space-y-2">
          <li
            v-for="announcement in announcements"
            :key="announcement.id"
            class="rounded-xl border bg-surface p-4"
            :class="editingId === announcement.id ? 'border-brand-400' : 'border-border'"
          >
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="min-w-0 flex-1">
                <div class="mb-1.5 flex flex-wrap items-center gap-2">
                  <UiBaseBadge v-if="announcement.pinned" tone="accent" size="sm">置頂</UiBaseBadge>
                  <UiBaseBadge tone="neutral" size="sm">
                    {{ CATEGORY_LABELS[announcement.category] }}
                  </UiBaseBadge>
                  <UiBaseBadge
                    :tone="announcement.status === 'published' ? 'success' : 'warning'"
                    size="sm"
                  >
                    {{ announcement.status === 'published' ? '已發布' : '草稿' }}
                  </UiBaseBadge>
                  <time class="text-xs text-content-muted tabular-nums">
                    {{ formatDateTime(announcement.publishedAt) }}
                  </time>
                </div>

                <p class="font-semibold">{{ announcement.title }}</p>
                <p class="mt-1 line-clamp-2 text-fluid-sm text-content-muted">
                  {{ announcement.content }}
                </p>
              </div>

              <div class="flex shrink-0 flex-wrap gap-1">
                <UiBaseButton variant="ghost" size="sm" @click="togglePinned(announcement)">
                  {{ announcement.pinned ? '取消置頂' : '置頂' }}
                </UiBaseButton>
                <UiBaseButton variant="ghost" size="sm" @click="startEdit(announcement)">
                  編輯
                </UiBaseButton>
                <AdminDeleteButton :loading="saving" @confirm="handleDelete(announcement.id)" />
              </div>
            </div>
          </li>
        </ul>

        <UiBaseEmpty
          v-else
          title="還沒有公告"
          description="發布第一則公告，讓隊員知道最新消息。"
          icon="📣"
        >
          <UiBaseButton @click="startCreate">新增公告</UiBaseButton>
        </UiBaseEmpty>
      </div>

      <!-- ── 表單 ─────────────────────────────────────────────── -->
      <aside
        v-if="editingId"
        class="space-y-4 rounded-xl border border-border bg-surface p-5 xl:sticky xl:top-6 xl:h-fit"
      >
        <h2 class="text-fluid-lg font-bold">
          {{ editingId === 'new' ? '新增公告' : '編輯公告' }}
        </h2>

        <UiBaseInput
          v-model="form.title"
          label="標題"
          required
          :error="error?.fieldErrors.title?.[0]"
        />

        <UiBaseTextarea
          v-model="form.content"
          label="內容"
          :rows="10"
          :maxlength="5000"
          required
          hint="換行會原樣顯示在前台。"
          :error="error?.fieldErrors.content?.[0]"
        />

        <div class="grid grid-cols-2 gap-3">
          <UiBaseSelect v-model="form.category" label="分類" :options="categoryOptions" />
          <div class="flex items-end pb-2">
            <label class="flex min-h-11 items-center gap-2 text-fluid-sm font-medium">
              <input v-model="form.pinned" type="checkbox" class="size-4" />
              置頂這則公告
            </label>
          </div>
        </div>

        <AdminImageField v-model="form.coverImageUrl" label="封面圖片" folder="announcements" />

        <div class="flex flex-wrap gap-2 border-t border-border pt-4">
          <UiBaseButton :loading="saving" @click="submit('published')">
            {{ editingId === 'new' ? '發布' : '儲存並發布' }}
          </UiBaseButton>
          <UiBaseButton variant="secondary" :loading="saving" @click="submit('draft')">
            存為草稿
          </UiBaseButton>
          <UiBaseButton variant="ghost" @click="editingId = null">取消</UiBaseButton>
        </div>
      </aside>
    </div>
  </div>
</template>
