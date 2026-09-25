import { defineApiHandler } from '../../../utils/handler'
import { requireUser } from '../../../utils/session'
import { getAccessToken, isYouTubeConfigured } from '../../../utils/youtube'

/**
 * 發一個短效的 YouTube access token 給瀏覽器（需登入）。
 *
 * ## 為什麼要把權杖交給前端
 * 一段 1080p 有 85～140 MB。經過 BFF 轉送就要吃 Cloud Run 的記憶體與請求
 * 逾時，而且同一份資料要走兩趟網路。讓瀏覽器拿著短效權杖直傳 YouTube，
 * 檔案完全不經過我們 —— 沒有 Storage 費、沒有流量費、沒有逾時問題。
 *
 * ## 交出去的是什麼
 * **只有 access token**，一小時效期，範圍是 `youtube.upload` + `youtube.readonly`。
 * refresh token（那把可以一直換新權杖的）始終留在 Secret Manager。
 * 而且只發給已經登入後台的人。
 */
export default defineApiHandler(async (event) => {
  await requireUser(event)

  if (!isYouTubeConfigured(event)) {
    // 功能沒設定不是錯誤，是「還沒開」—— 前端據此把上傳整個關掉，只留下載
    return { configured: false as const }
  }

  const { accessToken, expiresAt } = await getAccessToken(event)
  return { configured: true as const, accessToken, expiresAt }
})
