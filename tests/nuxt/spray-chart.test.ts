// @vitest-environment nuxt
import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import GameSprayChart from '../../app/components/game/GameSprayChart.vue'
import { playSchema, type Play } from '../../shared/schemas/play'

function play(overrides: Record<string, unknown>): Play {
  return playSchema.parse({ inning: 1, half: 'bottom', result: 'single', ...overrides })
}

function mount(plays: Play[]) {
  return mountSuspended(GameSprayChart, {
    // 主場 → 下半局是我隊打擊
    props: { plays, homeAway: 'home', ourName: '城市隊', opponentName: '藍鷹隊' },
  })
}

describe('GameSprayChart', () => {
  it('整場沒有任何落點時整塊不出現', async () => {
    // 用按鈕或語音登錄的場次沒有落點 —— 畫一張空球場只會讓人以為壞了
    const component = await mount([play({ result: 'strikeout' }), play({})])
    expect(component.text()).toBe('')
  })

  it('預設畫我隊的落點，切換後畫對手的', async () => {
    const component = await mount([
      play({ location: { x: 0, y: 0.6 } }),
      play({ location: { x: 0.1, y: 0.7 } }),
      play({ half: 'top', location: { x: -0.3, y: 0.5 } }),
    ])
    expect(component.findAll('title')).toHaveLength(2)

    await component.findAll('[role="tab"]')[1]?.trigger('click')
    expect(component.findAll('title')).toHaveLength(1)
  })

  it('說得出幾個打席裡有幾個記了落點', async () => {
    // 少了這一句，一張只登了兩個落點的圖看起來就像那一場只打了兩球
    const component = await mount([
      play({ location: { x: 0, y: 0.6 } }),
      play({ result: 'strikeout' }),
      play({ result: 'walk' }),
    ])
    expect(component.text()).toContain('3 個打席裡有 1 個記了落點')
  })

  it('跑者出局不算打席', async () => {
    const component = await mount([
      play({ location: { x: 0, y: 0.6 } }),
      play({ result: 'runnerOut' }),
    ])
    expect(component.text()).toContain('1 個打席裡有 1 個記了落點')
  })
})

describe('只看某一位打者', () => {
  const dots = (component: Awaited<ReturnType<typeof mount>>) =>
    component.findAllComponents({ name: 'GameSprayMarker' }).length

  /** 我隊打下半局（主場）。三個打者各一個落點，其中 #24 有兩個。 */
  const plays = () => [
    play({ batter: { playerId: 'p1', name: '張志豪', number: '24' }, location: { x: 0, y: 0.6 } }),
    play({
      batter: { playerId: 'p1', name: '張志豪', number: '24' },
      location: { x: 0.2, y: 0.5 },
    }),
    play({
      batter: { playerId: 'p2', name: '李承翰', number: '9' },
      location: { x: -0.3, y: 0.7 },
    }),
    // 三振沒有落點，不該出現在選單裡
    play({ batter: { playerId: 'p3', name: '王柏翔', number: '5' }, result: 'strikeout' }),
  ]

  it('選單只列有落點的打者，而且帶著點數', async () => {
    const component = await mount(plays())
    const labels = component.findAll('option').map((option) => option.text())

    expect(labels).toEqual(['全部打者（2 位）', '#24 張志豪（2）', '#9 李承翰（1）'])
    // ⚠️ 三振的那位不在裡面：列出來卻一個點都沒有，使用者會以為圖壞了
    expect(labels.join()).not.toContain('王柏翔')
  })

  it('選了之後只畫那一位的落點', async () => {
    const component = await mount(plays())
    expect(dots(component)).toBe(3)

    await component.find('select').setValue('p1')
    expect(dots(component)).toBe(2)
  })

  /**
   * ⚠️ 對手沒有名冊，打席上只有背號 —— 所有對手打者的 `playerId` 都是空字串。
   * 只比對它的話整隊會被併成同一個「打者」，而圖上看起來完全正常（點都在），
   * 只是那是全隊的點。
   */
  it('對手用背號分得開（他們沒有 playerId）', async () => {
    const component = await mount([
      play({ half: 'top', batter: { number: '7' }, location: { x: 0, y: 0.6 } }),
      play({ half: 'top', batter: { number: '7' }, location: { x: 0.1, y: 0.6 } }),
      play({ half: 'top', batter: { number: '8' }, location: { x: -0.2, y: 0.5 } }),
    ])

    await component.findAll('[role="tab"]')[1]!.trigger('click')
    expect(component.findAll('option').map((option) => option.text())).toEqual([
      '全部打者（2 位）',
      '#7（2）',
      '#8（1）',
    ])

    await component.find('select').setValue('7')
    expect(dots(component)).toBe(2)
  })

  it('換一隊就把打者的選擇清掉（兩隊的背號是各自的）', async () => {
    const component = await mount([
      ...plays(),
      play({ half: 'top', batter: { number: '7' }, location: { x: 0, y: 0.6 } }),
      play({ half: 'top', batter: { number: '8' }, location: { x: 0.1, y: 0.6 } }),
    ])

    await component.find('select').setValue('p1')
    expect(dots(component)).toBe(2)

    await component.findAll('[role="tab"]')[1]!.trigger('click')
    // 沒清掉的話 p1 對不到任何對手打者，圖會是空的
    expect(dots(component)).toBe(2)
  })

  it('只有一位打者時不顯示選單（只有一個選項的選單是噪音）', async () => {
    const component = await mount([
      play({
        batter: { playerId: 'p1', name: '張志豪', number: '24' },
        location: { x: 0, y: 0.6 },
      }),
    ])

    expect(component.find('select').exists()).toBe(false)
  })
})
