import { taipeiDateTimeKey, type AttendanceEntry, type Game } from './game'
import type { Player } from './player'

/**
 * 出席還能不能改。
 *
 * 兩條線，**取先到的那一條**：
 *
 * 1. **比賽開打就鎖**（狀態不是 `scheduled`）。這條是本來就有的，而且關不掉 ——
 *    開打之後那份名單就是歷史紀錄了，出賽名單圖卡與候補推導都讀它，
 *    賽後被改一筆，那場比賽的紀錄就跟著變。
 * 2. **後台設的截止時間**（`attendanceLockAt`，選填）。教練要照名單排打線、
 *    訂便當，所以需要一條比開打更早的線。
 *
 * ⚠️ **前後台共用這一支。** 前台用它決定要不要畫出可以點的按鈕，端點用它決定
 * 要不要收 —— 兩邊各寫一次的話，遲早會出現「畫面上按得下去，按了卻失敗」
 * 或更糟的「畫面上鎖住了，但 API 還收」。真正擋得住的是端點那一次。
 *
 * ⚠️ 時間比的是**字串**。`attendanceLockAt` 存的是台北時間的牆上時鐘
 * （`YYYY-MM-DDTHH:mm`，固定寬度、補零），`taipeiDateTimeKey()` 產出同一個
 * 格式 —— 中間不經過 `Date` 的換算，就沒有時區換算錯的機會。
 */
export function attendanceLocked(
  game: Pick<Game, 'status' | 'attendanceLockAt'>,
  now: Date = new Date(),
): boolean {
  if (game.status !== 'scheduled') return true
  if (!game.attendanceLockAt) return false
  return taipeiDateTimeKey(now) >= game.attendanceLockAt
}

/** `2026-10-09T18:30` → `10/9 18:30`。畫面上寫截止時間用。 */
export function formatLockAt(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})$/.exec(value)
  if (!match) return value
  return `${Number(match[2])}/${Number(match[3])} ${match[4]}`
}

/**
 * 把現役球員補進出席名單。
 *
 * 規則：
 * - 名單中缺少的現役球員補進來，狀態「未回覆」
 * - 已經登記過的保持原狀，不會被洗掉
 * - 已退隊但先前登記過的保留下來（他當時確實回報過）
 * - 排序跟著球員名單走，退隊的接在後面
 *
 *
 * ## 為什麼在 `shared/` 而不是 `app/`
 * 伺服器端也要用它：**新增比賽時就把現役名單補成「未回覆」**。少了那一步，
 * 一場剛建好的比賽 `attendance` 是空的，前台的「我會不會到」就沒有任何人可以點
 * —— 而賽前提醒是排程自動送的，不保證管理者在那之前開過出席分頁。
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
