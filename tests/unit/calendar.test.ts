import { describe, expect, it } from 'vitest'
import {
  buildMonthGrid,
  clampMonth,
  formatMonth,
  shiftMonth,
  toMonthKey,
} from '../../app/utils/calendar'

/**
 * 月曆的日期計算。
 *
 * 這裡最容易出錯的是時區：`new Date('2026-09-01')` 是 UTC 午夜，在台灣以西
 * 的時區取 `getDate()` 會退回 8/31，整個月曆就位移一天。所以全部用
 * `Date.UTC()` 算 —— 下面的測試刻意涵蓋月初、月底與跨年。
 */

describe('buildMonthGrid', () => {
  it('格子數一定是 7 的倍數（每一週都填滿）', () => {
    for (const month of ['2026-01', '2026-02', '2026-09', '2027-02']) {
      expect(buildMonthGrid(month).length % 7).toBe(0)
    }
  })

  it('第一格一定是週日', () => {
    const grid = buildMonthGrid('2026-09')
    expect(new Date(`${grid[0]!.date}T00:00:00Z`).getUTCDay()).toBe(0)
  })

  it('本月的日子數量正確，而且連續', () => {
    const days = buildMonthGrid('2026-09').filter((cell) => cell.inMonth)

    expect(days).toHaveLength(30)
    expect(days[0]!.date).toBe('2026-09-01')
    expect(days.at(-1)!.date).toBe('2026-09-30')
  })

  it('補齊用的鄰月日期標記為不在本月', () => {
    // 2026-09-01 是星期二，所以前面要補 8/30、8/31 兩天
    const grid = buildMonthGrid('2026-09')
    const leading = grid.slice(0, 2)

    expect(leading.map((cell) => cell.date)).toEqual(['2026-08-30', '2026-08-31'])
    expect(leading.every((cell) => !cell.inMonth)).toBe(true)
  })

  it('閏年的二月是 29 天', () => {
    expect(buildMonthGrid('2028-02').filter((cell) => cell.inMonth)).toHaveLength(29)
    expect(buildMonthGrid('2026-02').filter((cell) => cell.inMonth)).toHaveLength(28)
  })

  it('跨年的月份也算得對', () => {
    const december = buildMonthGrid('2026-12').filter((cell) => cell.inMonth)
    expect(december.at(-1)!.date).toBe('2026-12-31')

    const january = buildMonthGrid('2027-01')
    // 1 月的前面補的是去年 12 月
    expect(january[0]!.date.startsWith('2026-12') || january[0]!.date === '2027-01-01').toBe(true)
  })
})

describe('shiftMonth', () => {
  it('前後移動一個月', () => {
    expect(shiftMonth('2026-09', 1)).toBe('2026-10')
    expect(shiftMonth('2026-09', -1)).toBe('2026-08')
  })

  it('跨年時進退位', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
  })

  it('可以一次跳多個月', () => {
    expect(shiftMonth('2026-09', 12)).toBe('2027-09')
    expect(shiftMonth('2026-09', -24)).toBe('2024-09')
  })
})

describe('toMonthKey 與 formatMonth', () => {
  it('從日期取出月份', () => {
    expect(toMonthKey('2026-09-29')).toBe('2026-09')
  })

  it('月份不補零地顯示', () => {
    expect(formatMonth('2026-09')).toBe('2026 年 9 月')
    expect(formatMonth('2026-12')).toBe('2026 年 12 月')
  })
})

/**
 * 迴歸測試：範圍內沒有比賽的月份必須可以停留。
 *
 * 線上資料是 2026-07 與 2026-09 各一場、八月空著。原本的判斷是
 * 「這個月有沒有比賽」，於是按「上一個月」切到八月時立刻被彈回九月 ——
 * 值改了又在同一幀被改回來，使用者看到的是**按鈕完全沒反應**。
 */
describe('clampMonth', () => {
  const available = ['2026-07', '2026-09']

  it('範圍內沒有比賽的月份可以停留（就是按鈕看起來壞掉的那個 bug）', () => {
    expect(clampMonth('2026-08', available)).toBe('2026-08')
  })

  it('有比賽的月份當然可以停留', () => {
    expect(clampMonth('2026-07', available)).toBe('2026-07')
    expect(clampMonth('2026-09', available)).toBe('2026-09')
  })

  it('超出最晚的月份拉回最晚', () => {
    expect(clampMonth('2026-10', available)).toBe('2026-09')
    expect(clampMonth('2027-03', available)).toBe('2026-09')
  })

  it('早於最早的月份拉回最早', () => {
    expect(clampMonth('2026-06', available)).toBe('2026-07')
    expect(clampMonth('2025-01', available)).toBe('2026-07')
  })

  it('還沒選過時給最近有比賽的那個月', () => {
    expect(clampMonth('', available)).toBe('2026-09')
  })

  it('完全沒有比賽時原樣回傳，不要亂猜一個月份', () => {
    expect(clampMonth('2026-08', [])).toBe('2026-08')
    expect(clampMonth('', [])).toBe('')
  })

  it('只有一個月份時，所有輸入都收斂到它', () => {
    expect(clampMonth('2026-01', ['2026-09'])).toBe('2026-09')
    expect(clampMonth('2026-12', ['2026-09'])).toBe('2026-09')
  })
})
