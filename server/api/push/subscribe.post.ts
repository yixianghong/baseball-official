import { getRequestHeader } from 'h3'
import { defineApiHandler } from '../../utils/handler'
import { validateBody } from '../../utils/validate'
import { pushSubscribeInputSchema } from '../../../shared/schemas/push'
import { removeSubscription, saveSubscription } from '../../repositories/push-subscriptions'
import { isPushConfigured } from '../../utils/push'
import { AppError, ERROR_CODE } from '../../utils/errors'

/**
 * 訂閱推播。
 *
 * ## 這支端點**沒有** `requireUser()`，是刻意的
 * 架構紀律是「寫入端點先驗身分」，但推播訂閱的對象是一般訪客 ——
 * 這個網站除了後台之外沒有使用者系統，要求登入才能訂閱球隊公告說不通。
 *
 * 少了身分驗證，防線由三層補上：
 * 1. `pushSubscriptionSchema` 檢查格式，每個欄位都有長度上限
 * 2. **endpoint 必須是已知推送服務的網域** —— 沒有這條，這支端點就變成
 *    「任何人都能叫我們的伺服器去打任意網址」，也就是 SSRF
 * 3. `server/middleware/30.rate-limit.ts` 擋同一個 IP 灌爆
 *
 * 訂閱本身不是機密：endpoint 是「能對這台裝置發推播」的能力憑證，
 * 但它由瀏覽器產生，攻擊者無法偽造出別人的。
 */
export default defineApiHandler(async (event) => {
  if (!isPushConfigured()) {
    throw new AppError(ERROR_CODE.SERVICE_UNAVAILABLE, '這個站台尚未開啟推播功能')
  }

  const input = await validateBody(event, pushSubscribeInputSchema)

  // 瀏覽器輪替 endpoint 時會帶上舊的，順手清掉才不會留下殭屍訂閱
  if (input.replaces && input.replaces !== input.subscription.endpoint) {
    await removeSubscription(input.replaces)
  }

  const userAgent = input.userAgent || getRequestHeader(event, 'user-agent')?.slice(0, 300) || ''
  const record = await saveSubscription(input.subscription, userAgent)

  event.context.logger.info({ subscriptionId: record.id }, 'push subscription saved')

  // 不要把 endpoint 或金鑰回傳出去，前端不需要，回了只是多一個外洩面
  return { subscribed: true }
})
