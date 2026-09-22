import { defineApiHandler } from '../utils/handler'
import { validateQuery } from '../utils/validate'
import { getGame } from '../repositories/games'
import { getForecast } from '../utils/cwa'
import { toDateKey } from '../../shared/schemas/game'
import { weatherQuerySchema, type WeatherResult } from '../../shared/schemas/weather'

/**
 * 一次查多場比賽的天氣。
 *
 * ## 為什麼是批次而不是一場一支
 * 首頁與賽程頁會同時列出好幾場比賽，一場一個請求就是三、四趟往返。
 * 伺服器端本來就把縣市預報快取起來共用，多打幾次不痛，但瀏覽器那邊
 * 每一趟都是實打實的延遲。
 *
 * ## 為什麼不併進 `/api/games`
 * 比賽資料在 Firestore，天氣在氣象署。併在一起的話，氣象署慢或掛掉時
 * **整個賽程頁跟著慢或壞** —— 為了錦上添花的資訊賠掉主要內容。
 * 分開之後前台先把比賽畫出來，天氣自己慢慢載。
 *
 * 比賽頁也才能繼續走 CDN 快取：天氣是另一個請求，新鮮度各自管。
 */
export default defineApiHandler(async (event) => {
  const { ids } = await validateQuery(event, weatherQuerySchema)

  // 「今天」在伺服器端算一次，前後端才不會因為時區差異得到不同的判斷
  const today = toDateKey(new Date())

  const entries = await Promise.all(
    ids.map(async (id): Promise<[string, WeatherResult]> => {
      const game = await getGame(id)
      // 查不到的比賽不是錯誤 —— 呼叫端可能帶了已經被刪掉的 id
      if (!game) return [id, { status: 'no-city' }]
      return [id, await getForecast(event, game.city, game.date, game.time, today)]
    }),
  )

  return Object.fromEntries(entries)
})
