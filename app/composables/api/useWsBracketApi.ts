import type { Bracket } from '#shared/schemas/ws-bracket'

/**
 * 季後賽樹狀圖（限期活動「預測世界大賽冠軍」，見 `docs/ws-bracket.md`）。
 *
 * 這一份走既有的 BFF 分層（頁面不寫 API 路徑）。**只有下注資料是例外**，
 * 它由 `useWsBracketBets()` 直接連 Realtime Database。
 */

const ENDPOINTS = {
  bracket: '/ws-bracket',
  lock: '/admin/ws-bracket/lock',
} as const

/**
 * 【宣告式】樹狀圖與戰績，並在分頁看得見時每 `intervalMs` 重抓一次。
 *
 * 輪詢的三個條件比照比賽頁：**分頁在背景就暫停**（對看不見的畫面發請求
 * 沒有意義，手機還耗電）、間隔可調、設 0 就整個關掉。
 * 這裡不加「已結束就停止」—— 冠軍產生之後使用者通常也不會再開這一頁，
 * 為它多寫一個狀態機不划算，而 BFF 那層本來就有五分鐘的快取擋著。
 */
export function useWsBracket(intervalMs = 60_000) {
  const result = useApiFetch<Bracket>(ENDPOINTS.bracket)

  if (import.meta.client) {
    const visibility = useDocumentVisibility()
    const { pause, resume } = useIntervalFn(() => result.refresh(), intervalMs || 60_000, {
      immediate: false,
    })

    // ⚠️ watchEffect 會立刻執行一次，所以它必須放在用到的 const 之後（見 CLAUDE.md）
    watchEffect(() => {
      if (intervalMs > 0 && visibility.value === 'visible') resume()
      else pause()
    })
  }

  return result
}

/**
 * 【命令式】後台的鎖盤操作。
 *
 * 這是整個活動裡**唯一一支走 BFF 的寫入** —— 下注與移除都由瀏覽器直接打
 * Realtime Database，只有「還能不能下注」不能讓前台自己決定
 * （見 `server/utils/ws-bracket-lock.ts`）。
 */
export function useWsBracketLockActions() {
  const { put, loading, error } = useApi()

  return {
    loading,
    error,
    /** `lockAt` 是毫秒時間戳；`null` 解除鎖盤，過去的時間 = 立即鎖盤。 */
    setLock: (lockAt: number | null) => put<{ lockAt: number | null }>(ENDPOINTS.lock, { lockAt }),
  }
}
