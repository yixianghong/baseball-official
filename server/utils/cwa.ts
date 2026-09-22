import type { H3Event } from 'h3'
import { z } from 'zod'
import {
  isWithinForecastRange,
  type WeatherForecast,
  type WeatherResult,
} from '../../shared/schemas/weather'
import { createExternalClient } from './external'
import { logger } from './logger'

/**
 * 中央氣象署開放資料 —— 一週天氣預報。
 *
 * ## 資料集與結構都是實際打過 API 確認的，不是照文件猜的
 * 這一段特別容易出錯，而錯的樣子是「沒有錯誤、但永遠查不到資料」：
 *
 * - 資料集是 **`F-D0047-091`**。它掛在「鄉鎮天氣預報」底下，但實際回傳的
 *   是 **22 個縣市**，正好對應後台的縣市選單。（`F-C0032-005` 不存在，會回 404。）
 * - 外層是 `records.Locations[].Location[]`，**大寫開頭**。舊資料集是
 *   小寫的 `records.location[]`，兩種都有人在用。
 * - `ElementName` 是**中文**（`天氣現象`、`最高溫度`…），不是 `Wx`／`MaxT`。
 * - 每個值的鍵名還不一樣：`Weather`、`MaxTemperature`、`MinTemperature`、
 *   `ProbabilityOfPrecipitation`。
 * - 篩選參數是 **`LocationName`（大寫 L）**。小寫會被安靜地無視，
 *   回傳全部 22 縣市（636KB vs 30KB），功能看起來正常，只是每次都多傳 20 倍。
 *
 * ## 時段是 12 小時一段
 * `06:00–18:00`（白天）與 `18:00–06:00`（夜間）。球賽都在白天，所以挑
 * **包含開賽時間的那一段**，而不是把當天所有時段平均 —— 把夜間的低溫混進去，
 * 顯示出來的會是一個當天根本不會出現的溫度區間。
 *
 * ## 一週限制
 * 這是資料來源的限制。超出範圍的日期**根本不發請求**。
 */

const DATASET = 'F-D0047-091'

/** 氣象署一天更新幾次，所有比賽共用同一份縣市預報。 */
const CACHE_TTL_MS = 60 * 60 * 1000

const cwaClient = createExternalClient({
  name: 'cwa',
  baseUrl: () => 'https://opendata.cwa.gov.tw/api/v1/rest/datastore',
})

const timeSlotSchema = z.object({
  StartTime: z.string(),
  EndTime: z.string(),
  ElementValue: z.array(z.record(z.string(), z.string())),
})

const locationSchema = z.object({
  LocationName: z.string(),
  WeatherElement: z.array(z.object({ ElementName: z.string(), Time: z.array(timeSlotSchema) })),
})

const cwaResponseSchema = z.object({
  records: z.object({
    Locations: z.array(z.object({ Location: z.array(locationSchema) })),
  }),
})

type Location = z.infer<typeof locationSchema>
type TimeSlot = z.infer<typeof timeSlotSchema>

export function isCwaConfigured(event: H3Event): boolean {
  return Boolean(useRuntimeConfig(event).cwa.apiKey)
}

/**
 * 查某個縣市在某一天某個時間的預報。
 *
 * 一定回傳一個 `WeatherResult`，不會拋 —— 天氣是錦上添花的資訊，
 * 它壞掉不該讓整個比賽頁跟著壞。原因寫在 `status` 裡讓前台照實說。
 */
export async function getForecast(
  event: H3Event,
  city: string,
  date: string,
  time: string,
  today: string,
): Promise<WeatherResult> {
  if (!city) return { status: 'no-city' }
  if (!isCwaConfigured(event)) return { status: 'not-configured' }
  if (!isWithinForecastRange(date, today)) return { status: 'out-of-range' }

  try {
    const location = await loadCityForecast(event, city)
    if (!location) return { status: 'unavailable' }

    const forecast = pickSlot(location, city, date, time)
    return forecast ? { status: 'ok', forecast } : { status: 'out-of-range' }
  } catch (error) {
    logger.warn({ city, date, error: String(error) }, '氣象署預報查詢失敗')
    return { status: 'unavailable' }
  }
}

async function loadCityForecast(event: H3Event, city: string): Promise<Location | null> {
  const storage = useStorage('cache')
  const key = `cwa:${city}`

  const cached = await storage.getItem<{ at: number; data: unknown }>(key)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return locationSchema.safeParse(cached.data).data ?? null
  }

  const raw = await cwaClient(event, `/${DATASET}`, {
    query: {
      Authorization: useRuntimeConfig(event).cwa.apiKey,
      format: 'JSON',
      // 大寫 L。小寫會被無視並回傳全部 22 縣市 —— 功能照常，只是白傳 20 倍的資料
      LocationName: city,
    },
  })

  const parsed = cwaResponseSchema.safeParse(raw)
  if (!parsed.success) {
    // 把實際拿到的頂層結構記下來，格式改了才查得出是哪裡對不上
    logger.error(
      {
        city,
        topLevelKeys: Object.keys((raw ?? {}) as Record<string, unknown>),
        issues: parsed.error.issues.slice(0, 3),
      },
      '氣象署回應格式與預期不符',
    )
    return null
  }

  const list = parsed.data.records.Locations.flatMap((group) => group.Location)
  const found = list.find((item) => item.LocationName === city) ?? null
  if (!found) {
    logger.warn({ city, got: list.map((item) => item.LocationName) }, '氣象署回應裡找不到這個縣市')
    return null
  }

  await storage.setItem(key, { at: Date.now(), data: found })
  return found
}

/**
 * 挑出包含開賽時間的那個 12 小時時段。
 *
 * 找不到（例如開賽時間剛好在資料的邊界）就退回當天的第一個時段，
 * 總比完全不顯示好。
 */
function pickSlot(
  location: Location,
  city: string,
  date: string,
  time: string,
): WeatherForecast | null {
  const element = (name: string) =>
    location.WeatherElement.find((item) => item.ElementName === name)?.Time ?? []

  const kickoff = Date.parse(`${date}T${time}:00+08:00`)
  const sameDay = (slot: TimeSlot) => slot.StartTime.startsWith(date)
  const covers = (slot: TimeSlot) => {
    const start = Date.parse(slot.StartTime)
    const end = Date.parse(slot.EndTime)
    return Number.isFinite(kickoff) && kickoff >= start && kickoff < end
  }

  const choose = (slots: TimeSlot[]) => slots.find(covers) ?? slots.find(sameDay) ?? null

  const weather = choose(element('天氣現象'))
  const maxT = choose(element('最高溫度'))
  const minT = choose(element('最低溫度'))
  const pop = choose(element('12小時降雨機率'))

  // 當天完全沒有時段 = 超出預報範圍
  if (!weather && !maxT) return null

  const maxTemp = readNumber(maxT, 'MaxTemperature')
  const minTemp = readNumber(minT, 'MinTemperature')
  if (maxTemp === null || minTemp === null) return null

  return {
    city,
    date,
    description: readString(weather, 'Weather') ?? '',
    maxTemp,
    minTemp,
    rainChance: readNumber(pop, 'ProbabilityOfPrecipitation'),
  }
}

function readString(slot: TimeSlot | null, key: string): string | null {
  const value = slot?.ElementValue[0]?.[key]?.trim()
  return value ? value : null
}

/** 降雨機率偶爾是空字串（氣象署對較遠的時段不給值），那時回 null 而不是 0。 */
function readNumber(slot: TimeSlot | null, key: string): number | null {
  const raw = readString(slot, key)
  if (raw === null) return null
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) ? parsed : null
}
