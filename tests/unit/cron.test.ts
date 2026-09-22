import { describe, expect, it } from 'vitest'
import { secretMatches } from '../../server/utils/cron'

/**
 * 排程端點的密鑰比對。
 *
 * 這把密鑰是 `/api/cron/*` 唯一的閘門 —— 它是全站第二支沒有 session 也能
 * 呼叫的寫入端點，比對寫鬆了就等於沒有防線。
 */
describe('secretMatches', () => {
  it('相同才通過', () => {
    expect(secretMatches('s3cret', 's3cret')).toBe(true)
    expect(secretMatches('s3cret', 'other!')).toBe(false)
  })

  it('沒設定密鑰時一律不通過', () => {
    // 空字串不等於「不用驗證」—— 忘了設定的部署不該變成任何人都能觸發推播
    expect(secretMatches('anything', '')).toBe(false)
    expect(secretMatches('', '')).toBe(false)
  })

  it('長度不同時回 false 而不是拋例外', () => {
    // timingSafeEqual 遇到長度不同會拋，而那個例外本身就洩漏了長度
    expect(() => secretMatches('short', 'muchlongersecret')).not.toThrow()
    expect(secretMatches('short', 'muchlongersecret')).toBe(false)
  })
})
