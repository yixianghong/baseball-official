import type { H3Event } from 'h3'
import { z } from 'zod'
import type { ClipPrivacy } from '../../shared/schemas/game'
import { createExternalClient } from './external'
import { AppError, ERROR_CODE } from './errors'

/**
 * YouTube Data API —— 賽事錄影用（見 `docs/game-recording-plan.md`）。
 *
 * ## 這裡不上傳檔案
 * 一段 1080p 有 85～140 MB，經過 BFF 就要吃 Cloud Run 的記憶體與逾時，
 * 還要付兩次流量。**檔案由瀏覽器直傳 YouTube**，這支模組只做兩件事：
 *
 * 1. 用 refresh token 換一個短效的 access token 給瀏覽器
 * 2. 把影片的可見度讀回來
 *
 * ## ⚠️ 上傳的影片一律是私人的
 * 未通過 YouTube 合規稽核的專案（2020/07/28 之後建立的都算）強制如此，
 * 和我們送什麼 `privacyStatus` 無關。管理者要到 YouTube Studio 手動改成公開，
 * 改完後台按「更新影片狀態」才會同步回來 —— 那就是 `fetchClipPrivacy()`。
 */

const youtubeClient = createExternalClient({
  name: 'youtube',
  baseUrl: () => 'https://www.googleapis.com/youtube/v3',
})

const oauthClient = createExternalClient({
  name: 'google-oauth',
  baseUrl: () => 'https://oauth2.googleapis.com',
})

export function isYouTubeConfigured(event: H3Event): boolean {
  const { clientId, clientSecret, refreshToken } = useRuntimeConfig(event).youtube
  return Boolean(clientId && clientSecret && refreshToken)
}

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  /** 秒數。Google 目前給 3599，但不要寫死。 */
  expires_in: z.number().int().positive().default(3600),
})

/**
 * 換一個 access token。
 *
 * ## 為什麼要快取
 * access token 有效一小時，而一場比賽會上傳十四次。每次都去換一次等於
 * 十四趟多餘的往返，而且 Google 對 token 端點也有速率限制。
 *
 * 快取放在 Nitro 的 `cache` storage 而不是模組層的變數：`minInstances: 0`
 * 的環境會不斷起新容器，模組層的變數活不過一次冷啟動。
 *
 * **提早 5 分鐘過期**：token 拿去給瀏覽器之後，上傳可能要跑好幾分鐘 ——
 * 剛好在邊緣拿到的 token 會在上傳到一半時失效，而那時檔案已經傳了一半。
 */
const EXPIRY_MARGIN_MS = 5 * 60 * 1000
const CACHE_KEY = 'youtube:access-token'

export async function getAccessToken(event: H3Event): Promise<{
  accessToken: string
  expiresAt: number
}> {
  if (!isYouTubeConfigured(event)) {
    throw new AppError(ERROR_CODE.SERVICE_UNAVAILABLE, '尚未設定 YouTube 上傳', { expose: true })
  }

  const storage = useStorage('cache')
  const cached = await storage.getItem<{ accessToken: string; expiresAt: number }>(CACHE_KEY)
  if (cached && cached.expiresAt - EXPIRY_MARGIN_MS > Date.now()) return cached

  const { clientId, clientSecret, refreshToken } = useRuntimeConfig(event).youtube

  const raw = await oauthClient(event, '/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
  })

  const parsed = tokenResponseSchema.safeParse(raw)
  if (!parsed.success) {
    /*
     * 最常見的原因是 refresh token 失效了，而它失效的原因幾乎都是同一個：
     * OAuth 同意畫面停在「測試中」，token 7 天就過期。訊息要講出來 ——
     * 否則這裡只會是一個無從查起的「外部服務錯誤」。
     */
    throw new AppError(
      ERROR_CODE.SERVICE_UNAVAILABLE,
      'YouTube 授權失效，請重新執行 pnpm youtube:auth 取得 refresh token（並確認 OAuth 同意畫面已發布為正式版）',
      { expose: true },
    )
  }

  const token = {
    accessToken: parsed.data.access_token,
    expiresAt: Date.now() + parsed.data.expires_in * 1000,
  }
  await storage.setItem(CACHE_KEY, token)
  return token
}

const videoListSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string(),
        status: z.object({ privacyStatus: z.string() }),
      }),
    )
    .default([]),
})

/** YouTube 回的字串不一定在我們的列舉裡（它還有 `privacyStatusUnspecified`）。 */
function toClipPrivacy(value: string): ClipPrivacy {
  return value === 'public' || value === 'unlisted' ? value : 'private'
}

/**
 * 問 YouTube 這幾支影片現在的可見度。
 *
 * 一次問完整場（`id` 可以帶逗號分隔），配額只花 1 單位 —— 逐支問的話
 * 一場十四段就是十四單位，而且十四趟往返。
 *
 * 查不到的影片（被刪掉了）不會出現在回應裡，呼叫端據此判斷。
 */
export async function fetchClipPrivacy(
  event: H3Event,
  videoIds: string[],
): Promise<Record<string, ClipPrivacy>> {
  if (videoIds.length === 0) return {}

  const { accessToken } = await getAccessToken(event)

  const raw = await youtubeClient(event, '/videos', {
    query: { part: 'status', id: videoIds.join(','), maxResults: String(videoIds.length) },
    headers: { authorization: `Bearer ${accessToken}` },
  })

  const parsed = videoListSchema.safeParse(raw)
  if (!parsed.success) return {}

  return Object.fromEntries(
    parsed.data.items.map((item) => [item.id, toClipPrivacy(item.status.privacyStatus)]),
  )
}
