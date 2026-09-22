import webpush, { type PushSubscription, type WebPushError } from 'web-push'
import {
  classifyPushFailure,
  pushPayloadSchema,
  type PushPayload,
  type PushSendResult,
} from '../../shared/schemas/push'
import {
  listSubscriptions,
  recordFailure,
  removeSubscriptionById,
} from '../repositories/push-subscriptions'
import { logger } from './logger'
import { AppError, ERROR_CODE } from './errors'

/**
 * Web Push 發送。
 *
 * ## 為什麼是標準 Web Push 而不是 FCM
 * FCM 需要在**瀏覽器**載入 Firebase SDK 才拿得到 token，那會直接推翻這個
 * 專案最核心的一條設計：「前端完全不載入 Firebase SDK，也拿不到任何 token」。
 * 標準的 Web Push 用瀏覽器原生的 `PushManager`，前端一行 SDK 都不需要，
 * 金鑰只存在這一層。CSP 也完全不用放寬（`PushManager` 走瀏覽器內部，
 * 不是 `fetch`，`connect-src` 管不到它）。
 *
 * 代價是伺服器端要自己簽 VAPID、自己加密酬載 —— 這兩件事交給 `web-push`
 * 套件處理。這是少數不該自己實作的東西（ECDH + HKDF + AES-GCM）。
 *
 * ## 失效訂閱的清理
 * 訂閱會過期：使用者清掉網站資料、換手機、瀏覽器輪替 endpoint。推送服務
 * 回 404 或 410 就代表這筆已經沒有意義，**當場刪掉**。其他錯誤（逾時、5xx）
 * 可能只是暫時的，累積到上限才淘汰。判斷邏輯在 `classifyPushFailure()`。
 *
 * 不清理的話，訂閱清單會隨時間累積越來越多殭屍資料，每次發送都在對它們
 * 做無意義的網路請求。
 */

/** 推送服務願意保留訊息的秒數。比賽提醒放一天，過期就沒有意義了。 */
const TTL_SECONDS = 60 * 60 * 24

let configured = false

/** VAPID 金鑰是否齊全。缺任何一把就整個功能關閉，不會半殘。 */
export function isPushConfigured(): boolean {
  const { vapid, public: publicConfig } = useRuntimeConfig()
  return Boolean(publicConfig.vapidPublicKey && vapid.privateKey && vapid.subject)
}

/**
 * 設定 VAPID 金鑰。
 *
 * `web-push` 的設定是模組層級的全域狀態，所以只做一次。放在 lazy 初始化
 * 而不是模組載入時執行 —— 沒設定推播的部署（例如本機開發）不該因此啟動失敗。
 */
function ensureConfigured(): void {
  if (configured) return
  if (!isPushConfigured()) {
    throw new AppError(ERROR_CODE.SERVICE_UNAVAILABLE, '尚未設定推播金鑰（VAPID）')
  }

  const { vapid, public: publicConfig } = useRuntimeConfig()
  webpush.setVapidDetails(vapid.subject, publicConfig.vapidPublicKey, vapid.privateKey)
  configured = true
}

/**
 * 把通知送給所有訂閱者。
 *
 * 回傳送出／失敗／清掉的數量，後台直接顯示給人看 —— 推播是「送出去就看不到」
 * 的操作，沒有這個回饋，管理者永遠不知道到底有沒有成功。
 */
export async function sendPushToAll(input: PushPayload): Promise<PushSendResult> {
  ensureConfigured()

  const payload = pushPayloadSchema.parse(input)
  const subscriptions = await listSubscriptions()
  if (subscriptions.length === 0) return { sent: 0, failed: 0, pruned: 0 }

  const body = JSON.stringify(payload)
  let sent = 0
  let failed = 0
  let pruned = 0

  // 訂閱數是「一個球隊的裝置數」，幾十筆的量級，一次全部送出即可
  const results = await Promise.allSettled(
    subscriptions.map(async (record) => {
      const subscription: PushSubscription = {
        endpoint: record.endpoint,
        keys: { p256dh: record.keys.p256dh, auth: record.keys.auth },
      }

      try {
        await webpush.sendNotification(subscription, body, { TTL: TTL_SECONDS })
        return { id: record.id, ok: true as const }
      } catch (error) {
        const status = (error as WebPushError).statusCode

        // 明確失效的不必先記次數，直接刪；其餘先累加再判斷
        const failures =
          status === 404 || status === 410 ? record.failureCount : await recordFailure(record.id)

        if (classifyPushFailure(status, failures) === 'remove') {
          await removeSubscriptionById(record.id)
          return { id: record.id, ok: false as const, removed: true }
        }

        logger.warn(
          { subscriptionId: record.id, status, failures },
          '推播發送失敗（暫時性，保留訂閱）',
        )
        return { id: record.id, ok: false as const, removed: false }
      }
    }),
  )

  for (const result of results) {
    if (result.status === 'rejected') {
      // 上面已經把所有預期中的錯誤處理掉了，走到這裡代表清理本身出錯
      failed += 1
      logger.error({ reason: result.reason }, '推播處理時發生未預期的錯誤')
      continue
    }
    if (result.value.ok) sent += 1
    else {
      failed += 1
      if (result.value.removed) pruned += 1
    }
  }

  logger.info({ sent, failed, pruned, total: subscriptions.length }, '推播發送完成')
  return { sent, failed, pruned }
}
