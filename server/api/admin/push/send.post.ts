import { defineApiHandler } from '../../../utils/handler'
import { requireUser } from '../../../utils/session'
import { validateBody } from '../../../utils/validate'
import { pushPayloadSchema } from '../../../../shared/schemas/push'
import { sendPushToAll } from '../../../utils/push'

/**
 * 發送推播給所有訂閱者（需登入）。
 *
 * ## 為什麼是「按一下才發」，不是發布公告自動發
 * 後台存檔的次數遠多於「真的要通知大家」的次數 —— 改錯字、調整排序、
 * 補上封面圖都會觸發存檔。自動發送的結果就是大家被洗版，然後把通知關掉，
 * 之後真正重要的事情也收不到了。
 *
 * 推播是「送出去就收不回來」的動作，決定權留給人。
 */
export default defineApiHandler(async (event) => {
  await requireUser(event)
  const payload = await validateBody(event, pushPayloadSchema)

  const result = await sendPushToAll(payload)

  event.context.logger.info({ ...result, title: payload.title }, 'push broadcast sent')
  return result
})
