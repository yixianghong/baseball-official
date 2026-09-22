<script setup lang="ts">
import { MAX_ANNOUNCEMENT_QUERY_LIMIT } from '#shared/schemas/announcement'
import { CATEGORY_LABELS, type AnnouncementCategory } from '#shared/schemas/announcement'

/**
 * 公告牆。
 *
 * 卡片網格，捲到哪一張才淺入哪一張（`v-reveal`，見
 * `app/plugins/reveal.client.ts`）。純呈現，沒有留言或按讚。
 */
const selectedCategory = ref<AnnouncementCategory | ''>('')
const categoryFilter = computed(() => selectedCategory.value || undefined)

const {
  data: announcements,
  pending,
  error,
  refresh,
} = await useAnnouncements({ category: categoryFilter, limit: MAX_ANNOUNCEMENT_QUERY_LIMIT })

const categories = computed(() => [
  { value: '' as const, label: '全部' },
  ...(Object.keys(CATEGORY_LABELS) as AnnouncementCategory[]).map((key) => ({
    value: key,
    label: CATEGORY_LABELS[key],
  })),
])

useHead({ title: '公告' })
</script>

<template>
  <div>
    <CommonPageHero en="NEWS" zh="公告" description="球隊的最新消息、賽事通知與活動資訊。" />

    <div class="container-content py-12 md:py-16">
      <div>
        <!-- 分類篩選：選項不多，用一排按鈕比下拉選單少一次點擊 -->
        <div class="mb-8 flex flex-wrap gap-2" role="group" aria-label="公告分類篩選">
          <button
            v-for="category in categories"
            :key="category.value"
            type="button"
            class="min-h-9 rounded-full border px-4 text-fluid-sm font-medium transition"
            :class="
              selectedCategory === category.value
                ? 'border-brand-600 bg-brand-600 text-white'
                : 'border-border text-content-muted hover:bg-surface-muted'
            "
            :aria-pressed="selectedCategory === category.value"
            @click="selectedCategory = category.value"
          >
            {{ category.label }}
          </button>
        </div>

        <UiBaseSpinner v-if="pending" label="公告載入中…" />

        <UiBaseError v-else-if="error" :error="error" @retry="refresh" />

        <div v-else-if="announcements?.length" class="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          <NewsAnnouncementCard
            v-for="(announcement, index) in announcements"
            :key="announcement.id"
            :announcement="announcement"
            :delay="(index % 3) * 90"
          />
        </div>

        <UiBaseEmpty v-else title="目前沒有公告" description="有新消息時會發布在這裡。" icon="📣" />
      </div>
    </div>
  </div>
</template>
