/**
 * 顯示用的格式化函式。
 *
 * 集中在這裡而不是散在各元件：日期在首頁、賽程頁、後台列表都要顯示，
 * 格式一旦各寫各的就會不一致（有的「3/15」有的「2026-03-15」）。
 */

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'] as const

/** `2026-03-15` → `3/15（六）`。列表上最常用的緊湊格式。 */
export function formatGameDate(date: string): string {
  const parsed = parseDateKey(date)
  if (!parsed) return date
  return `${parsed.getMonth() + 1}/${parsed.getDate()}（${WEEKDAYS[parsed.getDay()]}）`
}

/** `2026-03-15` → `2026 年 3 月 15 日 星期六`。詳情頁用的完整格式。 */
export function formatGameDateLong(date: string): string {
  const parsed = parseDateKey(date)
  if (!parsed) return date
  return `${parsed.getFullYear()} 年 ${parsed.getMonth() + 1} 月 ${parsed.getDate()} 日 星期${WEEKDAYS[parsed.getDay()]}`
}

/** ISO 時間字串 → `2026/03/15`。公告的發布日期。 */
export function formatDateTime(iso: string): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}/${month}/${day}`
}

/**
 * 距離比賽還有幾天。
 *
 * @param date `YYYY-MM-DD`
 * @param today `YYYY-MM-DD`，由呼叫端傳入 —— SSR 與瀏覽器若各自取
 *              `new Date()`，時區不同會算出不同結果，造成 hydration mismatch。
 */
export function daysUntil(date: string, today: string): number | null {
  const target = parseDateKey(date)
  const base = parseDateKey(today)
  if (!target || !base) return null
  return Math.round((target.getTime() - base.getTime()) / 86_400_000)
}

/** 把倒數天數講成人話。 */
export function describeCountdown(days: number | null): string {
  if (days === null) return ''
  if (days === 0) return '今天開打'
  if (days === 1) return '明天開打'
  if (days < 0) return `${Math.abs(days)} 天前`
  return `還有 ${days} 天`
}

/** 解析 `YYYY-MM-DD`，當地時間的零點。 */
function parseDateKey(date: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) return null
  // 直接 new Date('2026-03-15') 會被當成 UTC，在台灣時區會變成前一天的早上八點，
  // 顯示出來就差一天。用分開的參數建立才是當地時間。
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}
