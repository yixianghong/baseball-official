import { z } from 'zod'

/**
 * 比賽當天的天氣預報。
 *
 * 資料來源是中央氣象署開放資料平臺的「一般天氣預報-一週縣市天氣預報」
 * （資料集 `F-C0032-005`）。
 *
 * ## 為什麼是縣市而不是自動判斷
 * 氣象署的預報要指定縣市或鄉鎮，而比賽的場地欄位是自由輸入的文字
 * （「新莊新月橋」「大漢 A 球場」），沒辦法可靠地對應。硬猜的下場是
 * 「顯示了一個看起來很正常、但其實是別的縣市」的天氣 —— 比不顯示更糟。
 * 所以縣市是後台明確選的，預設帶入網站設定的主場縣市。
 *
 * ## 預報只有一週
 * 這是資料來源的限制，不是實作的。賽程常常是幾週甚至幾個月前就排定的，
 * 那些場次查不到預報 —— 這種情況要明確講「還沒有預報」，
 * 而不是顯示一片空白讓人以為壞掉了。
 */

/** 氣象署使用的縣市名稱。用字要與 API 完全一致（「臺」不是「台」）。 */
export const TAIWAN_CITIES = [
  '基隆市',
  '臺北市',
  '新北市',
  '桃園市',
  '新竹市',
  '新竹縣',
  '苗栗縣',
  '臺中市',
  '彰化縣',
  '南投縣',
  '雲林縣',
  '嘉義市',
  '嘉義縣',
  '臺南市',
  '高雄市',
  '屏東縣',
  '宜蘭縣',
  '花蓮縣',
  '臺東縣',
  '澎湖縣',
  '金門縣',
  '連江縣',
] as const

export type TaiwanCity = (typeof TAIWAN_CITIES)[number]

/** 空字串代表「沒有指定」，前台就不顯示天氣。 */
export const citySchema = z.union([z.enum(TAIWAN_CITIES), z.literal('')])

/** 預報查得到時的內容。 */
export const weatherForecastSchema = z.object({
  city: z.string(),
  /** `YYYY-MM-DD`，對應比賽日期。 */
  date: z.string(),
  /** 天氣現象描述，例如「多雲時陰短暫陣雨」。 */
  description: z.string(),
  minTemp: z.number().int(),
  maxTemp: z.number().int(),
  /** 降雨機率（%）。氣象署偶爾會給空值，那時是 null。 */
  rainChance: z.number().int().min(0).max(100).nullable(),
})

export type WeatherForecast = z.infer<typeof weatherForecastSchema>

/**
 * 查詢結果。
 *
 * 用 `status` 而不是「有資料／null」兩種狀態：查不到的原因不只一種，
 * 而每一種要對使用者講的話都不一樣。全部塌成 null，前台就只能寫
 * 「查無資料」這種等於沒說的句子。
 */
export const weatherResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), forecast: weatherForecastSchema }),
  /** 比賽日期超出一週預報範圍 —— 最常見的情況，不是錯誤。 */
  z.object({ status: z.literal('out-of-range') }),
  /** 這場比賽沒有指定縣市。 */
  z.object({ status: z.literal('no-city') }),
  /** 站台沒有設定氣象署授權碼，整個功能是關的。 */
  z.object({ status: z.literal('not-configured') }),
  /** 氣象署那邊出問題（逾時、格式改了、服務中斷）。 */
  z.object({ status: z.literal('unavailable') }),
])

export type WeatherResult = z.infer<typeof weatherResultSchema>

/** 一週預報的天數上限。超過就不必打 API 了。 */
export const FORECAST_HORIZON_DAYS = 7

/**
 * 這個日期還在預報範圍內嗎。
 *
 * `today` 由呼叫端傳入而不在這裡取 `new Date()` —— SSR 與瀏覽器才不會
 * 因為時區差異算出不同結果（與 `needsResultUpdate()` 同一個理由）。
 */
export function isWithinForecastRange(date: string, today: string): boolean {
  if (date < today) return false

  const start = Date.parse(`${today}T00:00:00Z`)
  const target = Date.parse(`${date}T00:00:00Z`)
  if (Number.isNaN(start) || Number.isNaN(target)) return false

  const days = Math.round((target - start) / 86_400_000)
  return days <= FORECAST_HORIZON_DAYS
}

/** 一次最多查幾場。首頁與賽程頁都只列十幾場，20 綽綽有餘。 */
export const MAX_WEATHER_QUERY_IDS = 20

export const weatherQuerySchema = z.object({
  /** 比賽 id，以逗號分隔。 */
  ids: z
    .string()
    .transform((value) =>
      value
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean),
    )
    .refine((ids) => ids.length > 0, '請至少指定一場比賽')
    .refine((ids) => ids.length <= MAX_WEATHER_QUERY_IDS, `一次最多 ${MAX_WEATHER_QUERY_IDS} 場`),
})

/** 批次查詢的回應：比賽 id → 查詢結果。 */
export type WeatherMap = Record<string, WeatherResult>
