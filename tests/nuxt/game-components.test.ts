// @vitest-environment nuxt
import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import type { Scoreboard } from '../../shared/schemas/game'
import GameScoreboard from '../../app/components/game/GameScoreboard.vue'
import GameLineupCard from '../../app/components/game/GameLineupCard.vue'
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

/**
 * 出賽名單圖卡。
 *
 * 它是前台唯一的名單呈現方式（原本旁邊那份表格已經移除），所以這裡測的
 * 不只是畫面 —— 連結與守位的無障礙標示都是它自己要撐起來的。
 */
describe('GameLineupCard', () => {
  const entries = [
    { order: 1, playerId: 'p1', name: '張志豪', number: '7', position: '2B' as const },
    { order: 2, playerId: '', name: '支援球員', number: '', position: 'P' as const },
  ]
  const baseProps = {
    entries,
    teamName: '城市棒球隊',
    opponent: '藍鷹隊',
    date: '2026-09-29',
    time: '09:00',
  }

  it('有 playerId 的球員做成個人頁連結', async () => {
    const component = await mountSuspended(GameLineupCard, { props: baseProps })

    const links = component.findAll('a')
    expect(links).toHaveLength(1)
    expect(links[0]!.attributes('href')).toBe('/players/p1')
  })

  it('沒有 playerId 的支援球員只顯示姓名，不做成連結', async () => {
    const component = await mountSuspended(GameLineupCard, { props: baseProps })
    expect(component.text()).toContain('支援球員')
  })

  it('姓名帶背號，沒有背號就只有名字', async () => {
    const component = await mountSuspended(GameLineupCard, { props: baseProps })

    expect(component.text()).toContain('#7 張志豪')
    // 沒背號的不該出現一個孤零零的井字號
    expect(component.text()).not.toContain('# 支援球員')
  })

  /**
   * 守位視覺上是縮寫，但螢幕閱讀器把 `2B` 念成「二 B」對聽的人毫無意義，
   * 所以同時藏一份中文全名。圖卡是唯一的呈現方式，這件事只能由它自己負責。
   */
  it('守位縮寫同時提供中文全名給輔助科技', async () => {
    const component = await mountSuspended(GameLineupCard, { props: baseProps })

    expect(component.text()).toContain('2B')
    expect(component.html()).toContain('二壘手')
  })

  it('候補列在先發之後，同樣可以點進個人頁', async () => {
    const component = await mountSuspended(GameLineupCard, {
      props: {
        ...baseProps,
        bench: [{ playerId: 'p9', name: '鄭凱文', number: '24', status: 'yes' as const, note: '' }],
      },
    })

    expect(component.text()).toContain('候補')
    expect(component.text()).toContain('#24 鄭凱文')
    expect(component.findAll('a').map((link) => link.attributes('href'))).toContain('/players/p9')
  })

  it('沒有候補時不顯示候補那一段', async () => {
    const component = await mountSuspended(GameLineupCard, { props: baseProps })
    expect(component.text()).not.toContain('候補')
  })

  it('整張卡不能標 aria-hidden（它是唯一的名單來源）', async () => {
    const component = await mountSuspended(GameLineupCard, { props: baseProps })
    expect(component.element.getAttribute('aria-hidden')).toBeNull()
  })

  /**
   * 下載與分享是兩顆各自明確的按鈕。
   *
   * 讓一顆按鈕自己判斷「能分享就分享、不能就下載」的話，使用者按下去之前
   * 不知道會發生什麼 —— 想存檔的人被叫出分享選單，想貼群組的人拿到一個檔案。
   */
  it('下載與分享是兩顆獨立的按鈕', async () => {
    const component = await mountSuspended(GameLineupCard, { props: baseProps })
    const labels = component.findAll('button').map((button) => button.text())

    expect(labels).toContain('下載圖片')
    expect(labels).toContain('分享')
  })

  /**
   * 按鈕必須在被截圖的節點**外面**。截到一顆「下載圖片」按鈕，
   * 看起來就像截圖截壞了。
   */
  it('按鈕不在被截圖的卡片裡', async () => {
    const component = await mountSuspended(GameLineupCard, { props: baseProps })

    const card = component.find('.rounded-2xl')
    expect(card.exists()).toBe(true)
    expect(card.findAll('button')).toHaveLength(0)
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
