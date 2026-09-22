import { describe, expect, it } from 'vitest'
import { backoffDelay } from '../../server/utils/external'

describe('backoffDelay', () => {
  /**
   * 上界是**閉區間**，不是開區間。
   *
   * 抖動是 `[0.5, 1.5)`，但回傳前經過 `Math.round()` —— jitter 落在
   * 1.4975 以上時 `200 × jitter` 會被進位成整數 300。原本這裡寫
   * `toBeLessThan(300)`，於是這個測試大約每 230 次會無緣無故紅一次，
   * 而且重跑就過，最容易被當成「CI 又抽風」而忽略。
   *
   * 對退避延遲來說 299 與 300 沒有任何差別，所以修的是斷言而不是實作。
   */
  it('隨重試次數指數成長', () => {
    // 加了抖動所以是區間比較，不是固定值
    const first = backoffDelay(0, 200) // 200ms × [0.5, 1.5]（四捨五入後）
    const second = backoffDelay(1, 200) // 400ms × [0.5, 1.5]
    const third = backoffDelay(2, 200) // 800ms × [0.5, 1.5]

    expect(first).toBeGreaterThanOrEqual(100)
    expect(first).toBeLessThanOrEqual(300)
    expect(second).toBeGreaterThanOrEqual(200)
    expect(second).toBeLessThanOrEqual(600)
    expect(third).toBeGreaterThanOrEqual(400)
    expect(third).toBeLessThanOrEqual(1200)
  })

  it('加入抖動 —— 同樣的參數不會每次都回傳一樣的值', () => {
    // 抖動的用意是避免大量失敗請求在同一瞬間一起重試，
    // 把剛要恢復的上游再次打掛（thundering herd）
    const samples = new Set(Array.from({ length: 30 }, () => backoffDelay(2, 200)))
    expect(samples.size).toBeGreaterThan(1)
  })
})
