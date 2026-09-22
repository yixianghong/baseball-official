// @vitest-environment nuxt
import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import type { Scoreboard } from '../../shared/schemas/game'
import GameScoreboard from '../../app/components/game/GameScoreboard.vue'
import GameLineup from '../../app/components/game/GameLineup.vue'
import GameAttendance from '../../app/components/game/GameAttendance.vue'

/**
 * 比賽相關元件。
 *
 * 最值得測的是計分板的「上下半局排列」：資料層存的是我隊／對手，
 * 但計分板的呈現慣例是先攻（客隊）在上面。這個換算錯了，畫面上的
 * 兩支球隊就會對調 —— 而且看起來一切正常，很難用肉眼發現。
 */

const scoreboard: Scoreboard = {
  innings: [
    { inning: 1, our: 2, opponent: 0 },
    { inning: 2, our: 1, opponent: 3 },
    { inning: 3, our: null, opponent: 1 },
  ],
  totals: { our: { r: 3, h: 5, e: 1 }, opponent: { r: 4, h: 7, e: 0 } },
}

describe('GameScoreboard', () => {
  it('主場時我隊排在下面（後攻）', async () => {
    const component = await mountSuspended(GameScoreboard, {
      props: { scoreboard, homeAway: 'home', ourName: '城市隊', opponentName: '藍鷹隊' },
    })

    const rowHeaders = component.findAll('tbody th').map((th) => th.text())
    expect(rowHeaders).toEqual(['藍鷹隊', '城市隊'])
  })

  it('客場時我隊排在上面（先攻）', async () => {
    const component = await mountSuspended(GameScoreboard, {
      props: { scoreboard, homeAway: 'away', ourName: '城市隊', opponentName: '藍鷹隊' },
    })

    const rowHeaders = component.findAll('tbody th').map((th) => th.text())
    expect(rowHeaders).toEqual(['城市隊', '藍鷹隊'])
  })

  it('沒有進行的半局顯示為 X 而不是 0', async () => {
    const component = await mountSuspended(GameScoreboard, {
      props: { scoreboard, homeAway: 'away', ourName: '城市隊', opponentName: '藍鷹隊' },
    })

    // 我隊那一列（客場時在第一列）第三格是 null
    const firstRowCells = component
      .findAll('tbody tr')[0]!
      .findAll('td')
      .map((td) => td.text())
    expect(firstRowCells.slice(0, 3)).toEqual(['2', '1', 'X'])
  })

  it('逐局加總與總分不符時顯示提醒', async () => {
    const component = await mountSuspended(GameScoreboard, {
      props: {
        // 逐局加總是 3:4，這裡的總分刻意寫成 9
        scoreboard: {
          ...scoreboard,
          totals: { our: { r: 9, h: 5, e: 1 }, opponent: { r: 4, h: 7, e: 0 } },
        },
        homeAway: 'home',
        ourName: '城市隊',
        opponentName: '藍鷹隊',
      },
    })

    expect(component.text()).toContain('不一致')
  })

  it('加總正確時不顯示提醒', async () => {
    const component = await mountSuspended(GameScoreboard, {
      props: { scoreboard, homeAway: 'home', ourName: '城市隊', opponentName: '藍鷹隊' },
    })

    expect(component.text()).not.toContain('不一致')
  })
})

describe('GameLineup', () => {
  const entries = [
    { order: 1, playerId: 'p1', name: '張志豪', number: '7', position: '2B' as const },
    { order: 2, playerId: '', name: '支援球員', number: '', position: 'P' as const },
  ]

  it('有 playerId 的球員做成個人頁連結', async () => {
    const component = await mountSuspended(GameLineup, { props: { entries } })

    const links = component.findAll('a')
    expect(links).toHaveLength(1)
    expect(links[0]!.attributes('href')).toBe('/players/p1')
  })

  it('沒有 playerId 的支援球員只顯示姓名', async () => {
    const component = await mountSuspended(GameLineup, { props: { entries } })
    expect(component.text()).toContain('支援球員')
  })

  it('tentative 時說明這是預計名單', async () => {
    const component = await mountSuspended(GameLineup, { props: { entries, tentative: true } })
    expect(component.text()).toContain('實際出賽以當天為準')
  })
})

describe('GameAttendance', () => {
  it('統計確定出席人數並依狀態分組', async () => {
    const component = await mountSuspended(GameAttendance, {
      props: {
        entries: [
          { playerId: 'p1', name: 'A', number: '1', status: 'yes' as const, note: '' },
          { playerId: 'p2', name: 'B', number: '2', status: 'yes' as const, note: '' },
          { playerId: 'p3', name: 'C', number: '3', status: 'no' as const, note: '出差' },
          { playerId: 'p4', name: 'D', number: '4', status: 'pending' as const, note: '' },
        ],
      },
    })

    const text = component.text()
    expect(text).toContain('2')
    expect(text).toContain('出席')
    expect(text).toContain('不出席')
    expect(text).toContain('出差')
  })

  it('沒有人回報某個狀態時不顯示該分組', async () => {
    const component = await mountSuspended(GameAttendance, {
      props: {
        entries: [{ playerId: 'p1', name: 'A', number: '1', status: 'yes' as const, note: '' }],
      },
    })

    expect(component.text()).not.toContain('不出席')
  })
})
