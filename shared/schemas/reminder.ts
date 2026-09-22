import { z } from 'zod'
import { daysBetweenDateKeys, type Game } from './game'
import type { PushPayload } from './push'

/**
 * 比賽自動提醒。
 *
 * 賽前一週提醒大家回覆出席，賽前一天提醒明天要打球。判斷「今天該提醒哪幾場」
 * 全部寫在這裡的純函式裡，端點只負責「誰可以呼叫」與「送出去」——
 * 這段邏輯的每一個邊界（時區、漏跑、重複送）都要測得到。
 *
 * ## 為什麼早鳥提醒是一段區間，不是剛好第 7 天
 * 只認「剛好 7 天」的話，排程器漏跑一次（雲端服務偶爾會）那一場就永遠
 * 收不到早鳥提醒了。改成 3～7 天的區間，隔天補跑仍然送得出去；
 * 而且六天後才新增的比賽也涵蓋得到 —— 賽程本來就常常臨時才確定。
 *
 * 下限是 3 而不是 1：剩兩天以內的交給賽前一天那則就好，
 * 否則新增一場後天的比賽，會連著兩天各收到一則講同一件事的通知。
 *
 * ## 提醒文案講的是「實際還有幾天」
 * 不是照著提醒種類寫死「7 天後」。上面那個區間意味著早鳥提醒可能在第 5 天
 * 才送出，寫死的文案那時就是錯的 —— 而通知送出去收不回來。
 */

export const reminderKindSchema = z.enum(['d7', 'd1'])
export type ReminderKind = z.infer<typeof reminderKindSchema>

/** 每一種提醒會在賽前第幾天送出（含頭尾）。 */
export const REMINDER_WINDOWS: Record<ReminderKind, { min: number; max: number }> = {
  d7: { min: 3, max: 7 },
  d1: { min: 1, max: 1 },
}

export interface DueReminder {
  game: Game
  kind: ReminderKind
  /** 距離比賽實際還有幾天，文案用它。 */
  days: number
}

/**
 * 今天該送出哪些提醒。
 *
 * @param today `YYYY-MM-DD`，**台北時間**的今天（見 `taipeiDateKey()`）
 */
export function dueReminders(games: Game[], today: string): DueReminder[] {
  const due: DueReminder[] = []

  for (const game of games) {
    // 延賽、取消、已結束的場次不提醒 —— 提醒一場不會發生的比賽比不提醒更糟
    if (game.status !== 'scheduled') continue

    const days = daysBetweenDateKeys(today, game.date)
    if (days === null) continue

    for (const kind of ['d1', 'd7'] as const) {
      if (game.remindersSent.includes(kind)) continue
      const window = REMINDER_WINDOWS[kind]
      if (days < window.min || days > window.max) continue
      due.push({ game, kind, days })
      // 同一場同一天只送一則：剛好落在兩個區間的重疊處時，
      // 取比較急迫的那一則（迴圈從 d1 開始）
      break
    }
  }

  // 日期近的排前面，讓記錄檔與後台預覽的順序符合直覺
  return due.sort((a, b) => a.days - b.days || a.game.date.localeCompare(b.game.date))
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'] as const

/** `2026-09-29` → `9/29（二）`。和前台列表同一種寫法。 */
function shortDate(date: string): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!parts) return date
  const day = new Date(Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])))
  return `${Number(parts[2])}/${Number(parts[3])}（${WEEKDAYS[day.getUTCDay()]}）`
}

/**
 * 提醒的通知內容。
 *
 * `tag` 帶上比賽 id 與種類：同 tag 的通知會互相取代，所以兩場不同的比賽
 * 不能共用一個 tag（後送的會把前一則蓋掉，使用者只看得到其中一場）。
 */
export function reminderPayload({ game, kind, days }: DueReminder): PushPayload {
  const place = [game.venue, game.homeAway === 'home' ? '主場' : '客場'].filter(Boolean).join('・')

  const title =
    kind === 'd1'
      ? `明天 ${game.time} 對戰 ${game.opponent}`
      : `還有 ${days} 天：對戰 ${game.opponent}`

  const body =
    kind === 'd1'
      ? place
      : [`${shortDate(game.date)} ${game.time}`, place].filter(Boolean).join('・')

  return {
    // 對手名稱最長 40 字，加上前綴可能超過標題上限，截一下
    title: title.slice(0, 60),
    body: body.slice(0, 160),
    url: `/games/${game.id}`,
    tag: `game-${game.id}-${kind}`.slice(0, 40),
  }
}

/** 一次執行的結果，回給排程器與後台看。 */
export const reminderRunResultSchema = z.object({
  today: z.string(),
  /** 這次送出的提醒，後台直接列出來。 */
  sent: z.array(
    z.object({
      gameId: z.string(),
      kind: reminderKindSchema,
      title: z.string(),
      subscribers: z.number().int().min(0),
    }),
  ),
  /** 完全沒有訂閱者時會是 true —— 「執行成功但沒人收到」最難察覺。 */
  noSubscribers: z.boolean().default(false),
})

export type ReminderRunResult = z.infer<typeof reminderRunResultSchema>
