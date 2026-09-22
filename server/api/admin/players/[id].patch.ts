import { defineApiHandler } from '../../../utils/handler'
import { requireUser } from '../../../utils/session'
import { validateBody, validateParams } from '../../../utils/validate'
import { playerPatchSchema } from '../../../../shared/schemas/player'
import { idParamSchema } from '../../../../shared/schemas/common'
import { updatePlayer } from '../../../repositories/players'

/**
 * 更新球員（需登入）。
 *
 * 注意：這裡**不會**回頭改寫歷史比賽中的姓名。打線與出席存的是當下的
 * 姓名快照，球員改名或退隊之後，兩年前那場比賽的紀錄仍應該顯示當時的名字。
 */
export default defineApiHandler(async (event) => {
  await requireUser(event)
  const { id } = await validateParams(event, idParamSchema)
  const patch = await validateBody(event, playerPatchSchema)
  const player = await updatePlayer(id, patch)

  event.context.logger.info({ playerId: id }, 'player updated')
  return player
})
