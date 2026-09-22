import { defineApiHandler } from '../../../utils/handler'
import { requireUser } from '../../../utils/session'
import { validateBody } from '../../../utils/validate'
import { gameInputSchema } from '../../../../shared/schemas/game'
import { createGame } from '../../../repositories/games'

/**
 * 新增比賽（需登入）。
 *
 * AI 辨識賽程圖之後，後台會把使用者確認過的結果送到這裡 ——
 * 辨識端點本身不寫入任何資料，這條分工讓「AI 猜的」與「人確認的」
 * 永遠分得清楚。
 */
export default defineApiHandler(async (event) => {
  await requireUser(event)
  const input = await validateBody(event, gameInputSchema)
  const game = await createGame(input)

  event.context.logger.info({ gameId: game.id, date: game.date }, 'game created')
  return game
})
