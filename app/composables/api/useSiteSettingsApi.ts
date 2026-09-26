import type { SiteSettings, SiteSettingsInput } from '#shared/schemas/settings'

/**
 * 「網站設定」功能領域的 API 呼叫。
 *
 * 隊名、Logo、主視覺這些每頁都要用的東西。`useSiteSettings()` 用固定的
 * `key` 讓 Nuxt 在同一次 SSR 中共用同一份結果 —— 版面與頁面都呼叫它時
 * 只會實際請求一次。
 */

const ENDPOINTS = {
  get: '/site-settings',
  update: '/admin/settings',
} as const

/**
 * 【宣告式】網站設定。還沒設定過時後端會回預設值，所以不必寫 fallback。
 *
 * ## ⚠️ 這是全站唯一關掉 `revalidateOnEnter` 的地方
 * `useApiFetch` 預設「進到頁面就重新確認一次」，理由見那裡的說明。
 * 這一支是例外，因為三個條件同時成立：
 *
 * 1. **掛在 layout 上**（`layouts/default.vue`、`layouts/admin.vue`），
 *    layout 換頁時不卸載，所以快取永遠不會被清掉
 * 2. **每一頁都要**，十幾個頁面都呼叫它
 * 3. **幾乎不會變** —— 隊名與隊徽是設定一次就放著的東西
 *
 * 開著的話就變成「每換一頁都多一個阻塞的來回去拿同一份隊名」。
 *
 * 代價說清楚：在後台改完隊名之後，**已經開著的分頁要重新整理才會更新**。
 * 這是刻意的取捨 —— 改設定是幾個月一次的事，換頁是每分鐘好幾次的事。
 */
export function useSiteSettings() {
  return useApiFetch<SiteSettings>(ENDPOINTS.get, {
    key: 'site-settings',
    revalidateOnEnter: false,
  })
}

/** 【命令式】更新網站設定（需登入）。 */
export function useSiteSettingsActions() {
  const { put, loading, error, attempt } = useApi()

  return {
    loading,
    error,
    attempt,
    updateSettings: (payload: SiteSettingsInput) => put<SiteSettings>(ENDPOINTS.update, payload),
  }
}
