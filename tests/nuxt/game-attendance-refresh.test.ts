// @vitest-environment nuxt
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import GamePage from '../../app/pages/games/[id].vue'
import type { AttendanceEntry, Game, GameStatus } from '../../shared/schemas/game'

/**
 * 整頁載入時補抓一次出席名單。
 *
 * ⚠️ 這一頁的 HTML 走 CDN（`s-maxage=60, stale-while-revalidate=600`），所以
 * 重新載入拿到的名單最舊可以到 11 分鐘前。對計分板、打線沒差，但出席是
 * **隊員自己按、而且會立刻回頭確認**的東西。
 *
 * 線上實際發生過（2026-10-05）：一位隊員對同一場按了九次 `yes`，九次都成功
 * 寫進資料庫，而他每次重新載入看到的都是 CDN 上那份舊的。
 */

function entry(name: string, status: AttendanceEntry['status']): AttendanceEntry {
  return { playerId: `p-${name}`, name, number: '1', status, note: '' }
}

function game(status: GameStatus, attendance: AttendanceEntry[]): Game {
  return {
    id: 'g1',
    date: '2026-12-01',
    time: '09:00',
    opponent: '藍鷹隊',
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
    attendance,
    lineup: [],
    startingPitcher: null,
    scoreboard: {
      innings: [],
      totals: { our: { r: 0, h: 0, e: 0 }, opponent: { r: 0, h: 0, e: 0 } },
    },
    createdAt: '',
    updatedAt: '',
  } as Game
}

/** SSR payload（可能是 CDN 上的舊資料）。 */
const cached = ref<Game>(game('scheduled', [entry('王大明', 'pending')]))
const fetchGame = vi.fn()
mockNuxtImport('useGame', () => () => ({ data: cached, error: ref(null), refresh: vi.fn() }))
mockNuxtImport('useGameActions', () => () => ({ fetchGame }))
mockNuxtImport('useRoute', () => () => ({ params: { id: 'g1' } }))
mockNuxtImport('useSiteSettings', () => () => ({ data: ref({ teamName: '城市隊' }) }))
mockNuxtImport('useGameWeather', () => () => ({ data: ref(null) }))

beforeEach(() => {
  fetchGame.mockReset()
  cached.value = game('scheduled', [entry('王大明', 'pending')])
})

describe('比賽頁載入時補抓出席', () => {
  it('⚠️ 載入時補抓一次，畫面用新的那一份', async () => {
    fetchGame.mockResolvedValue(game('scheduled', [entry('王大明', 'yes')]))
    const component = await mountSuspended(GamePage)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(fetchGame).toHaveBeenCalledWith('g1')
    expect(component.text()).toContain('目前確定出席 1')
  })

  it('已經開打的場次不補抓 —— 那份名單是歷史紀錄', async () => {
    cached.value = game('finished', [entry('王大明', 'pending')])
    await mountSuspended(GamePage)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(fetchGame).not.toHaveBeenCalled()
  })

  it('⚠️ 補抓失敗就沿用舊的那一份，不讓整頁壞掉', async () => {
    fetchGame.mockRejectedValue(new Error('網路斷了'))
    const component = await mountSuspended(GamePage)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(component.text()).toContain('王大明')
    expect(component.text()).not.toContain('網路斷了')
  })
})
