import type { H3Event } from 'h3'
import { createExternalClient } from './external'
import {
  buildBracket,
  type Bracket,
  type MlbPostseasonResponse,
} from '../../shared/schemas/ws-bracket'
import { logger } from './logger'

/**
 * MLB 季後賽樹狀圖（限期活動「預測世界大賽冠軍」用，見 `docs/ws-bracket.md`）。
 *
 * 資料來自 statsapi.mlb.com 的公開端點，**不需要金鑰**：
 * `/api/v1/schedule/postseason/series?season=YYYY&sportId=1`
 *
 * 一次回傳十一支系列賽（4 外卡 + 4 分區 + 2 聯盟冠軍 + 世界大賽），
 * 對戰組合還沒產生的格子會塞佔位隊伍（`HOU/CWS`、`AL Higher Seed`）。
 * 結構是打過真 API 確認的（2025 完賽資料 + 2026 賽前資料都驗過）。
 *
 * ## 為什麼要經過 BFF 而不是讓瀏覽器直接打
 * 1. statsapi 沒有 CORS 標頭，瀏覽器根本拿不到回應。
 * 2. 快取只有放在伺服器端才是全站共用的 —— 一場比賽進行中會有好幾個人
 *    同時開著這一頁，各自輪詢的話等於拿球隊的人去壓別人的免費服務。
 *
 * ⚠️ 這是一支**沒有服務保證**的端點。掛掉時不要讓整個頁面跟著壞：
 * `getBracket()` 一定回傳一個 `Bracket`，抓不到就回上一次成功的結果，
 * 連上一次都沒有才回一張全空的樹（畫面照樣畫得出來，只是每一格都是待定）。
 */

const mlbClient = createExternalClient({
  name: 'mlb',
  baseUrl: () => useRuntimeConfig().mlb.baseUrl,
})

/**
 * 快取存活時間。
 *
 * 季後賽一天最多兩三場，五分鐘的延遲對「誰晉級了」這種資訊完全可以接受，
 * 而它讓原站每小時只打 12 次 —— 前台想輪詢多快都不會傳導到 MLB 身上。
 */
const CACHE_TTL_MS = 5 * 60 * 1000

/**
 * 上一次成功的結果留多久還能當備援用。
 *
 * 比 TTL 長得多是刻意的：MLB 掛掉兩小時的話，「顯示兩小時前的樹狀圖」
 * 遠好過「整張圖變成空白」—— 季後賽的樹狀圖本來就是幾小時才動一次的東西。
 * 畫面上會寫出 `fetchedAt`，所以舊資料不會被誤認成即時的。
 */
const STALE_TTL_MS = 24 * 60 * 60 * 1000

interface CacheEntry {
  at: number
  bracket: Bracket
}

function cacheKey(season: number): string {
  return `mlb:postseason:${season}`
}

/**
 * 取得某一季的季後賽樹狀圖。
 *
 * @param season 年份。預設是「今年」，但季後賽會跨到十一月，所以呼叫端
 *               自己決定 —— 這裡不猜。
 */
export async function getBracket(event: H3Event, season: number): Promise<Bracket> {
  /*
   * 基底網址留空 = 整個外部呼叫關閉（e2e 就是這樣隔離的）。
   *
   * 回一張全空的樹而不是拋錯：畫面照樣畫得出來，每一格都是待定 ——
   * 和「MLB 掛掉」走的是同一條路，所以那條路也被 e2e 一起驗到了。
   */
  if (!useRuntimeConfig(event).mlb.baseUrl) return buildBracket(null, new Date().toISOString())

  const storage = useStorage('cache')
  const key = cacheKey(season)
  const cached = await storage.getItem<CacheEntry>(key)

  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.bracket

  try {
    const response = await mlbClient<MlbPostseasonResponse>(event, '/schedule/postseason/series', {
      query: { season: String(season), sportId: 1 },
    })

    const bracket = buildBracket(response, new Date().toISOString())
    await storage.setItem(key, { at: Date.now(), bracket } satisfies CacheEntry)
    return bracket
  } catch (err) {
    /*
     * 自己接住錯誤，不讓它往上冒（全站紀律）。
     *
     * `createExternalClient` 依上游的 HTTP 狀態丟出我們自己的錯誤碼，
     * 所以 MLB 回 400 會變成前台的「請求格式不正確」、回 401 會變成
     * 「請先登入」—— 兩個都把人指向完全錯誤的方向。
     */
    const log = event.context.logger ?? logger
    log.warn({ err, season }, 'mlb postseason fetch failed, falling back to cache')

    if (cached && Date.now() - cached.at < STALE_TTL_MS) return cached.bracket
    return buildBracket(null, new Date().toISOString())
  }
}
