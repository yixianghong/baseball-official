import { describe, expect, it } from 'vitest'
import {
  normalizeDate,
  normalizeJerseyNumber,
  normalizePlayResult,
  normalizeTime,
} from '../../server/utils/gemini'

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

describe('normalizePlayResult（語音講的說法 → 列舉值）', () => {
  it.each([
    ['一壘安打', 'single'],
    ['一安', 'single'],
    ['二壘安打', 'double'],
    ['二安', 'double'],
    ['三壘安打', 'triple'],
    ['三安', 'triple'],
    ['三壘打', 'triple'],
    ['全壘打', 'homerun'],
    ['紅不讓', 'homerun'],
    ['四壞', 'walk'],
    ['保送', 'walk'],
    ['三振', 'strikeout'],
    ['被三振', 'strikeout'],
    ['滾地球出局', 'groundout'],
    ['滾地', 'groundout'],
    ['飛球出局', 'flyout'],
    ['接殺', 'flyout'],
    ['雙殺打', 'doublePlay'],
    ['雙殺', 'doublePlay'],
    ['野選', 'fieldersChoice'],
    ['高飛犧牲打', 'sacrificeFly'],
    ['盜壘失敗', 'runnerOut'],
  ])('「%s」→ %s', (spoken, expected) => {
    expect(normalizePlayResult(spoken)).toBe(expected)
  })

  /**
   * ⚠️ 這一組是整個正規化存在的主要理由。
   *
   * 「三振」和「三壘安打」在中文語音辨識裡最容易混，而弄錯的後果是
   * 一個出局變成一支三壘安打 —— 出局數、得分、打擊率會一起錯掉，
   * 而畫面上完全看不出來。
   */
  it('「三振」不會被收斂成三壘安打', () => {
    expect(normalizePlayResult('三振')).toBe('strikeout')
    expect(normalizePlayResult('三振出局')).toBe('strikeout')
  })

  it('「三壘安打」不會被收斂成三振', () => {
    expect(normalizePlayResult('三壘安打')).toBe('triple')
  })

  /**
   * 長的別名要先比對：「三壘安打」裡面含有「安打」（single 的別名之一），
   * 照列舉順序比對的話，三壘安打會被當成一壘安打。
   */
  it('比對時長的說法優先', () => {
    expect(normalizePlayResult('三壘安打')).toBe('triple')
    expect(normalizePlayResult('二壘安打')).toBe('double')
    expect(normalizePlayResult('安打')).toBe('single')
  })

  it('句子裡夾著別的字也認得出來', () => {
    expect(normalizePlayResult('打了一支三壘安打')).toBe('triple')
    expect(normalizePlayResult('  三 振  ')).toBe('strikeout')
  })

  it('認不得的一律是「其他」，不猜', () => {
    // 猜一個結果填進去的話，出局數與打擊率都會跟著錯，而畫面上看起來正常。
    // 寧可標成「其他」等人確認
    expect(normalizePlayResult('不知道在說什麼')).toBe('other')
    expect(normalizePlayResult('')).toBe('other')
    expect(normalizePlayResult(undefined)).toBe('other')
  })
})

describe('normalizeJerseyNumber', () => {
  it.each([
    ['24', '24'],
    ['24號', '24'],
    ['#24', '24'],
    [' 7 ', '7'],
    ['沒聽清楚', ''],
  ])('「%s」→ 「%s」', (input, expected) => {
    expect(normalizeJerseyNumber(input)).toBe(expected)
  })

  it('最多三碼（背號不會更長，多的是雜訊）', () => {
    expect(normalizeJerseyNumber('123456')).toBe('123')
  })
})
