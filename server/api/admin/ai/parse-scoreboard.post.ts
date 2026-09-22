import { defineApiHandler } from '../../../utils/handler'
import { requireUser } from '../../../utils/session'
import { validateBody } from '../../../utils/validate'
import { parseScoreboardRequestSchema } from '../../../../shared/schemas/ai'
import { parseScoreboardImage } from '../../../utils/gemini'

/**
 * 辨識計分板照片（需登入）。
 *
 * 回傳逐局得分與 R／H／E。後端會驗算「逐局加總 = 總分」，
 * 對不起來時把 `confidence` 降級並在 `warnings` 指出來 ——
 * 這是計分板辨識最常出錯的地方（某一格的數字看錯）。
 *
 * 同樣不寫入資料，結果一律回到後台的計分板表單讓人確認。
 */
export default defineApiHandler(async (event) => {
  const user = await requireUser(event)
  const request = await validateBody(event, parseScoreboardRequestSchema)

  const result = await parseScoreboardImage(event, request)

  event.context.logger.info(
    { userId: user.id, innings: result.innings.length, confidence: result.confidence },
    'scoreboard image parsed',
  )
  return result
})
