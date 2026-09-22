/**
 * 月曆格子的計算。
 *
 * ## 為什麼全部用 UTC 做算術
 * 這些函式的輸入輸出都是 `YYYY-MM-DD` 字串 —— 球賽是「當地時間的某一天」，
 * 跟時區無關。但 `new Date('2026-09-01')` 會被當成 UTC 午夜，在台灣以西的
 * 時區取 `getDate()` 就會退回前一天。用 `Date.UTC()` 建構、用 `getUTC*` 讀取，
 * 整段計算就完全不碰本地時區，SSR 與瀏覽器也不會算出不同的月曆。
 */

/** 月曆上的一格。 */
export interface CalendarCell {
  /** `YYYY-MM-DD` */
  date: string
  /** 幾號。 */
  day: number
  /** 是不是所屬月份本身的日子（false 代表補齊用的上／下月日期）。 */
  inMonth: boolean
}

/** 星期標頭。週日起算，與台灣的月曆慣例一致。 */
export const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'] as const

/** `YYYY-MM-DD` → `YYYY-MM`。 */
export function toMonthKey(date: string): string {
  return date.slice(0, 7)
}

/** 位移月份，跨年會自動進退位。`shiftMonth('2026-01', -1)` → `'2025-12'`。 */
export function shiftMonth(monthKey: string, delta: number): string {
  const [year, month] = splitMonth(monthKey)
  const base = new Date(Date.UTC(year, month - 1 + delta, 1))
  return `${base.getUTCFullYear()}-${pad(base.getUTCMonth() + 1)}`
}

/** `2026-09` → `2026 年 9 月`。 */
export function formatMonth(monthKey: string): string {
  const [year, month] = splitMonth(monthKey)
  return `${year} 年 ${month} 月`
}

/**
 * 產生一個月的月曆格子。
 *
 * 前後會補上鄰月的日期把每一週填滿（標記 `inMonth: false`），
 * 而不是留空白格 —— 空格會讓月曆看起來像缺了一塊，補上灰色的鄰月日期
 * 才是一般月曆的樣子。總數一定是 7 的倍數。
 */
export function buildMonthGrid(monthKey: string): CalendarCell[] {
  const [year, month] = splitMonth(monthKey)

  const firstOfMonth = new Date(Date.UTC(year, month - 1, 1))
  // 這一週要從上個月的哪一天開始補
  const leading = firstOfMonth.getUTCDay()
  const start = new Date(Date.UTC(year, month - 1, 1 - leading))

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const totalCells = Math.ceil((leading + daysInMonth) / 7) * 7

  return Array.from({ length: totalCells }, (_, index) => {
    const cell = new Date(start)
    cell.setUTCDate(start.getUTCDate() + index)

    return {
      date: `${cell.getUTCFullYear()}-${pad(cell.getUTCMonth() + 1)}-${pad(cell.getUTCDate())}`,
      day: cell.getUTCDate(),
      inMonth: cell.getUTCMonth() + 1 === month && cell.getUTCFullYear() === year,
    }
  })
}

function splitMonth(monthKey: string): [number, number] {
  const [year, month] = monthKey.split('-').map(Number)
  return [year ?? 0, month ?? 1]
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}
