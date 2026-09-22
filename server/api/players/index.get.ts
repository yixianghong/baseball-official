import { defineApiHandler } from '../../utils/handler'
import { validateQuery } from '../../utils/validate'
import { playerQuerySchema } from '../../../shared/schemas/player'
import { listPlayers } from '../../repositories/players'

/**
 * 球員名單（公開）。
 *
 * 前台傳 `?status=active` 只看現役；後台不帶參數拿全部（含已退隊的）。
 * 排序規則寫在 `shared/schemas/player.ts` 的 `comparePlayers()`，
 * 前台名單、後台列表、打線挑人清單因此永遠是同一個順序。
 */
export default defineApiHandler(async (event) => {
  const query = await validateQuery(event, playerQuerySchema)
  return await listPlayers(query)
})
