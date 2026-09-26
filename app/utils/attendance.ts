import type { AttendanceEntry } from '#shared/schemas/game'
import type { Player } from '#shared/schemas/player'

/**
 * 把現役球員補進出席名單。
 *
 * 規則：
 * - 名單中缺少的現役球員補進來，狀態「未回覆」
 * - 已經登記過的保持原狀，不會被洗掉
 * - 已退隊但先前登記過的保留下來（他當時確實回報過）
 * - 排序跟著球員名單走，退隊的接在後面
 *
 * ## 為什麼是純函式，而且父元件與編輯器都要呼叫
 * 「進到出席分頁就看得到隊員」是必要的 —— 需要先按一顆「帶入名單」的按鈕，
 * 那一步沒有任何決定可言。但那份補齊的名單**不是使用者的變更**，而後台是
 * 自動儲存的，所以補的時機決定了「打開頁面會不會寫一次資料庫」：
 *
 * - 補在**編輯器掛載時**（原本的做法）：它發生在父元件取好自動儲存的基準
 *   **之後**，於是打開一場還沒登記出席的比賽就會送出一次 PATCH，
 *   把 11 筆「未回覆」寫進資料庫，畫面上還會跳一則「已自動儲存」。
 * - 補在**父元件灌資料時**（現在的做法）：基準一開始就含這份名單，
 *   編輯器的同步算出同一個結果、發現沒變就不寫回，所以完全沒有寫入。
 *
 * 用「等一個 `nextTick` 再重新取基準」修不掉 —— 子元件的掛載不在那個時機裡，
 * 而且那種修法等於把正確性綁在渲染順序上。編輯器那邊的同步仍然留著，
 * 它負責的是**之後**球員名單變動（新球員入隊）的情況。
 */
export function mergeAttendanceWithRoster(
  attendance: AttendanceEntry[],
  players: Player[],
): AttendanceEntry[] {
  const existing = new Map(attendance.map((entry) => [entry.playerId, entry]))
  const active = players.filter((player) => player.status === 'active')

  const merged = active.map(
    (player) =>
      existing.get(player.id) ?? {
        playerId: player.id,
        name: player.name,
        number: player.number,
        status: 'pending' as const,
        note: '',
      },
  )

  const activeIds = new Set(active.map((player) => player.id))
  const retired = attendance.filter((entry) => !activeIds.has(entry.playerId))

  return [...merged, ...retired]
}
