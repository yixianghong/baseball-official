// @vitest-environment nuxt
import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import type { Scoreboard } from '../../shared/schemas/game'
import GameScoreboard from '../../app/components/game/GameScoreboard.vue'
import { emptyScoreboard } from '../../shared/schemas/game'
import GameCard from '../../app/components/game/GameCard.vue'
import HomeScoreBanner from '../../app/components/home/ScoreBanner.vue'
import GameCalendar from '../../app/components/game/GameCalendar.vue'
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
/**
 * 卡片左側的狀態色條。
 *
 * 首頁的「下一場比賽」本來就用這個手法，賽程／結果的卡片卻只有一圈灰邊 ——
 * 兩種卡片語言擺在同一頁看起來像兩個網站拼起來的。統一之後色條還帶了資訊：
 * 掃過一排卡片就知道哪場贏、哪場輸、哪場還沒打。
 */
describe('GameCard 的狀態色條', () => {
  const base = {
    id: 'g1',
    date: '2026-09-29',
    time: '09:00',
    opponent: '藍鷹隊',
    venue: '',
    mapUrl: '',
    city: '' as const,
    league: '',
    homeAway: 'home' as const,
    note: '',
    coverImageUrl: '',
    opponentLogoUrl: '',
    attendance: [],
    lineup: [],
    pitchers: [],
    scoreboard: emptyScoreboard(0),
    createdAt: '',
    updatedAt: '',
  }

  const mount = (overrides: Record<string, unknown>) =>
    mountSuspended(GameCard, {
      props: {
        game: { ...base, status: 'scheduled', result: null, ...overrides },
        ourName: '城市隊',
        today: '2026-09-22',
      },
    })

  it.each([
    ['未開打', { status: 'scheduled', result: null }, 'border-l-brand-600'],
    ['勝', { status: 'finished', result: 'win' }, 'border-l-accent-500'],
    ['敗', { status: 'finished', result: 'loss' }, 'border-l-danger'],
    ['因雨延賽', { status: 'postponed', result: null }, 'border-l-warning'],
  ])('%s 用對應的顏色', async (_label, overrides, expected) => {
    const component = await mount(overrides)
    expect(component.find('a').classes()).toContain(expected)
  })
})

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

/**
 * 首頁資訊帶的「最新比數」。
 *
 * 這一格最容易出錯的地方是**延賽的場次**：它的計分板是空的，兩邊總分都是 0，
 * 直接畫出來就變成「0 0」—— 看起來像打完了而且是和局。
 */
describe('ScoreBanner 的最新比數', () => {
  const game = {
    id: 'g1',
    date: '2026-09-06',
    time: '08:00',
    opponent: '天行者',
    venue: '',
    mapUrl: '',
    city: '' as const,
    league: '',
    homeAway: 'home' as const,
    note: '',
    coverImageUrl: '',
    opponentLogoUrl: '',
    attendance: [],
    lineup: [],
    pitchers: [],
    scoreboard: {
      innings: [],
      totals: { our: { r: 6, h: 0, e: 0 }, opponent: { r: 3, h: 0, e: 0 } },
    },
    createdAt: '',
    updatedAt: '',
  }

  const mount = (overrides: Record<string, unknown>) =>
    mountSuspended(HomeScoreBanner, {
      props: {
        lastGame: { ...game, status: 'finished', result: 'win', ...overrides },
        upcoming: [],
        teamName: 'HG MERCENARIES',
        teamLogoUrl: '',
      },
    })

  /**
   * 比對「文字裡有沒有冒號」會被時間的 `08:00` 騙到，所以改成找
   * **整個元素剛好只有一個冒號**的那一個 —— 那才是比分中間的分隔。
   */
  const hasScoreSeparator = (component: { findAll: (s: string) => { text: () => string }[] }) =>
    component.findAll('span').some((el) => el.text() === ':')

  it('打完的比賽顯示兩隊比數，中間有分隔的冒號', async () => {
    const component = await mount({})

    // 比分是最大的那兩個數字
    const scores = component.findAll('.text-3xl').map((el) => el.text())
    expect(scores).toContain('6')
    expect(scores).toContain('3')

    // 手機版沒有中間的標題塊，少了冒號就變成「6 3」
    expect(hasScoreSeparator(component)).toBe(true)
  })

  it.each([
    ['因雨延賽', 'postponed'],
    ['取消', 'canceled'],
  ])('%s 的場次把狀態寫出來，不顯示比數', async (label, status) => {
    const component = await mount({ status, result: null })

    expect(component.text()).toContain(label)
    // 這場根本沒打，不該有比分 —— 計分板是空的，畫出來會是「0 0」
    expect(component.findAll('.text-3xl')).toHaveLength(0)
    expect(hasScoreSeparator(component)).toBe(false)
  })
})

