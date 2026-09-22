import type { MaybeRefOrGetter } from 'vue'
import type {
  Announcement,
  AnnouncementCategory,
  AnnouncementInput,
  AnnouncementPatch,
} from '#shared/schemas/announcement'

/**
 * 「公告」功能領域的所有 API 呼叫。
 *
 * 公開與後台是兩支不同的端點：公開的只回已發布，後台的含草稿。
 * 這個差異由路徑表達，不是靠參數 —— 前端也因此不可能「不小心」把草稿
 * 顯示在公開頁面上。
 */

const ENDPOINTS = {
  list: '/announcements',
  detail: (id: string) => `/announcements/${encodeURIComponent(id)}`,
  adminList: '/admin/announcements',
  create: '/admin/announcements',
  update: (id: string) => `/admin/announcements/${encodeURIComponent(id)}`,
} as const

/** 【宣告式】公開公告列表（只有已發布的）。 */
export function useAnnouncements(
  options: {
    category?: MaybeRefOrGetter<AnnouncementCategory | undefined>
    limit?: MaybeRefOrGetter<number>
  } = {},
) {
  const query = computed(() => ({
    category: toValue(options.category),
    limit: toValue(options.limit) ?? 50,
  }))
  return useApiFetch<Announcement[]>(ENDPOINTS.list, { query })
}

/** 【宣告式】單則公告。草稿需要登入才看得到。 */
export function useAnnouncement(id: MaybeRefOrGetter<string>) {
  return useApiFetch<Announcement>(() => ENDPOINTS.detail(String(toValue(id))))
}

/** 【宣告式】後台公告列表（含草稿，需登入）。 */
export function useAdminAnnouncements() {
  return useApiFetch<Announcement[]>(ENDPOINTS.adminList)
}

/** 【命令式】後台的公告寫入操作。 */
export function useAnnouncementActions() {
  const { post, patch, del, loading, error, attempt } = useApi()

  return {
    loading,
    error,
    attempt,
    createAnnouncement: (payload: AnnouncementInput) =>
      post<Announcement>(ENDPOINTS.create, payload),
    updateAnnouncement: (id: string, payload: AnnouncementPatch) =>
      patch<Announcement>(ENDPOINTS.update(id), payload),
    removeAnnouncement: (id: string) => del<{ deleted: boolean }>(ENDPOINTS.update(id)),
  }
}
