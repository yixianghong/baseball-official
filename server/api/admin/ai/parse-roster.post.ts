import { defineApiHandler } from '../../../utils/handler'
import { requireUser } from '../../../utils/session'
import { validateBody } from '../../../utils/validate'
import { parseRosterRequestSchema } from '../../../../shared/schemas/ai'
import { parseRosterImage } from '../../../utils/gemini'

/**
 * 辨識球員名冊截圖（需登入）。
 *
 * 球隊的名冊多半是 Excel 或 Google 試算表，逐列手敲進後台既慢又容易看錯行。
 * 上傳一張截圖，這支端點回傳每一列的球員資料，守備位置與慣用手都已正規化
 * 成系統的列舉值。
 *
 * ## 它不會寫入任何資料
 * 與另外兩支辨識端點一樣，回傳的是建議。後台會把它帶進一個可勾選、可編輯的
 * 列表，人確認之後才送去 `/api/admin/players/batch` 建立。
 */
export default defineApiHandler(async (event) => {
  const user = await requireUser(event)
  const request = await validateBody(event, parseRosterRequestSchema)

  const result = await parseRosterImage(event, request)

  event.context.logger.info(
    { userId: user.id, players: result.players.length, warnings: result.warnings.length },
    'roster image parsed',
  )
  return result
})
