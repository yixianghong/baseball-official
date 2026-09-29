// @vitest-environment nuxt
import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import BracketRoster from '../../app/components/bracket/BracketRoster.vue'
import type { Player } from '../../shared/schemas/player'

/**
 * 隊員列的「押滿就收起來」（限期活動，見 docs/ws-bracket.md）。
 *
 * ⚠️ 這是最常見的情況（大多數人一下就是兩注），值得直接擋在起點 ——
 * 而不是每次都要等一次會被安全規則拒絕的嘗試才知道。
 */

function player(id: string, name: string): Player {
  return {
    id,
    number: '1',
    name,
    positions: ['P'],
    bats: 'R',
    throws: 'R',
    joinedYear: null,
    bio: '',
    photoUrl: '',
    status: 'active',
    sortOrder: 0,
    createdAt: '',
    updatedAt: '',
  }
}

describe('BracketRoster', () => {
  it('還沒押滿的人，頭像是有效的按鈕', async () => {
    const wrapper = await mountSuspended(BracketRoster, {
      props: {
        players: [player('a', '葉時安')],
        betCounts: { a: 1 },
        maxBetsPerPlayer: 2,
        selectedId: null,
        disabled: false,
      },
    })

    expect(wrapper.get('button').attributes('disabled')).toBeUndefined()
    expect(wrapper.get('button').attributes('aria-label')).toBe('葉時安，已下 1 注')
  })

  it('⚠️ 押滿之後整個頭像收起來，不是等點完球隊才被拒絕', async () => {
    const wrapper = await mountSuspended(BracketRoster, {
      props: {
        players: [player('a', '葉時安')],
        betCounts: { a: 2 },
        maxBetsPerPlayer: 2,
        selectedId: null,
        disabled: false,
      },
    })

    const button = wrapper.get('button')
    expect(button.attributes('disabled')).toBeDefined()
    expect(button.attributes('aria-label')).toBe('葉時安，已經押滿 2 注')
  })

  it('沒下過注的人不受影響', async () => {
    const wrapper = await mountSuspended(BracketRoster, {
      props: {
        players: [player('a', '葉時安')],
        betCounts: {},
        maxBetsPerPlayer: 2,
        selectedId: null,
        disabled: false,
      },
    })

    expect(wrapper.get('button').attributes('disabled')).toBeUndefined()
  })

  it('點選頭像會送出選取的隊員', async () => {
    const wrapper = await mountSuspended(BracketRoster, {
      props: {
        players: [player('a', '葉時安')],
        betCounts: {},
        maxBetsPerPlayer: 2,
        selectedId: null,
        disabled: false,
      },
    })

    const button = wrapper.get('button')
    await button.trigger('click')
    expect(wrapper.emitted('select')?.[0]).toEqual([
      { playerId: 'a', playerName: '葉時安', playerNumber: '1' },
    ])
  })
})
