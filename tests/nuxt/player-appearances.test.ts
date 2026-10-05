// @vitest-environment nuxt
import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import PlayerPage from '../../app/pages/players/[id].vue'
import type { Game, GameStatus } from '../../shared/schemas/game'

/**
 * 球員頁的「出賽紀錄」。
 *
 * ⚠️ **沒有打成的場次（延賽、取消）不能列在裡面。** 打線是**賽前**排的，
 * 所以延賽的那一場照樣有他的名字，而 `scope: 'past'` 只看日期、照樣會抓到。
 * 不排掉的話「共 12 場」裡會混著幾場根本沒打的，而畫面上完全看不出來 ——
 * 那一列和真的出賽過的長得一模一樣。
 */

const PLAYER_ID = 'p1'

function game(id: string, status: GameStatus, opponent: string): Game {
  return {
    id,
    date: '2026-09-01',
    time: '09:00',
    opponent,
    venue: '',
    mapUrl: '',
    city: '',
    league: '',
    homeAway: 'home',
    status,
    note: '',
    coverImageUrl: '',
    opponentLogoUrl: '',
    attendanceLockAt: '',
    narratives: [],
    remindersSent: [],
    clips: [],
    plays: [],
    attendance: [],
    lineup: [{ order: 1, playerId: PLAYER_ID, name: '王大明', number: '1', position: 'SS' }],
    startingPitcher: null,
    scoreboard: {
      innings: [],
      totals: { our: { r: 0, h: 0, e: 0 }, opponent: { r: 0, h: 0, e: 0 } },
    },
    createdAt: '',
    updatedAt: '',
  } as Game
}

const games = ref<Game[]>([])

mockNuxtImport('useGames', () => () => ({ data: games }))
mockNuxtImport('usePlayer', () => () => ({
  data: ref({
    id: PLAYER_ID,
    name: '王大明',
    number: '1',
    positions: ['SS'],
    throws: 'R',
    bats: 'R',
    status: 'active',
    bio: '',
    photoUrl: '',
    createdAt: '',
    updatedAt: '',
  }),
  error: ref(null),
}))

mockNuxtImport('useRoute', () => () => ({ params: { id: PLAYER_ID } }))

describe('球員頁的出賽紀錄', () => {
  it('列出打完的場次', async () => {
    games.value = [game('g1', 'finished', '藍鷹隊')]
    const component = await mountSuspended(PlayerPage)

    expect(component.text()).toContain('藍鷹隊')
    expect(component.text()).toContain('共 1 場')
  })

  it.each([
    ['延賽', 'postponed' as const],
    ['取消', 'canceled' as const],
  ])('⚠️ %s的場次不列入（打線是賽前排的，那一場照樣有他的名字）', async (_label, status) => {
    games.value = [game('g1', 'finished', '藍鷹隊'), game('g2', status, '沒打成隊')]
    const component = await mountSuspended(PlayerPage)

    expect(component.text()).not.toContain('沒打成隊')
    expect(component.text()).toContain('共 1 場')
  })

  it('全部都沒打成時顯示「還沒有出賽紀錄」', async () => {
    games.value = [game('g1', 'postponed', '沒打成隊')]
    const component = await mountSuspended(PlayerPage)

    expect(component.text()).toContain('還沒有出賽紀錄')
  })
})
