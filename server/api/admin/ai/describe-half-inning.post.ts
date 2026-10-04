import { defineApiHandler } from '../../../utils/handler'
import { requireUser } from '../../../utils/session'
import { validateBody } from '../../../utils/validate'
import { describeHalfInningRequestSchema } from '../../../../shared/schemas/ai'
import { describeHalfInning } from '../../../utils/gemini'

/**
 * 把一個半局的逐打席寫成一段話。
 *
 * ⚠️ **和另外五支 AI 端點方向相反**：那幾支是「圖片／音訊 → 結構化資料」，
 * 這一支是「結構化資料 → 散文」。共同的紀律一樣適用 ——
 * **這裡不寫入任何資料**，回傳的是一段草稿，要不要用、用在哪裡是人決定的。
 *
 * 所以也刻意**不把結果存回比賽文件**：敘述是從打席生出來的，打席一改它就過時，
 * 存起來就等於多一份會和真相對不上的資料（和「勝敗不存欄位」同一條原則）。
 * 要貼到 LINE 群組或公告的人自己複製。
 */
export default defineApiHandler(async (event) => {
  await requireUser(event)

  const request = await validateBody(event, describeHalfInningRequestSchema)
  const result = await describeHalfInning(event, request)

  event.context.logger.info(
    { inning: request.inning, half: request.half, plays: request.plays.length },
    'half inning described',
  )

  return result
})
