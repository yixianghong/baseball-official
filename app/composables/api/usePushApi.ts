import type { PushPayload, PushSendResult } from '#shared/schemas/push'

/**
 * 「推播」功能領域的所有 API 呼叫。
 *
 * 訂閱與退訂是公開端點（訪客不需要登入也能訂閱球隊公告），
 * 發送與狀態查詢在後台。這個差異一樣由路徑表達。
 */

const ENDPOINTS = {
  subscribe: '/push/subscribe',
  unsubscribe: '/push/unsubscribe',
  send: '/admin/push/send',
  status: '/admin/push/status',
} as const

export interface PushStatus {
  /** 站台有沒有設定 VAPID 金鑰。沒有的話整個推播功能是關的。 */
  configured: boolean
  /** 目前有幾台裝置會收到推播。 */
  subscriberCount: number
}

/** 【宣告式】後台的推播狀態（需登入）。 */
export function usePushStatus() {
  return useApiFetch<PushStatus>(ENDPOINTS.status)
}

/** 【命令式】訂閱相關操作。給前台的訂閱按鈕用。 */
export function usePushSubscriptionActions() {
  const { post, loading, error, attempt } = useApi()

  return {
    loading,
    error,
    attempt,
    subscribe: (subscription: PushSubscriptionJSON, userAgent: string) =>
      post<{ subscribed: boolean }>(ENDPOINTS.subscribe, { subscription, userAgent }),
    unsubscribe: (endpoint: string) =>
      post<{ subscribed: boolean }>(ENDPOINTS.unsubscribe, { endpoint }),
  }
}

/** 【命令式】後台發送推播。 */
export function usePushActions() {
  const { post, loading, error, attempt } = useApi()

  return {
    loading,
    error,
    attempt,
    sendPush: (payload: PushPayload) => post<PushSendResult>(ENDPOINTS.send, payload),
  }
}

/** 瀏覽器 `PushSubscription.toJSON()` 的形狀（`lib.dom` 的版本欄位是選填的，用不了）。 */
export interface PushSubscriptionJSON {
  endpoint: string
  keys: { p256dh: string; auth: string }
}
