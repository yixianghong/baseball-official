import { toDateKey } from '#shared/schemas/game'

/**
 * 今天的日期（`YYYY-MM-DD`），SSR 與瀏覽器保證一致。
 *
 * ## 為什麼不直接 `new Date()`
 * 倒數天數、「今天開打」這類判斷若在 SSR 與 hydration 時各自取當下時間，
 * 兩邊的時區（伺服器多半是 UTC）會算出不同的日期，畫面就會閃動一下，
 * Vue 也會噴 hydration mismatch 警告。
 *
 * `useState` 會把伺服器算好的值序列化進 payload，瀏覽器直接沿用。
 */
export function useToday() {
  return useState<string>('today', () => toDateKey(new Date()))
}
