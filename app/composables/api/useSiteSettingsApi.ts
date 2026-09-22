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

/** 【宣告式】網站設定。還沒設定過時後端會回預設值，所以不必寫 fallback。 */
export function useSiteSettings() {
  return useApiFetch<SiteSettings>(ENDPOINTS.get, { key: 'site-settings' })
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
