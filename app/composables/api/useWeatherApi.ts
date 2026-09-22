import type { MaybeRefOrGetter } from 'vue'
import type { WeatherMap, WeatherResult } from '#shared/schemas/weather'

/**
 * 比賽當天的天氣預報。
 *
 * 與比賽本身分開查：氣象署慢或掛掉時，不該讓整個賽程頁跟著等。
 * 一次查多場也只發一個請求（見 `server/api/weather.get.ts`）。
 */

const ENDPOINTS = {
  weather: '/weather',
} as const

/**
 * 【宣告式】多場比賽的天氣，回傳 `比賽 id → 結果` 的對照。
 *
 * `server: false`：天氣不是首屏的必要資訊，讓它在瀏覽器端載就好 ——
 * SSR 也等氣象署的話，整頁的回應時間就綁在外部服務上了。
 */
export function useGamesWeather(ids: MaybeRefOrGetter<string[]>) {
  const query = computed(() => ({ ids: toValue(ids).join(',') }))
  const enabled = computed(() => toValue(ids).length > 0)

  return useApiFetch<WeatherMap>(ENDPOINTS.weather, {
    query,
    server: false,
    // 沒有比賽就不要送一個必然被驗證擋下的請求
    immediate: enabled.value,
  })
}

/** 【宣告式】單場比賽的天氣。內部走同一支批次端點。 */
export function useGameWeather(id: MaybeRefOrGetter<string>) {
  const ids = computed(() => [String(toValue(id))].filter(Boolean))
  const { data, pending, error, refresh } = useGamesWeather(ids)

  const weather = computed<WeatherResult | null>(() => data.value?.[toValue(ids)[0] ?? ''] ?? null)
  return { data: weather, pending, error, refresh }
}
