import { describe, expect, it } from 'vitest'
import { normalizeDate, normalizeTime } from '../../server/utils/gemini'

/**
 * Gemini 回傳值的正規化。
 *
 * ## 為什麼這一層必須存在
 * prompt 已經明確要求「日期輸出 YYYY-MM-DD」，模型多半也照做，但偶爾會回
 * `3/15`、`2026/3/15`、`2026.03.15`。與其在提示詞裡一再強調（不保證有效，
 * 而且每次都要重新驗證），不如在程式碼裡收斂 —— 格式問題用程式碼處理
 * 比用提示詞處理可靠得多。
 *
 * 這也是少數能離線測試 AI 功能的部分：不需要真的呼叫 API。
 */

describe('normalizeDate', () => {
  it('已經是標準格式就原樣返回', () => {
    expect(normalizeDate('2026-03-15', 2026)).toBe('2026-03-15')
  })

  it.each([
    ['2026/3/15', '2026-03-15'],
    ['2026.03.15', '2026-03-15'],
    ['2026年3月15日', '2026-03-15'],
  ])('補零與統一分隔符：%s → %s', (input, expected) => {
    expect(normalizeDate(input, 2026)).toBe(expected)
  })

  it.each([
    ['3/15', '2026-03-15'],
    ['3月15日', '2026-03-15'],
  ])('只有月日時用預設年份補齊：%s → %s', (input, expected) => {
    expect(normalizeDate(input, 2026)).toBe(expected)
  })

  it('讀不出日期時回空字串，不猜測', () => {
    expect(normalizeDate('待定', 2026)).toBe('')
    expect(normalizeDate('', 2026)).toBe('')
  })
})

describe('normalizeTime', () => {
  it('已經是標準格式就原樣返回', () => {
    expect(normalizeTime('14:30')).toBe('14:30')
  })

  it.each([
    ['9:00', '09:00'],
    ['9點', '09:00'],
    ['14時30', '14:30'],
  ])('補零與中文寫法：%s → %s', (input, expected) => {
    expect(normalizeTime(input)).toBe(expected)
  })

  it('超出範圍或讀不懂時回空字串', () => {
    expect(normalizeTime('25:00')).toBe('')
    expect(normalizeTime('待定')).toBe('')
  })
})
