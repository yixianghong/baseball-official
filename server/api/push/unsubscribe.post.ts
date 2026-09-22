import { defineApiHandler } from '../../utils/handler'
import { validateBody } from '../../utils/validate'
import { pushUnsubscribeInputSchema } from '../../../shared/schemas/push'
import { removeSubscription, subscriptionId } from '../../repositories/push-subscriptions'

/**
 * 退訂推播。
 *
 * 刻意是冪等的：找不到那筆訂閱也回成功。使用者按了「關閉通知」，
 * 結果因為伺服器上本來就沒有紀錄而看到錯誤訊息，是最沒有意義的失敗。
 */
export default defineApiHandler(async (event) => {
  const { endpoint } = await validateBody(event, pushUnsubscribeInputSchema)
  await removeSubscription(endpoint)

  event.context.logger.info(
    { subscriptionId: subscriptionId(endpoint) },
    'push subscription removed',
  )
  return { subscribed: false }
})
