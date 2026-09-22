import { z } from 'zod'
import { defineApiHandler } from '../../../utils/handler'
import { requireUser } from '../../../utils/session'
import { validateBody } from '../../../utils/validate'
import { playerInputSchema } from '../../../../shared/schemas/player'
import { createPlayers } from '../../../repositories/players'

/**
 * 批次新增球員（需登入）。
 *
 * 名冊截圖辨識後勾選要匯入的幾位，一次送過來建立，不必逐筆按儲存。
 */
const batchSchema = z.object({
  players: z.array(playerInputSchema).min(1, '至少要有一位球員').max(60, '一次最多匯入 60 位'),
})

export default defineApiHandler(async (event) => {
  await requireUser(event)
  const { players } = await validateBody(event, batchSchema)
  const created = await createPlayers(players)

  event.context.logger.info({ count: created.length }, 'players created in batch')
  return created
})
