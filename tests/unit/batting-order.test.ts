import { describe, expect, it } from 'vitest'
import { battingOrderAt, slotOfBatter } from '../../shared/schemas/batting-order'
import { playSchema, type Play, type PlayResult } from '../../shared/schemas/play'
import type { LineupEntry } from '../../shared/schemas/game'
import type { GameHalf } from '../../shared/schemas/half-inning'

const lineup: LineupEntry[] = [
  { order: 1, playerId: 'p1', name: '一號', number: '1', position: 'CF' },
  { order: 2, playerId: 'p2', name: '二號', number: '2', position: 'SS' },
  { order: 3, playerId: 'p3', name: '三號', number: '3', position: '1B' },
]

/** 主場：下半局是我隊打擊。 */
function ours(
  inning: number,
  slot: number | null,
  result: PlayResult = 'groundout',
  batter?: Play['batter'],
): Play {
  const starter = lineup.find((entry) => entry.order === slot)
  return playSchema.parse({
    inning,
    half: 'bottom' as GameHalf,
    result,
    battingSlot: slot,
    batter: batter ?? {
      playerId: starter?.playerId ?? '',
      name: starter?.name ?? '',
      number: starter?.number ?? '',
    },
  })
}

function at(plays: Play[], inning = 9, half: GameHalf = 'bottom') {
  return battingOrderAt({ plays, homeAway: 'home', lineup }, inning, half)
}

describe('battingOrderAt：輪到第幾棒', () => {
  it('還沒有打席時輪到第一棒', () => {
    expect(at([]).nextSlot).toBe(1)
  })

  it('照棒次往下輪，打完一輪回到第一棒', () => {
    expect(at([ours(1, 1)]).nextSlot).toBe(2)
    expect(at([ours(1, 1), ours(1, 2), ours(1, 3)]).nextSlot).toBe(1)
  })

  it('跑者出局不換打者（打擊區上的人還沒打完）', () => {
    // 這是這個函式存在的主要理由之一 —— 原本輪棒是數「所有紀錄」，
    // 一次牽制出局就讓後面每一棒都錯開
    const plays = [ours(1, 1), ours(1, 2, 'runnerOut')]
    expect(at(plays).nextSlot).toBe(2)
  })

  it('跑者出局造成三出局時，那位打者下一局當首棒', () => {
    const plays = [ours(1, 1, 'strikeout'), ours(1, 2, 'strikeout'), ours(1, 3, 'runnerOut')]
    expect(at(plays, 2, 'bottom').nextSlot).toBe(3)
  })

  it('跨半局延續（打線不是每局從頭開始）', () => {
    expect(at([ours(1, 1), ours(1, 2)], 2, 'bottom').nextSlot).toBe(3)
  })

  it('回頭修改前面的半局時，不把後面半局的打席算進來', () => {
    // 否則回到第 1 局下，畫面上輪到的會是第 3 局之後的打者
    const plays = [ours(1, 1), ours(1, 2), ours(3, 3), ours(3, 1)]
    expect(at(plays, 1, 'bottom').nextSlot).toBe(3)
  })

  it('跳棒之後從跳到的那一棒往下（修正打錯棒次用）', () => {
    expect(at([ours(1, 1), ours(1, 3)]).nextSlot).toBe(1)
  })

  it('舊資料沒有記棒次時退回數打席', () => {
    expect(at([ours(1, null), ours(1, null)]).nextSlot).toBe(3)
  })

  it('對手打擊的半局沒有輪棒', () => {
    expect(at([], 1, 'top').nextSlot).toBeNull()
  })

  it('打線是空的時候沒有輪棒', () => {
    expect(
      battingOrderAt({ plays: [], homeAway: 'home', lineup: [] }, 1, 'bottom').nextSlot,
    ).toBeNull()
  })
})

describe('battingOrderAt：代打', () => {
  const pinch = { playerId: 'p9', name: '代打王', number: '31' }

  it('代打之後那一棒換人，而且之後一直是他', () => {
    const plays = [ours(1, 1), ours(1, 2, 'single', pinch), ours(1, 3)]
    const state = at(plays, 5, 'bottom')
    const second = state.slots.find((slot) => slot.slot === 2)!

    expect(second.current).toEqual(pinch)
    expect(second.substituted).toBe(true)
    // 賽前名單上的先發不變（出賽名單圖卡印的是它）
    expect(second.starter.name).toBe('二號')
  })

  it('代打之前的半局看到的還是先發', () => {
    const plays = [ours(1, 1), ours(3, 2, 'single', pinch)]
    const second = at(plays, 1, 'bottom').slots.find((slot) => slot.slot === 2)!
    expect(second.current.name).toBe('二號')
    expect(second.substituted).toBe(false)
  })

  it('先發再度上場（業餘聯賽常見的重新上場規則）就不算代打', () => {
    const back = { playerId: 'p2', name: '二號', number: '2' }
    const plays = [ours(1, 2, 'single', pinch), ours(3, 2, 'single', back)]
    const second = at(plays).slots.find((slot) => slot.slot === 2)!
    expect(second.substituted).toBe(false)
  })

  it('slotOfBatter 找得到代打的人站第幾棒', () => {
    const state = at([ours(1, 2, 'single', pinch)])
    expect(slotOfBatter(state.slots, pinch)).toBe(2)
    expect(slotOfBatter(state.slots, { playerId: '', name: '', number: '3' })).toBe(3)
    expect(slotOfBatter(state.slots, { playerId: '', name: '', number: '77' })).toBeNull()
  })
})
