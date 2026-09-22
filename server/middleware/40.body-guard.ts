import { defineEventHandler, getRequestHeader } from 'h3'
import { AppError, ERROR_CODE } from '../utils/errors'
import { SAFE_METHODS } from '../../shared/constants/http'

/**
 * 請求主體防護：限制大小與內容型別。
 *
 * ## 為什麼需要
 * - **大小限制**：沒有上限的話，一個 500MB 的 POST 就能把 Node 的記憶體吃光
 *   （DoS）。在讀取 body 之前就先擋掉，成本最低。
 * - **型別白名單**：只接受預期的 Content-Type，可以擋掉一部分利用解析器差異
 *   的攻擊，也讓後續的 `readBody` 行為可預期。
 *
 * ## 圖片相關路由的較寬上限
 * 後台的圖片上傳與 AI 辨識會帶著 base64 圖片，用一般的 1MB 上限一定會被擋。
 * 這些路由改用 `maxUploadBytes`（預設 8MB）。
 *
 * 圖片走 JSON + base64 而不是 `multipart/form-data`，因此下方的內容型別
 * 白名單不需要放寬 —— 少開一個口，就少一種可能被利用的解析器差異。
 * 代價是 base64 會膨脹約 33%，設定上限時要把這點算進去。
 */

/** 帶檔案的路由前綴，適用較寬的 body 上限。 */
const UPLOAD_ROUTE_PREFIXES = ['/api/admin/uploads', '/api/admin/attachments', '/api/admin/ai/']

/** 允許的 request body 內容型別。 */
const ALLOWED_CONTENT_TYPES = [
  'application/json',
  'application/x-www-form-urlencoded',
  'text/plain',
]

export default defineEventHandler((event) => {
  // 安全方法（GET/HEAD/OPTIONS）沒有 body，不需要檢查
  if (SAFE_METHODS.includes(event.method as (typeof SAFE_METHODS)[number])) return

  const config = useRuntimeConfig(event)

  // --- 大小檢查 ---
  // ⚠️ 用戶端若使用 chunked transfer encoding 就不會送 content-length，
  // 這一關擋不到。它是「成本極低的第一道防線」，不是唯一防線 ——
  // 正式環境請同時在反向代理（Nginx 的 client_max_body_size、
  // ALB / Cloudflare 的 body size limit）設定硬上限。
  const isUploadRoute = UPLOAD_ROUTE_PREFIXES.some((prefix) => event.path.startsWith(prefix))
  const limit = isUploadRoute ? config.maxUploadBytes : config.maxBodyBytes

  const contentLengthHeader = getRequestHeader(event, 'content-length')
  if (contentLengthHeader) {
    const contentLength = Number(contentLengthHeader)
    if (Number.isFinite(contentLength) && contentLength > limit) {
      event.context.logger?.warn(
        { contentLength, limit, path: event.path },
        'request body too large',
      )
      throw new AppError(
        ERROR_CODE.PAYLOAD_TOO_LARGE,
        `傳送的資料超過上限（${Math.floor(limit / 1024 / 1024)} MB），請壓縮或改用較小的檔案`,
      )
    }
  }

  // --- 型別檢查 ---
  const contentType = getRequestHeader(event, 'content-type')

  // 完全沒有 body 的 POST（例如 logout）不帶 Content-Type 是合法的。
  // 注意這裡判斷的是「有沒有 Content-Type」而不是「content-length 是否為 0」——
  // chunked encoding 的請求沒有 content-length，用長度判斷會讓型別檢查被整個跳過。
  if (!contentType) return

  // Content-Type 可能帶參數（`application/json; charset=utf-8`），取分號前那段比對
  const mediaType = contentType.split(';')[0]?.trim().toLowerCase() ?? ''

  if (!ALLOWED_CONTENT_TYPES.includes(mediaType)) {
    throw new AppError(ERROR_CODE.BAD_REQUEST, `不支援的內容型別：${mediaType || '(未指定)'}`)
  }
})
