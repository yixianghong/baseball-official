import type { PushPayload, PushSendResult } from '#shared/schemas/push'
import type { ReminderKind, ReminderRunResult } from '#shared/schemas/reminder'

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
  reminders: '/admin/push/reminders',
  runReminders: '/cron/game-reminders',
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

/** 今天會自動送出的比賽提醒。 */
export interface PendingReminder {
  gameId: string
  kind: ReminderKind
  date: string
  days: number
  title: string
  body: string
}

/** 【宣告式】今天待送的比賽提醒（需登入）。 */
export function useGameReminders() {
  return useApiFetch<{ today: string; pending: PendingReminder[] }>(ENDPOINTS.reminders)
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

    /**
     * 立刻執行一次比賽提醒。
     *
     * 和 Cloud Scheduler 每天呼叫的是**同一支端點** —— 後台按下去驗證的
     * 就是排程器實際會做的事，不是一個「長得很像」的替身。
     */
    runGameReminders: () => post<ReminderRunResult>(ENDPOINTS.runReminders, {}),
  }
}

/** 瀏覽器 `PushSubscription.toJSON()` 的形狀（`lib.dom` 的版本欄位是選填的，用不了）。 */
export interface PushSubscriptionJSON {
  endpoint: string
  keys: { p256dh: string; auth: string }
}
