import { z } from 'zod'
import { defineApiHandler } from '../../../utils/handler'
import { requireUser } from '../../../utils/session'
import { validateBody } from '../../../utils/validate'
import { gameInputSchema } from '../../../../shared/schemas/game'
import { createGames } from '../../../repositories/games'

/**
 * 批次新增比賽（需登入）。
 *
 * 一張賽程公告圖通常包含我隊整季的場次，辨識後勾選要匯入的幾場，
 * 一次送過來建立，不必逐場按儲存。
 */
const batchSchema = z.object({
  games: z.array(gameInputSchema).min(1, '至少要有一場比賽').max(50, '一次最多匯入 50 場'),
})

export default defineApiHandler(async (event) => {
  await requireUser(event)
  const { games } = await validateBody(event, batchSchema)
  const created = await createGames(games)

  event.context.logger.info({ count: created.length }, 'games created in batch')
  return created
})
