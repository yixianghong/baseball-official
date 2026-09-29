// @vitest-environment nuxt
import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import type { HomeAway, Scoreboard } from '../../shared/schemas/game'
import ScoreboardEditor from '../../app/components/admin/ScoreboardEditor.vue'
import GameScoreboard from '../../app/components/game/GameScoreboard.vue'

/**
 * 計分板的列順序。
 *
 * **上面那列是先攻（客隊）。** 後台的編輯器原本寫死「我隊在上」，於是主場的
 * 比賽在後台是「我隊／對手」、在前台是「對手／我隊」—— 而計分板正是拿來
 * 核對的東西，順序相反看起來就像資料被改過。
 *
 * 所以這裡不只各自測順序，還直接比對「兩個元件排出來的是不是同一個順序」：
 * 那才是真正要守住的條件。
 */

const scoreboard: Scoreboard = {
  innings: [
    { inning: 1, our: 2, opponent: 0 },
    { inning: 2, our: 1, opponent: 3 },
  ],
  totals: { our: { r: 3, h: 5, e: 1 }, opponent: { r: 3, h: 7, e: 0 } },
}

async function editorRows(homeAway: HomeAway) {
  const component = await mountSuspended(ScoreboardEditor, {
    props: {
      modelValue: scoreboard,
      'onUpdate:modelValue': () => {},
      ourName: '城市隊',
      opponentName: '藍鷹隊',
      homeAway,
      teamNames: ['城市隊'],
    },
  })
  return component.findAll('tbody th').map((th) => th.text())
}

async function publicRows(homeAway: HomeAway) {
  const component = await mountSuspended(GameScoreboard, {
    props: { scoreboard, homeAway, ourName: '城市隊', opponentName: '藍鷹隊' },
  })
  return component.findAll('tbody th').map((th) => th.text())
}

describe('AdminScoreboardEditor 的列順序', () => {
  it('客場（先攻）時我隊在上', async () => {
    expect(await editorRows('away')).toEqual(['城市隊', '藍鷹隊'])
  })

  it('主場（後攻）時對手在上', async () => {
    expect(await editorRows('home')).toEqual(['藍鷹隊', '城市隊'])
  })

  it.each(['home', 'away'] as const)('和前台計分板的順序一致（%s）', async (homeAway) => {
    expect(await editorRows(homeAway)).toEqual(await publicRows(homeAway))
  })
})

describe('AdminScoreboardEditor 的 H／E', () => {
  async function mountWith(derivedTotals?: Record<'our' | 'opponent', { h?: number; e?: number }>) {
    return mountSuspended(ScoreboardEditor, {
      props: {
        modelValue: scoreboard,
        'onUpdate:modelValue': () => {},
        ourName: '城市隊',
        opponentName: '藍鷹隊',
        homeAway: 'home' as HomeAway,
        teamNames: ['城市隊'],
        derivedTotals,
      },
    })
  }

  it('沒有逐打席時 H／E 照樣可以手填', async () => {
    const component = await mountWith()
    expect(component.find('input[aria-label="城市隊 安打數"]').exists()).toBe(true)
    expect(component.find('input[aria-label="城市隊 失誤數"]').exists()).toBe(true)
  })

  it('推導的那幾格是唯讀的，顯示推導出來的值（不是表單裡的舊值）', async () => {
    const component = await mountWith({ our: { h: 8 }, opponent: { e: 2 } })

    expect(component.find('input[aria-label="城市隊 安打數"]').exists()).toBe(false)
    expect(component.find('[aria-label="城市隊 安打數（由逐打席推導）"]').text()).toBe('8')
    expect(component.find('[aria-label="藍鷹隊 失誤數（由逐打席推導）"]').text()).toBe('2')

    // 沒有推導的欄位維持可以輸入
    expect(component.find('input[aria-label="城市隊 失誤數"]').exists()).toBe(true)
    expect(component.find('input[aria-label="藍鷹隊 安打數"]').exists()).toBe(true)
  })

  it('有推導的欄位時會說明原因', async () => {
    const component = await mountWith({ our: { h: 8 }, opponent: {} })
    expect(component.text()).toContain('E 只算得到「失誤上壘」')
  })
})
