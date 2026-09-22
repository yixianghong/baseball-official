import { defineApiHandler } from '../../utils/handler'
import { validateParams } from '../../utils/validate'
import { AppError, ERROR_CODE } from '../../utils/errors'
import { idParamSchema } from '../../../shared/schemas/common'
import { getPlayer } from '../../repositories/players'

/** 單一球員（公開）。 */
export default defineApiHandler(async (event) => {
  const { id } = await validateParams(event, idParamSchema)
  const player = await getPlayer(id)
  if (!player) throw new AppError(ERROR_CODE.NOT_FOUND, '找不到這位球員')
  return player
})
