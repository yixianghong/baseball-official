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
