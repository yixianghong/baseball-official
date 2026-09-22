import { z } from 'zod'

/**
 * 推播訂閱的共用契約。
 *
 * ## 這是唯一一支「匿名也能寫入」的資料
 * 架構紀律是「寫入端點先 `requireUser()`」，但推播訂閱的對象是一般訪客，
 * 本質上沒有身分可驗。所以防線改成三層，缺一不可：
 *
 * 1. **格式** —— 下面的 schema，欄位長度都有上限
 * 2. **來源** —— endpoint 必須是已知推送服務的網域（`isKnownPushService`）
 * 3. **流量** —— `server/middleware/30.rate-limit.ts` 擋同一個 IP 灌爆
 *
 * 少了第 2 條，這支端點就變成「任何人都能叫我們的伺服器去打任意網址」——
 * 也就是 SSRF。
 */

/**
 * 已知的推送服務網域。
 *
 * 每家瀏覽器各自營運自己的推送服務，訂閱時由瀏覽器決定 endpoint，
 * 網頁程式無法指定 —— 所以這份清單可以收得很緊。
 */
const PUSH_SERVICE_HOSTS = [
  // Chrome / Edge / 大多數 Chromium 系
  'fcm.googleapis.com',
  'android.googleapis.com',
  // Firefox
  'updates.push.services.mozilla.com',
  'autopush.stage.mozaws.net',
  // Safari / iOS
  'web.push.apple.com',
  // Edge（舊版 WNS）
  'notify.windows.com',
  'wns2-*.notify.windows.com',
] as const

/**
 * endpoint 是不是來自已知的推送服務。
 *
 * 只接受 https，並且比對主機名稱 —— 用 `URL.hostname` 而不是字串 `includes`，
 * 否則 `https://evil.com/?x=fcm.googleapis.com` 也會通過。
 */
export function isKnownPushService(endpoint: string): boolean {
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    return false
  }
  if (url.protocol !== 'https:') return false

  return PUSH_SERVICE_HOSTS.some((host) => {
    if (host.includes('*')) {
      const pattern = new RegExp(`^${host.replace(/[.]/g, '\\.').replace(/\*/g, '[a-z0-9-]+')}$`)
      return pattern.test(url.hostname)
    }
    return url.hostname === host
  })
}

/** 瀏覽器 `PushSubscription.toJSON()` 的形狀。 */
export const pushSubscriptionSchema = z.object({
  endpoint: z
    .string()
    .trim()
    .min(1, '缺少 endpoint')
    .max(1000, 'endpoint 過長')
    .refine(isKnownPushService, '不是已知的推送服務'),
  keys: z.object({
    /** 使用者裝置的公鑰（P-256，base64url）。 */
    p256dh: z.string().trim().min(1).max(200),
    /** 訊息驗證用的共用密鑰（base64url）。 */
    auth: z.string().trim().min(1).max(100),
  }),
})

export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>

export const pushSubscribeInputSchema = z.object({
  subscription: pushSubscriptionSchema,
  /** `pushsubscriptionchange` 時帶上舊的 endpoint，讓後端把舊紀錄清掉。 */
  replaces: z.string().trim().max(1000).optional(),
  /** 純粹給後台看的，方便辨認是哪台裝置。不做任何判斷。 */
  userAgent: z.string().trim().max(300).default(''),
})

export type PushSubscribeInput = z.input<typeof pushSubscribeInputSchema>

export const pushUnsubscribeInputSchema = z.object({
  endpoint: z.string().trim().min(1).max(1000),
})

/** 存進 Firestore 的樣子。 */
export const pushSubscriptionRecordSchema = pushSubscriptionSchema.extend({
  id: z.string(),
  userAgent: z.string().default(''),
  createdAt: z.string(),
  updatedAt: z.string(),
  /**
   * 連續發送失敗的次數。推送服務回 404／410 代表訂閱已失效，會直接刪除；
   * 這個欄位記的是其他錯誤（逾時、5xx），累積到上限才淘汰。
   */
  failureCount: z.number().int().min(0).default(0),
})

export type PushSubscriptionRecord = z.infer<typeof pushSubscriptionRecordSchema>

/** 實際送出去的通知內容。`sw.js` 的 `push` 事件會解析這個形狀。 */
export const pushPayloadSchema = z.object({
  title: z.string().trim().min(1, '請輸入通知標題').max(60, '標題最多 60 字'),
  body: z.string().trim().max(160, '內文最多 160 字').default(''),
  /**
   * 點擊通知要開啟的站內路徑。
   *
   * ⚠️ 只檢查「開頭是 /」是不夠的。`//evil.test` 也以 `/` 開頭，但它是
   * **協定相對網址** —— `new URL('//evil.test', origin)` 會解析成
   * `https://evil.test`。service worker 就是這樣把它交給 `openWindow()` 的，
   * 結果是一則看起來來自球隊、點下去卻連到別人網站的通知（開放重導向）。
   * `/\evil.test` 在部分瀏覽器也會被當成同一回事。
   */
  url: z
    .string()
    .trim()
    .max(300)
    .default('/')
    .refine(
      (value) => value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\'),
      '只能是站內路徑',
    ),
  /** 同 tag 的通知會互相取代，避免同一件事洗版。 */
  tag: z.string().trim().max(40).default('hgm-general'),
})

export type PushPayload = z.input<typeof pushPayloadSchema>
export type PushPayloadOutput = z.output<typeof pushPayloadSchema>

/** 一次發送的結果摘要，後台用來顯示「送給幾台裝置、幾台失敗」。 */
export const pushSendResultSchema = z.object({
  sent: z.number().int().min(0),
  failed: z.number().int().min(0),
  /** 這次順手清掉的失效訂閱數。 */
  pruned: z.number().int().min(0),
})

export type PushSendResult = z.infer<typeof pushSendResultSchema>

/* ══ 發送失敗的處理 ═══════════════════════════════════════════════════ */

/** 連續失敗幾次之後放棄這筆訂閱。 */
export const MAX_PUSH_FAILURES = 5

/**
 * 一次發送失敗之後該怎麼辦。
 *
 * 抽成純函式是因為這裡是唯一會**刪掉使用者資料**的判斷 —— 判斷錯了，
 * 症狀是「大家的通知莫名其妙都失效了」，而且完全沒有錯誤訊息可追。
 *
 * - `404` / `410`：推送服務明確說這筆訂閱不存在了（使用者清了網站資料、
 *   換手機、瀏覽器輪替了 endpoint）。留著只是每次發送都多打一次無效請求。
 * - 其他（逾時、429、5xx）：可能只是暫時的，不該因為一次抖動就讓人再也收不到。
 */
export function classifyPushFailure(
  status: number | undefined,
  failureCount: number,
): 'remove' | 'retry' {
  if (status === 404 || status === 410) return 'remove'
  return failureCount >= MAX_PUSH_FAILURES ? 'remove' : 'retry'
}
