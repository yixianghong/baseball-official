import { describe, expect, it } from 'vitest'
import { normalizeAttendanceStatus } from '../../server/utils/gemini'

/**
 * 出席狀態的正規化。
 *
 * 出席人數會直接影響教練怎麼準備（要不要找外援、帶幾套裝備），所以這裡
 * 的原則跟其他欄位不同：**認不得就當作「未回覆」，絕不猜測**。
 * 猜錯一個人，名單上看起來是確定的，實際上沒人知道他到底來不來。
 */

describe('normalizeAttendanceStatus', () => {
  it.each([
    ['yes', 'yes'],
    ['no', 'no'],
    ['maybe', 'maybe'],
    ['pending', 'pending'],
  ])('照 schema 的值原樣保留：%s', (input, expected) => {
    expect(normalizeAttendanceStatus(input)).toBe(expected)
  })

  it('大小寫與前後空白不影響判斷', () => {
    expect(normalizeAttendanceStatus(' YES ')).toBe('yes')
    expect(normalizeAttendanceStatus('No')).toBe('no')
  })

  it.each(['出席', '參加', '+1', '不確定', '', null, undefined, 123])(
    '認不得的內容（%s）一律當成未回覆，不猜測',
    (input) => {
      expect(normalizeAttendanceStatus(input)).toBe('pending')
    },
  )
})
