import { defineApiHandler } from '../../utils/handler'
import { validateParams } from '../../utils/validate'
import { AppError, ERROR_CODE } from '../../utils/errors'
import { idParamSchema } from '../../../shared/schemas/common'
import { getGame } from '../../repositories/games'

/**
 * 單場比賽（公開）。
 *
 * 一次回傳整份文件 —— 打線、出席、計分板都內嵌在裡面，所以比賽詳情頁
 * 只需要這一次請求。要顯示出席還是打線，由前端依 `status` 決定
 * （見 `app/pages/games/[id].vue`）。
 */
export default defineApiHandler(async (event) => {
  const { id } = await validateParams(event, idParamSchema)
  const game = await getGame(id)
  if (!game) throw new AppError(ERROR_CODE.NOT_FOUND, '找不到這場比賽')
  return game
})
