import { describe, expect, it } from 'vitest'
import {
  daysUntil,
  describeCountdown,
  formatDateTime,
  formatGameDate,
  formatGameDateLong,
} from '../../app/utils/format'

/**
 * 顯示格式化。
 *
 * 重點在時區：`new Date('2026-03-15')` 會被當成 UTC 午夜，在 UTC+8 顯示出來
 * 會變成 3/14。球賽是「當地時間的某一天」，差一天就是完全錯誤的資訊。
 */

describe('formatGameDate', () => {
  it('輸出月/日與星期', () => {
    // 2026-03-15 是星期日
    expect(formatGameDate('2026-03-15')).toBe('3/15（日）')
  })

  it('不會因為時區而差一天', () => {
    // 直接 new Date('2026-01-01') 會是 UTC 午夜，在 UTC+8 會變成 2025-12-31
    expect(formatGameDate('2026-01-01')).toContain('1/1')
  })

  it('格式不正確時原樣返回，不顯示 Invalid Date', () => {
    expect(formatGameDate('待定')).toBe('待定')
  })
})

describe('formatGameDateLong', () => {
  it('輸出完整中文日期', () => {
    expect(formatGameDateLong('2026-03-15')).toBe('2026 年 3 月 15 日 星期日')
  })
})

describe('formatDateTime', () => {
  it('把 ISO 字串格式化為年/月/日', () => {
    expect(formatDateTime('2026-03-15T06:30:00.000Z')).toMatch(/^2026\/03\/1[56]$/)
  })

  it('空字串與無效值回空字串', () => {
    expect(formatDateTime('')).toBe('')
    expect(formatDateTime('not-a-date')).toBe('')
  })
})

describe('daysUntil / describeCountdown', () => {
  it('計算相隔天數', () => {
    expect(daysUntil('2026-03-15', '2026-03-10')).toBe(5)
    expect(daysUntil('2026-03-10', '2026-03-15')).toBe(-5)
  })

  it('跨月與跨年也正確', () => {
    expect(daysUntil('2026-01-01', '2025-12-31')).toBe(1)
  })

  it.each([
    [0, '今天開打'],
    [1, '明天開打'],
    [7, '還有 7 天'],
    [-3, '3 天前'],
  ])('倒數 %i 天 → %s', (days, expected) => {
    expect(describeCountdown(days)).toBe(expected)
  })

  it('日期無效時回空字串', () => {
    expect(daysUntil('待定', '2026-03-10')).toBeNull()
    expect(describeCountdown(null)).toBe('')
  })
})
