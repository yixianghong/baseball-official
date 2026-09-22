import { defineApiHandler } from '../utils/handler'
import { getSiteSettings } from '../repositories/settings'

/**
 * 網站設定（公開）。
 *
 * 隊名、Logo、主視覺、簡介這些每頁都會用到的東西。
 * 還沒在後台設定過時會回傳預設值，所以呼叫端不需要寫防禦式的 fallback。
 */
export default defineApiHandler(async () => {
  return await getSiteSettings()
})
