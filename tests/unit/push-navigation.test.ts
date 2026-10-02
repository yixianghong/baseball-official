import { describe, expect, it } from 'vitest'
import { navigationTargetFrom } from '../../app/utils/push-navigation'

/**
 * Service worker 請頁面換頁時的判斷（點了推播通知）。
 *
 * 這是**最後一道防線**：訊息從 SW 來，而 SW 的通知酬載是從網路來的。
 * 放行一個外部網址的下場，是一則外觀來自球隊、點下去是別人網站的通知。
 */

describe('navigationTargetFrom', () => {
  it('站內路徑放行', () => {
    expect(navigationTargetFrom({ type: 'navigate', url: '/games/g3' })).toBe('/games/g3')
    expect(navigationTargetFrom({ type: 'navigate', url: '/games/g3?tab=x#a' })).toBe(
      '/games/g3?tab=x#a',
    )
  })

  it('⚠️ 協定相對網址擋掉 —— 它也以 / 開頭，但指向外部站台', () => {
    expect(navigationTargetFrom({ type: 'navigate', url: '//evil.test/a' })).toBeNull()
    expect(navigationTargetFrom({ type: 'navigate', url: '/\\evil.test' })).toBeNull()
  })

  it('絕對網址擋掉', () => {
    expect(navigationTargetFrom({ type: 'navigate', url: 'https://evil.test' })).toBeNull()
  })

  it('不是這種訊息就不管', () => {
    // SW 之後可能送別種訊息，這裡不該誤判
    expect(navigationTargetFrom({ type: 'other', url: '/games/g3' })).toBeNull()
    expect(navigationTargetFrom({ type: 'navigate' })).toBeNull()
    expect(navigationTargetFrom({ type: 'navigate', url: 42 })).toBeNull()
    expect(navigationTargetFrom(null)).toBeNull()
    expect(navigationTargetFrom('navigate')).toBeNull()
  })
})
