import { defineEventHandler, removeResponseHeader, setResponseHeaders } from 'h3'

/**
 * 基礎資安回應標頭。
 *
 * 這些 header 是「零成本」的防護：不影響效能、不改變業務邏輯，
 * 但能擋掉大量常見攻擊。逐條說明如下。
 *
 * > 想要更完整的方案（含 nonce-based CSP、CSRF、跨域隔離）可以改用
 * > `nuxt-security` 模組。這裡自己實作是為了讓每一條規則都攤開可見、
 * > 方便各專案依需求增刪，不必去猜模組的預設值是什麼。
 */

const isProduction = process.env.NODE_ENV === 'production'

/**
 * Content-Security-Policy。
 *
 * ⚠️ 這裡的 `script-src` 含 `'unsafe-inline'`，原因是 Nuxt 的 SSR payload
 * （hydration 資料）是以 inline script 注入的。要拿掉它需要 nonce 機制，
 * 那需要在 SSR 渲染時把 nonce 注入每個 script 標籤 —— 建議直接用
 * `nuxt-security` 模組處理，而不是自己接。
 *
 * 若你的專案是純靜態內容站、不需要 hydration，可以直接移除 `'unsafe-inline'`
 * 取得更強的 XSS 防護。
 */
/**
 * 「預測世界大賽冠軍」小遊戲的 Realtime Database（限期活動，見 `docs/ws-bracket.md`）。
 *
 * ⚠️ 這是唯一一個**由設定決定**的 CSP 例外，而不是寫死的來源。這樣做是為了
 * 讓它自己清乾淨：活動結束、環境變數一拿掉，這條例外就跟著消失，
 * 不會留下一條沒有人記得為什麼在的規則。
 *
 * 要開 `wss:` 是因為 RTDB 的即時推送走 WebSocket；只開 `https:` 的話
 * SDK 會退回長輪詢（**能動**，但每幾十秒一次請求，等於把即時性弄丟了），
 * 而且畫面上完全看不出差別 —— 只有 console 裡一行被擋掉的連線。
 */
export function wsBracketOrigins(url: string | undefined): string[] {
  if (!url) return []
  try {
    const { origin, host } = new URL(url)

    /*
     * ⚠️ **SDK 連的不只是設定裡的那個主機。**
     *
     * RTDB 會把連線導到同一個區域的分片主機，例如
     * `s-gke-apse1-nssi4-7.asia-southeast1.firebasedatabase.app` ——
     * 主機名是 Google 動態決定的，列不出來。只開設定裡那一個的話，
     * 連線會**有時候成功、有時候被擋**，而被擋的樣子是畫面永遠顯示
     * 「共 0 注」，跟「真的沒有人下注」完全分不出來。
     *
     * 所以放寬到同一個區域的萬用字元（把主機名的第一段換成 `*`）。
     * 它仍然只涵蓋 Firebase 自己的網域，不是 `https:` 全開。
     */
    const suffix = host.split('.').slice(1).join('.')
    return [origin, `wss://${host}`, `https://*.${suffix}`, `wss://*.${suffix}`]
  } catch {
    return []
  }
}

