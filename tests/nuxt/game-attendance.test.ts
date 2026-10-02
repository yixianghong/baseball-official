// @vitest-environment nuxt
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import GameAttendance from '../../app/components/game/GameAttendance.vue'
import type { AttendanceEntry } from '../../shared/schemas/game'

/**
 * 前台的出席名單 —— 隊員自己回報的那個版本。
 *
 * 守三件事：**兩段式**（點名字不會直接送出，手滑不會改到別人）、
 * **已開打的場次只能看**，以及**沒有 playerId 的人點不下去**
 * （臨時支援球員，伺服器是用 playerId 找人的，讓他點只會拿到看不懂的 404）。
 */

const answerAttendance = vi.fn()

mockNuxtImport('useGameActions', () => () => ({ answerAttendance }))

function entry(overrides: Partial<AttendanceEntry> & { playerId: string }): AttendanceEntry {
  return { name: '王大明', number: '1', status: 'pending', note: '', ...overrides }
}

const entries = [
  entry({ playerId: 'p1', name: '王大明', number: '1' }),
  entry({ playerId: 'p2', name: '林建良', number: '2', status: 'yes' }),
  // 臨時支援球員：名單上有，但不在名冊裡，所以沒有 playerId
  entry({ playerId: '', name: '支援球員', number: '' }),
]

beforeEach(() => answerAttendance.mockReset())

describe('GameAttendance', () => {
  it('沒給 gameId 時整份是唯讀的（已開打、已結束的場次）', async () => {
    const component = await mountSuspended(GameAttendance, { props: { entries } })

    expect(component.findAll('button')).toHaveLength(0)
    expect(component.text()).toContain('王大明')
  })

  it('⚠️ 點名字不會直接送出 —— 要再點一次答案', async () => {
    const component = await mountSuspended(GameAttendance, {
      props: { entries, gameId: 'g1' },
    })

    const nameButton = component.findAll('button').find((b) => b.text().includes('王大明'))
    await nameButton!.trigger('click')

    expect(answerAttendance).not.toHaveBeenCalled()
    expect(component.text()).toContain('要改成')
  })

  it('點了答案才送出，而且帶著那個人的 playerId', async () => {
    answerAttendance.mockResolvedValue({ attendance: entries })
    const component = await mountSuspended(GameAttendance, {
      props: { entries, gameId: 'g1' },
    })

    await component
      .findAll('button')
      .find((b) => b.text().includes('林建良'))!
      .trigger('click')
    await component
      .findAll('button')
      .find((b) => b.text() === '不出席')!
      .trigger('click')

    expect(answerAttendance).toHaveBeenCalledWith('g1', { playerId: 'p2', status: 'no' })
  })

  it('回報成功後把端點回傳的整份名單丟出去（不是只改自己那一筆）', async () => {
    const updated = [entry({ playerId: 'p1', status: 'yes' })]
    answerAttendance.mockResolvedValue({ attendance: updated })
    const component = await mountSuspended(GameAttendance, {
      props: { entries, gameId: 'g1' },
    })

    await component
      .findAll('button')
      .find((b) => b.text().includes('王大明'))!
      .trigger('click')
    await component
      .findAll('button')
      .find((b) => b.text() === '出席')!
      .trigger('click')

    expect(component.emitted('updated')?.[0]).toEqual([updated])
  })

  it('⚠️ 沒有 playerId 的人點不下去，而且不會自己張開答案面板', async () => {
    /*
     * 臨時支援球員的 playerId 就是空字串。曾經用 `''` 當「沒有展開任何人」
     * 的哨兵值 —— 於是 `open === member.playerId` 對他永遠成立，
     * 他那一列從第一次渲染起就張著面板，而且點不動。
     */
    const component = await mountSuspended(GameAttendance, {
      props: { entries, gameId: 'g1' },
    })

    expect(component.findAll('button').find((b) => b.text().includes('支援球員'))).toBeUndefined()
    expect(component.text()).not.toContain('要改成')
  })

  /*
   * 「送出失敗時把原因寫在畫面上」沒有在這裡測。
   *
   * Vue 在測試環境會把**非同步事件處理器**裡的錯誤重新丟出來，即使元件自己
   * 已經接住了 —— 於是那一條測試永遠會多一個攔不住的 unhandled error，
   * 而斷言本身是通過的（畫面上確實印出了錯誤訊息）。
   * 那條路徑改用真的瀏覽器驗（對一場已結束的比賽回報 → 409 → 訊息出現在畫面上）。
   */
})
