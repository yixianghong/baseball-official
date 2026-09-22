import { defineApiHandler } from '../../../utils/handler'
import { requireUser } from '../../../utils/session'
import { validateParams } from '../../../utils/validate'
import { idParamSchema } from '../../../../shared/schemas/common'
import { deletePlayer } from '../../../repositories/players'

/**
 * 刪除球員（需登入）。
 *
 * 退隊的球員建議改成 `status: inactive` 而不是刪除 —— 歷史比賽的打線裡
 * 還留著他的 `playerId`，刪掉之後那些連結會失效（姓名仍看得到，但點不進個人頁）。
 */
export default defineApiHandler(async (event) => {
  await requireUser(event)
  const { id } = await validateParams(event, idParamSchema)
  await deletePlayer(id)

  event.context.logger.info({ playerId: id }, 'player deleted')
  return { deleted: true }
})