/**
 * 比賽月曆。
 *
 * 場次一多，「由新到舊的一長串卡片」就只剩捲動這個找法。月曆的價值在於
 * **有比賽的日子要一眼看得出來、而且點得進去** —— 這兩件事壞了，月曆就只是
 * 一張佔版面的表格。
 */
describe('GameCalendar', () => {
  const game = (id: string, date: string, extra: Record<string, unknown> = {}) => ({
    id,
    date,
    time: '09:00',
    opponent: '藍鷹隊',
    venue: '',
    mapUrl: '',
    city: '' as const,
    league: '',
    homeAway: 'home' as const,
    status: 'finished' as const,
    result: 'win' as const,
    note: '',
    coverImageUrl: '',
    opponentLogoUrl: '',
    attendance: [],
    lineup: [],
    pitchers: [],
    scoreboard: {
      innings: [],
      totals: { our: { r: 6, h: 0, e: 0 }, opponent: { r: 3, h: 0, e: 0 } },
    },
    createdAt: '',
    updatedAt: '',
    ...extra,
  })

  const mount = (games: ReturnType<typeof game>[], month = '2026-09') =>
    mountSuspended(GameCalendar, {
      props: { games, month, availableMonths: ['2026-08', '2026-09'] },
    })

  it('有比賽的日子做成連到那場比賽的連結', async () => {
    const component = await mount([game('g1', '2026-09-16')])
    const links = component.findAll('a')

    expect(links).toHaveLength(1)
    expect(links[0]!.attributes('href')).toBe('/games/g1')
    // 標題要講得出是哪一場，滑鼠停留與螢幕閱讀器都靠它
    expect(links[0]!.attributes('title')).toContain('藍鷹隊')
  })

  it('小圓點的顏色對應結果', async () => {
    const component = await mount([
      game('g1', '2026-09-02', { result: 'loss' }),
      game('g2', '2026-09-09', { status: 'postponed', result: null }),
      game('g3', '2026-09-16', { result: 'win' }),
    ])

    const html = component.html()
    expect(html).toContain('bg-danger')
    expect(html).toContain('bg-warning')
    expect(html).toContain('bg-accent-500')
  })

  it('同一天兩場（雙重賽）會畫兩個點', async () => {
    const component = await mount([game('g1', '2026-09-16'), game('g2', '2026-09-16')])

    const cell = component.find('a')
    expect(cell.findAll('span[class*="rounded-full"]')).toHaveLength(2)
  })

  it('超出可選月份範圍時停用上／下一月', async () => {
    const component = await mount([game('g1', '2026-09-16')], '2026-09')
    const buttons = component.findAll('button')

    const prev = buttons.find((b) => b.attributes('aria-label') === '上一個月')!
    const next = buttons.find((b) => b.attributes('aria-label') === '下一個月')!

    // 9 月是最後一個有比賽的月份，不該再往後
    expect(prev.attributes('disabled')).toBeUndefined()
    expect(next.attributes('disabled')).toBeDefined()
  })

  it('沒有比賽的日子不是連結', async () => {
    const component = await mount([])
    expect(component.findAll('a')).toHaveLength(0)
    // 但月曆本身還在，9 月有 30 天
    expect(component.findAll('.grid-cols-7 > *').length).toBeGreaterThan(30)
  })
})
