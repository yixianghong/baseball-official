import { defineApiHandler } from '../../../utils/handler'
import { requireUser } from '../../../utils/session'
import { validateParams } from '../../../utils/validate'
import { idParamSchema } from '../../../../shared/schemas/common'
import { deleteGame } from '../../../repositories/games'

/** 刪除比賽（需登入）。 */
export default defineApiHandler(async (event) => {
  await requireUser(event)
  const { id } = await validateParams(event, idParamSchema)
  await deleteGame(id)

  event.context.logger.info({ gameId: id }, 'game deleted')
  return { deleted: true }
})
