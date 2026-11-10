import type { GameStatus } from '#shared/schemas/game'

/**
 * 比賽狀態對應的標籤色（`UiBaseBadge` 的 `tone`）。
 *
 * 延賽要看得出是「出事了」，取消則是中性的結束。賽事列表與單場比賽的
 * 標題列共用這一支 —— 同一個狀態在兩個畫面上是兩種顏色的話，看起來像
 * 兩種不同的狀態。（進行中不走這裡：那兩處都改用和前台一樣的 LIVE。）
 */
export function gameStatusTone(status: GameStatus) {
  if (status === 'finished') return 'success' as const
  if (status === 'postponed') return 'warning' as const
  if (status === 'canceled') return 'neutral' as const
  return 'brand' as const
}
