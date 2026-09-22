import { defineApiHandler } from '../../../utils/handler'
import { requireUser } from '../../../utils/session'
import { validateBody } from '../../../utils/validate'
import { playerInputSchema } from '../../../../shared/schemas/player'
import { createPlayer } from '../../../repositories/players'

/** 新增球員（需登入）。 */
export default defineApiHandler(async (event) => {
  await requireUser(event)
  const input = await validateBody(event, playerInputSchema)
  const player = await createPlayer(input)

  event.context.logger.info({ playerId: player.id, name: player.name }, 'player created')
  return player
})
