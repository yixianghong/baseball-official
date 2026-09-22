import { defineApiHandler } from '../../../utils/handler'
import { requireUser } from '../../../utils/session'
import { countSubscriptions } from '../../../repositories/push-subscriptions'
import { isPushConfigured } from '../../../utils/push'

/**
 * 推播的狀態（需登入）。
 *
 * 後台在按下發送之前需要知道兩件事：功能有沒有設定好、現在有幾台裝置會收到。
 * 「送出成功但其實 0 台訂閱」是最容易發生又最難察覺的狀況。
 */
export default defineApiHandler(async (event) => {
  await requireUser(event)

  const configured = isPushConfigured()
  return {
    configured,
    subscriberCount: configured ? await countSubscriptions() : 0,
  }
})
