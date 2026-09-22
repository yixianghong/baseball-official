import { defineEventHandler, getQuery, setResponseHeader, setResponseStatus } from 'h3'

/**
 * 圖片轉送 —— 只為了「把名單存成圖片」這件事而存在。
 *
 * ## 為什麼需要它
 * 分享功能要在瀏覽器把圖卡畫成 PNG，而 canvas 一旦畫進沒有 CORS 標頭的
 * 跨網域圖片就會被「污染」（tainted），`toBlob()` 直接拋 SecurityError。
 * 實測 `storage.googleapis.com` 上的隊徽**沒有**回傳 `Access-Control-Allow-Origin`
 * —— 預設的 bucket 沒有設定 CORS。
 *
 * 讓圖片改從自己的網域出來就沒有這個問題。另一條路是去 bucket 設 CORS 規則，
 * 但那要改動線上資源，而且每換一個 bucket 就得再設一次。
 *
 * ## ⚠️ 這支端點沒有登入保護，所以白名單是唯一的防線
 * 「給我一個網址、我去抓回來給你」就是 SSRF 的標準形狀 —— 沒有限制的話，
 * 任何人都能拿我們的伺服器去打內網或雲端的中繼資料端點
 * （169.254.169.254 那類）。所以：
 *
 * - 只接受 https
 * - 主機名稱必須完全等於已知的 Storage 網域
 * - 路徑必須落在**本專案自己的 bucket** 底下
 * - 回應必須是圖片，而且有大小上限
 *
 * 任何一條不符就回 400，不會發出任何請求。
 *
 * ## 為什麼不用 defineApiHandler
 * 它會把回傳值包成 JSON 信封，這裡要回的是二進位圖片本身 ——
 * 與同目錄的 `[id].get.ts` 同一個理由。
 */

/** 允許的 Storage 主機。必須完全相等，不做 `endsWith` 比對。 */
const ALLOWED_HOSTS = ['storage.googleapis.com', 'firebasestorage.googleapis.com']

/** 轉送的大小上限。隊徽是小圖，5MB 已經很寬鬆。 */
const MAX_BYTES = 5 * 1024 * 1024

export default defineEventHandler(async (event) => {
  const src = String(getQuery(event).src ?? '')
  const bucket = useRuntimeConfig(event).firebase.storageBucket

  if (!isAllowed(src, bucket)) {
    setResponseStatus(event, 400)
    return 'Bad Request'
  }

  const upstream = await fetch(src, { redirect: 'error' }).catch(() => null)
  if (!upstream?.ok) {
    setResponseStatus(event, 502)
    return 'Bad Gateway'
  }

  const contentType = upstream.headers.get('content-type') ?? ''
  if (!contentType.startsWith('image/')) {
    setResponseStatus(event, 415)
    return 'Unsupported Media Type'
  }

  const buffer = Buffer.from(await upstream.arrayBuffer())
  if (buffer.byteLength > MAX_BYTES) {
    setResponseStatus(event, 413)
    return 'Payload Too Large'
  }

  setResponseHeader(event, 'content-type', contentType)
  // 隊徽很少換，而且網址本身就帶著時間戳
  setResponseHeader(event, 'cache-control', 'public, max-age=3600, s-maxage=86400')
  return buffer
})

/** 網址是否指向本專案自己的 Storage bucket。 */
export function isAllowed(src: string, bucket: string): boolean {
  if (!bucket) return false

  let url: URL
  try {
    url = new URL(src)
  } catch {
    return false
  }

  if (url.protocol !== 'https:') return false
  if (!ALLOWED_HOSTS.includes(url.hostname)) return false

  // storage.googleapis.com/<bucket>/... 與 firebasestorage.googleapis.com/v0/b/<bucket>/...
  return url.pathname.startsWith(`/${bucket}/`) || url.pathname.startsWith(`/v0/b/${bucket}/`)
}
