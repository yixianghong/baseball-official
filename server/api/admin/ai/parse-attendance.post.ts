import { defineApiHandler } from '../../../utils/handler'
import { requireUser } from '../../../utils/session'
import { validateBody } from '../../../utils/validate'
import { parseAttendanceRequestSchema } from '../../../../shared/schemas/ai'
import { parseAttendanceImage } from '../../../utils/gemini'

/**
 * 辨識出席調查的截圖（需登入）。
 *
 * 球隊的出席調查多半在 LINE 上進行，投票結束後還要把結果一個一個敲進後台。
 * 這支端點接收一張截圖與現有的球員名單，回傳每個人的出席狀態，並盡可能把
 * LINE 上的暱稱對應到名單中的球員。
 *
 * ## 它不會寫入任何資料
 * 與其他辨識端點一樣，回傳的是建議。後台會把結果帶進出席編輯器讓人核對、
 * 調整對應關係，按下儲存才寫入。
 */
export default defineApiHandler(async (event) => {
  const user = await requireUser(event)
  const request = await validateBody(event, parseAttendanceRequestSchema)

  const result = await parseAttendanceImage(event, request)

  event.context.logger.info(
    {
      userId: user.id,
      entries: result.entries.length,
      unmatched: result.entries.filter((entry) => !entry.playerId).length,
    },
    'attendance image parsed',
  )
  return result
})
