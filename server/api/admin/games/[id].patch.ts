import { defineApiHandler } from '../../../utils/handler'
import { requireUser } from '../../../utils/session'
import { validateBody, validateParams } from '../../../utils/validate'
import { gamePatchSchema } from '../../../../shared/schemas/game'
import { idParamSchema } from '../../../../shared/schemas/common'
import { updateGame } from '../../../repositories/games'

/**
 * 更新比賽（需登入）。
 *
 * 後台的四個分頁（基本資料／出席／打線／計分板）都打這一支，各自只送
 * 自己那部分的欄位。用 PATCH 而非 PUT 就是為了這個 —— 編輯打線時
 * 不必連帶把出席名單整份送上來，也就不會發生兩個分頁互相覆蓋的問題。
 */
export default defineApiHandler(async (event) => {
  await requireUser(event)
  const { id } = await validateParams(event, idParamSchema)
  const patch = await validateBody(event, gamePatchSchema)
  const game = await updateGame(id, patch)

  event.context.logger.info({ gameId: id, fields: Object.keys(patch) }, 'game updated')
  return game
})