function buildCsp(): string {
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    // 限制 <base> 標籤，避免攻擊者改寫相對路徑的解析基準
    'base-uri': ["'self'"],
    // 禁止 <object>/<embed>，這類老舊標籤是常見的 XSS 載體
    'object-src': ["'none'"],
    // 禁止本站被任何頁面嵌入 iframe —— 防點擊劫持（clickjacking）
    'frame-ancestors': ["'none'"],
    // 表單只能送往本站，防止釣魚頁面把表單導到外部
    'form-action': ["'self'"],
    'img-src': ["'self'", 'data:', 'https:'],
    'font-src': ["'self'", 'data:'],
    'style-src': ["'self'", "'unsafe-inline'"],
    'script-src': ["'self'", "'unsafe-inline'"],
    /*
     * 前端原則上只能打自己的 BFF，這裡只開一個例外：
     * 賽事錄影的片段由瀏覽器**直傳** YouTube（見 `server/utils/youtube.ts`）。
     *
     * 為什麼不讓檔案走 BFF：一段 1080p 有 85～140 MB，經過 Cloud Run 就要
     * 吃記憶體與請求逾時，而且同一份資料要走兩趟網路。
     *
     * 只開 `googleapis.com`，不是整個 `https:` —— 這條規則的價值就在於
     * 「前端不能把資料送去任意地方」，開太寬等於沒開。
     */
    'connect-src': [
      "'self'",
      'https://www.googleapis.com',
      ...wsBracketOrigins(process.env.NUXT_PUBLIC_WS_BRACKET_DATABASE_URL),
    ],
    /*
     * 只開一個來源：YouTube 的嵌入播放器（賽事錄影，見
     * `docs/game-recording-plan.md`）。
     *
     * 沒有這一條的話會 fallback 到 `default-src 'self'`，iframe 直接被擋 ——
     * 而症狀只有 console 裡一行 `Refused to frame`，畫面上是一塊空白。
     *
     * 用 `youtube-nocookie.com` 而不是 `youtube.com`：訪客還沒按播放
     * 就不該被種追蹤 cookie。刻意不比照 `img-src` 開整個 `https:` ——
     * iframe 能做的事比 `<img>` 多得多。
     */
    'frame-src': ["'self'", 'https://www.youtube-nocookie.com'],
    /*
     * Service Worker 只能從本站載入。
     *
     * 不寫這一條也會退回 `default-src 'self'`，結果相同 —— 明確列出是因為
     * SW 的權限極大（能攔截本站所有請求、能收推播），它從哪裡來這件事
     * 應該攤在這份清單上，而不是靠讀者去推導 fallback 鏈。
     */
    'worker-src': ["'self'"],
    // manifest 同理：它決定了安裝到桌面後的名稱與圖示
    'manifest-src': ["'self'"],
  }

  if (!isProduction) {
    // Vite dev server 需要 eval 與 websocket 熱更新
    directives['script-src']!.push("'unsafe-eval'")
    directives['connect-src']!.push('ws:', 'wss:')
  }

  const policy = Object.entries(directives)
    .map(([key, values]) => `${key} ${values.join(' ')}`)
    .join('; ')

  // 正式環境把所有 http 子資源自動升級成 https
  return isProduction ? `${policy}; upgrade-insecure-requests` : policy
}

const CSP = buildCsp()

export default defineEventHandler((event) => {
  setResponseHeaders(event, {
    'Content-Security-Policy': CSP,

    // 禁止瀏覽器「猜」內容型別。可防止把上傳的圖片當成 script 執行。
    'X-Content-Type-Options': 'nosniff',

    // 舊瀏覽器的點擊劫持防護（新瀏覽器看 CSP frame-ancestors）
    'X-Frame-Options': 'DENY',

    // 跨站導覽時只送出來源網域，不洩漏完整路徑與 query（可能含敏感參數）
    'Referrer-Policy': 'strict-origin-when-cross-origin',

    /*
     * 裝置權限一律關閉，只放行真的用得到的。
     *
     * `camera` 與 `microphone` 開給**自己**（`self`）是為了後台的球賽錄影頁
     * （`/admin/record/[id]`，見 `docs/game-recording-plan.md`）。
     *
     * ⚠️ 這個標頭關著的時候，`getUserMedia()` 會直接失敗，而且**錯誤訊息
     * 完全不會提到 Permissions-Policy** —— 看起來就像使用者拒絕了權限，
     * 或是相機壞掉。要改相機相關的功能時，先確認這一行。
     *
     * 只給 `self` 而不是 `*`：本站禁止被嵌入 iframe（`frame-ancestors 'none'`），
     * 所以沒有任何第三方情境需要這兩項權限。
     */
    'Permissions-Policy': 'camera=(self), microphone=(self), geolocation=(), payment=(), usb=()',

    // 跨來源隔離：限制其他網站對本站資源的讀取與參照
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
  })

  if (isProduction) {
    // HSTS：告訴瀏覽器往後一年內只用 HTTPS 連本站，防降級與中間人攻擊。
    // 只在正式環境送出 —— 在 localhost 送會讓瀏覽器把 http://localhost 也強制轉 https。
    setResponseHeaders(event, {
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    })
  }

  // 不要告訴攻擊者我們用什麼技術棧
  removeResponseHeader(event, 'x-powered-by')
})
