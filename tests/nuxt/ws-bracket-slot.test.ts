// @vitest-environment nuxt
import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import BracketSlot from '../../app/components/bracket/BracketSlot.vue'
import BracketWinner from '../../app/components/bracket/BracketWinner.vue'
import { buildBracket, tallyBets, type WsBet } from '../../shared/schemas/ws-bracket'
import { TEAM_SLOTS } from '../../app/utils/ws-bracket-layout'

/**
 * 「預測世界大賽冠軍」的兩個格子（限期活動，見 docs/ws-bracket.md）。
 *
 * 守的是三件在畫面上會安靜地出錯的事：
 * 1. 已淘汰的球隊不能再當落點（`data-bet-disabled`）。
 * 2. **已經晉級但沒有隊徽檔的球隊不能畫成「?」** —— 那看起來像還沒打完，
 *    而底下那行「多倫多藍鳥 4–3 晉級」就跟菱形自相矛盾。
 * 3. 下注的頭像真的長在格子上，超過四個收成「+N」。
 */

const HOU = 117
const CWS = 145
/** 沒有隊徽檔的球隊（隊徽只有今年進季後賽的十二支有）。 */
const TOR = 141
const SEA = 136

function finishedWildCard(winnerId: number, loserId: number) {
  return buildBracket(
    {
      series: [
        {
          series: { id: 'F_1' },
          games: [1, 2].map((n) => ({
            seriesGameNumber: n,
            status: { abstractGameState: 'Final' },
            teams: {
              home: { team: { id: winnerId }, isWinner: true },
              away: { team: { id: loserId }, isWinner: false },
            },
          })),
        },
      ],
    },
    '2026-10-05T00:00:00.000Z',
  )
}

const slotSpot = TEAM_SLOTS.find((s) => s.key === 'F_1:1')!

describe('BracketSlot', () => {
  const bracket = finishedWildCard(HOU, CWS)

  it('活著的球隊是有效的落點', async () => {
    const wrapper = await mountSuspended(BracketSlot, {
      props: {
        spot: TEAM_SLOTS.find((s) => s.key === 'F_1:0')!,
        side: bracket.series.F_1.sides[0],
        standing: 'alive',
        tally: undefined,
        photos: {},
        active: false,
        armed: false,
        locked: false,
      },
    })

    const button = wrapper.get('button')
    expect(button.attributes('data-bet-team')).toBe('HOU')
    expect(button.attributes('data-bet-disabled')).toBe('false')
  })

  it('⚠️ 鎖盤之後整格不再是落點', () => {
    // data-bet-disabled 是拖曳判斷（elementFromPoint）唯一看的東西。
    // 漏了 locked 的話，鎖盤之後拖上去仍然會亮起來、放開才失敗 ——
    // 而失敗訊息來自安全規則，寫的是英文的 PERMISSION_DENIED。
    return mountSuspended(BracketSlot, {
      props: {
        spot: TEAM_SLOTS.find((s) => s.key === 'F_1:0')!,
        side: bracket.series.F_1.sides[0],
        standing: 'alive',
        tally: undefined,
        photos: {},
        active: false,
        armed: false,
        locked: true,
      },
    }).then((wrapper) => {
      const button = wrapper.get('button')
      expect(button.attributes('data-bet-disabled')).toBe('true')
      expect(button.attributes('disabled')).toBeDefined()
    })
  })

  it('已淘汰的球隊不能再當落點，也按不下去', async () => {
    const wrapper = await mountSuspended(BracketSlot, {
      props: {
        spot: slotSpot,
        side: bracket.series.F_1.sides[1],
        standing: 'eliminated',
        tally: undefined,
        photos: {},
        active: false,
        armed: false,
        locked: false,
      },
    })

    const button = wrapper.get('button')
    expect(button.attributes('data-bet-disabled')).toBe('true')
    expect(button.attributes('disabled')).toBeDefined()
  })

  it('下注的頭像超過四個就收成「+N」', async () => {
    const bets: WsBet[] = Array.from({ length: 6 }, (_, i) => ({
      id: `p${i}/slot1`,
      slot: 'slot1',
      playerId: `p${i}`,
      playerName: `球員${i}`,
      playerNumber: String(i),
      team: 'HOU',
      createdAt: i,
    }))

    const wrapper = await mountSuspended(BracketSlot, {
      props: {
        spot: TEAM_SLOTS.find((s) => s.key === 'F_1:0')!,
        side: bracket.series.F_1.sides[0],
        standing: 'alive',
        tally: tallyBets(bets).byTeam.HOU,
        photos: {},
        active: false,
        armed: false,
        locked: false,
      },
    })

    expect(wrapper.findAllComponents({ name: 'BracketAvatar' })).toHaveLength(4)
    expect(wrapper.text()).toContain('+2')
  })
})

describe('BracketWinner', () => {
  it('還沒分出勝負時是「?」', async () => {
    const bracket = buildBracket(null, '2026-10-05T00:00:00.000Z')
    const wrapper = await mountSuspended(BracketWinner, {
      props: { series: bracket.series.F_1, cx: 100, cy: 100, size: 68 },
    })

    expect(wrapper.text()).toContain('?')
  })

  it('⚠️ 已經晉級但沒有隊徽檔時寫代碼，不是退回「?」', async () => {
    const bracket = finishedWildCard(TOR, SEA)
    const wrapper = await mountSuspended(BracketWinner, {
      props: { series: bracket.series.F_1, cx: 100, cy: 100, size: 68 },
    })

    expect(wrapper.text()).toContain('TOR')
    expect(wrapper.text()).not.toContain('?')
    // 底下那行說明必須和菱形講同一件事
    expect(wrapper.text()).toContain('多倫多藍鳥 2–0 晉級')
  })

  it('有隊徽時畫隊徽', async () => {
    const bracket = finishedWildCard(HOU, CWS)
    const wrapper = await mountSuspended(BracketWinner, {
      props: { series: bracket.series.F_1, cx: 100, cy: 100, size: 68 },
    })

    expect(wrapper.get('img').attributes('alt')).toBe('休士頓太空人')
    expect(wrapper.text()).not.toContain('?')
  })
})
