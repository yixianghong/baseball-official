import { describe, expect, it } from 'vitest'
import { normalizeHand, normalizePosition } from '../../server/utils/gemini'

/**
 * 名冊辨識的欄位正規化。
 *
 * 球隊的名冊是人整理出來的試算表，同一個欄位會出現各種寫法：守備位置有人寫
 * 「投手」、有人寫「P」、有人寫「先發」；慣用手有人寫「右」、有人寫「R」、
 * 有人整格寫「右投右打」。這一層把它們收斂成系統的列舉值。
 *
 * 用程式碼處理這種對照比在 prompt 裡叮嚀模型可靠得多 —— 而且可以像這樣測。
 */

describe('normalizePosition', () => {
  it.each([
    ['投手', 'P'],
    ['投', 'P'],
    ['P', 'P'],
    ['先發', 'P'],
    ['中繼', 'P'],
    ['捕手', 'C'],
    ['C', 'C'],
    ['一壘手', '1B'],
    ['一壘', '1B'],
    ['1B', '1B'],
    ['二壘手', '2B'],
    ['三壘手', '3B'],
    ['游擊手', 'SS'],
    ['游擊', 'SS'],
    ['SS', 'SS'],
    ['左外野', 'LF'],
    ['中外野', 'CF'],
    ['右外野', 'RF'],
    ['指定打擊', 'DH'],
    ['DH', 'DH'],
    ['指打', 'DH'],
  ])('「%s」→ %s', (input, expected) => {
    expect(normalizePosition(input)).toBe(expected)
  })

  it('大小寫與空白不影響判斷', () => {
    expect(normalizePosition(' ss ')).toBe('SS')
    expect(normalizePosition('1b')).toBe('1B')
  })

  it.each(['內野手', '外野手', '工具人', '替補'])(
    '沒有指定守位的「%s」回傳 null，由呼叫端填預設值',
    (input) => {
      // 猜一個守位填進去，看起來會像名冊上真的這樣寫
      expect(normalizePosition(input)).toBeNull()
    },
  )

  it('完全對不上的內容回傳 null（由呼叫端決定怎麼處理）', () => {
    expect(normalizePosition('教練')).toBeNull()
    expect(normalizePosition('')).toBeNull()
    expect(normalizePosition('   ')).toBeNull()
  })
})

describe('normalizeHand', () => {
  it.each([
    ['R', 'R'],
    ['L', 'L'],
    ['S', 'S'],
    ['右', 'R'],
    ['左', 'L'],
    ['左右開弓', 'S'],
    ['switch', 'S'],
  ])('「%s」→ %s', (input, expected) => {
    expect(normalizeHand(input, 'R')).toBe(expected)
  })

  it('讀不到時退回預設值，而不是讓整列匯不進來', () => {
    // 慣用手是後台隨時能改的欄位，不該因為名冊沒寫就擋下整位球員
    expect(normalizeHand('', 'R')).toBe('R')
    expect(normalizeHand(undefined, 'L')).toBe('L')
    expect(normalizeHand(null, 'R')).toBe('R')
  })

  it('認不得的內容也退回預設值', () => {
    expect(normalizeHand('不詳', 'R')).toBe('R')
  })

  it('「左右開弓」不會被誤判成左或右', () => {
    // 這個字串同時含「左」與「右」，比對順序寫錯就會判成 L
    expect(normalizeHand('左右開弓', 'R')).toBe('S')
  })
})
