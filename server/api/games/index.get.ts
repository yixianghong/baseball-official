import { defineApiHandler } from '../../utils/handler'
import { validateQuery } from '../../utils/validate'
import { gameQuerySchema } from '../../../shared/schemas/game'
import { listGames } from '../../repositories/games'

/**
 * 賽程列表（公開）。
 *
 * 前台的「近期賽程」與「比賽結果」是同一支端點的兩種 scope：
 * - `?scope=upcoming` 未開打且日期未過，由近到遠
 * - `?scope=past` 已結束，由新到舊
 *
 * 後台列表直接用 `?scope=all`，不需要另一支端點 —— 比賽資料本來就是公開的，
 * 沒有「草稿」這種只有管理員看得到的狀態。
 */
export default defineApiHandler(async (event) => {
  const query = await validateQuery(event, gameQuerySchema)
  return await listGames(query)
})
