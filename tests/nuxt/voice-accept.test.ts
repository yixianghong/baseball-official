// @vitest-environment nuxt
import { describe, expect, it } from 'vitest'
import { ref, computed } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import InningEditor from '../../app/components/admin/InningEditor.vue'
import { parsedPlaySchema, type ParsedPlay } from '../../shared/schemas/ai'
import { playSchema, type Play } from '../../shared/schemas/play'
import type { LineupEntry } from '../../shared/schemas/game'
import type { Player } from '../../shared/schemas/player'

/**
 * 語音辨識結果「全部採用」之後寫進去的打席。
 *
 * 辨識本身（錄音、Gemini）在這裡測不到，所以把 `useVoicePlayInput` 換成一個
 * 可以直接塞建議的假物件 —— 守的是「沒講的欄位（null）採用時怎麼補」這一段，
 * 那是語音登錄和手動登錄會不會長得一樣的地方。
 */

const suggestions = ref<ParsedPlay[]>([])

mockNuxtImport('useVoicePlayInput', () => () => ({
  status: ref('idle'),
  error: ref(''),
  suggestions,
  transcript: ref(''),
  warnings: ref<string[]>([]),
  supported: computed(() => true),
  start: async () => {},
  stop: async () => {},
  clear: () => (suggestions.value = []),
}))

const lineup: LineupEntry[] = [
  { order: 1, playerId: 'p4', name: '張志豪', number: '24', position: '2B' },
  { order: 2, playerId: 'p5', name: '李承翰', number: '9', position: 'SS' },
]

function suggestion(overrides: Record<string, unknown>): ParsedPlay {
  return parsedPlaySchema.parse({ batter: {}, confidence: 0.9, ...overrides })
}

async function mount(plays: Play[] = []) {
  const component = await mountSuspended(InningEditor, {
    props: {
      plays,
      homeAway: 'home' as const,
      lineup,
      startingPitcher: { playerId: 'p1', name: '陳冠宇', number: '1' },
      // 只放這些測試用得到的欄位
      players: [
        { id: 'p4', name: '張志豪', number: '24', bats: 'L' },
        { id: 'p5', name: '李承翰', number: '9', bats: 'S' },
      ] as unknown as Player[],
      clips: [],
      scoreboard: {
        innings: [{ inning: 1, our: null, opponent: null }],
        totals: { our: { r: 0, h: 0, e: 0 }, opponent: { r: 0, h: 0, e: 0 } },
      },
      ourName: '城市隊',
      opponentName: '藍鷹隊',
    },
  })
  // 1 下：主場 → 我隊打擊
  await component.findAll('[aria-label="半局"] [role="tab"]')[1]?.trigger('click')
  return component
}

function acceptButton(component: Awaited<ReturnType<typeof mount>>) {
  return component.findAll('button').find((button) => button.text() === '全部採用')
}

describe('語音登錄：常駐在頁面上', () => {
  it('不用展開就看得到語音按鈕', async () => {
    suggestions.value = []
    const component = await mount()
    expect(component.find('[aria-label="語音登錄"]').exists()).toBe(true)
    expect(component.text()).toContain('按住說話')
  })
})

describe('語音登錄：採用時補上沒講到的欄位', () => {
  it('只講「24 號三壘安打」：得分與打點依結果補、落點與類型留空、左右打與棒次照名冊與打線', async () => {
    suggestions.value = [
      suggestion({
        batter: { playerId: 'p4', name: '張志豪', number: '24' },
        result: 'triple',
        sourceText: '24號三壘安打',
      }),
    ]
    const component = await mount()
    await acceptButton(component)?.trigger('click')

    expect(component.emitted('save')?.[0]?.[2]).toMatchObject([
      {
        result: 'triple',
        batter: { playerId: 'p4', number: '24' },
        runs: 0,
        rbi: 0,
        location: null,
        fielder: null,
        batted: null,
        bats: 'L',
        battingSlot: 1,
        transcript: '24號三壘安打',
      },
    ])
  })

  it('講到的欄位照講的存：守備位置、擊球類型、得分、打點', async () => {
    suggestions.value = [
      suggestion({
        batter: { playerId: 'p4', name: '張志豪', number: '24' },
        result: 'single',
        batted: 'line',
        runs: 2,
        rbi: 1,
      }),
    ]
    const component = await mount()
    await acceptButton(component)?.trigger('click')
    expect(component.emitted('save')?.[0]?.[2]).toMatchObject([
      { result: 'single', batted: 'line', runs: 2, rbi: 1 },
    ])
  })

  it('全壘打沒講得分時是 1 分（打者自己回來）', async () => {
    suggestions.value = [
      suggestion({ batter: { playerId: 'p4', number: '24' }, result: 'homerun' }),
    ]
    const component = await mount()
    await acceptButton(component)?.trigger('click')
    expect(component.emitted('save')?.[0]?.[2]).toMatchObject([{ runs: 1, rbi: 1 }])
  })

  it('左右開弓的打者語音沒講站哪邊時不記（不猜）', async () => {
    suggestions.value = [
      suggestion({ batter: { playerId: 'p5', number: '9' }, result: 'strikeout' }),
    ]
    const component = await mount()
    await acceptButton(component)?.trigger('click')
    expect(component.emitted('save')?.[0]?.[2]).toMatchObject([{ bats: null, battingSlot: 2 }])
  })
})

describe('語音登錄：有問題的建議不能採用', () => {
  it('聽不出結果的那一筆要先刪掉', async () => {
    suggestions.value = [
      suggestion({ batter: { number: '24' }, result: 'single' }),
      suggestion({ batter: { number: '9' }, result: null }),
    ]
    const component = await mount()

    expect(component.text()).toContain('聽不出結果')
    expect(acceptButton(component)?.attributes('disabled')).toBeDefined()

    // 刪掉聽不出結果的那一筆（第二筆），剩下的就可以採用
    await component.findAll('button[aria-label^="不要這一筆"]')[1]!.trigger('click')
    expect(acceptButton(component)?.attributes('disabled')).toBeUndefined()
  })

  it('採用之後會超過三出局時不能採用', async () => {
    const twoOuts = [
      playSchema.parse({ inning: 1, half: 'bottom', result: 'strikeout', battingSlot: 1 }),
      playSchema.parse({ inning: 1, half: 'bottom', result: 'strikeout', battingSlot: 2 }),
    ]
    suggestions.value = [suggestion({ batter: { number: '24' }, result: 'doublePlay' })]
    const component = await mount(twoOuts)

    expect(component.text()).toContain('只剩 1 個')
    expect(acceptButton(component)?.attributes('disabled')).toBeDefined()
  })
})
