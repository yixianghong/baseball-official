import { defineApiHandler } from '../../../utils/handler'
import { requireUser } from '../../../utils/session'
import { validateBody } from '../../../utils/validate'
import { parseScheduleRequestSchema } from '../../../../shared/schemas/ai'
import { parseScheduleImage } from '../../../utils/gemini'

/**
 * 辨識賽程公告圖（需登入）。
 *
 * 官方公告的賽程幾乎都是圖片，逐格手敲既慢又容易看錯行。這支端點接收
 * 一張圖與我方隊名，回傳圖中**屬於我隊**的所有場次。
 *
 * ## 它不會寫入任何資料
 * 回傳的是建議，後台會把它帶進表單讓人確認、修改，再送去
 * `/api/admin/games` 或 `/api/admin/games/batch` 建立。
 * 「AI 猜的」與「人確認的」因此永遠分得清楚。
 */
export default defineApiHandler(async (event) => {
  const user = await requireUser(event)
  const request = await validateBody(event, parseScheduleRequestSchema)

  const result = await parseScheduleImage(event, request)

  event.context.logger.info(
    { userId: user.id, matches: result.matches.length, warnings: result.warnings.length },
    'schedule image parsed',
  )
  return result
})
