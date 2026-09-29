import { describe, expect, it } from 'vitest'
import {
  adjustRuns,
  clampRbi,
  COMMON_PLAY_RESULTS,
  defaultRbi,
  defaultRuns,
  describeBatter,
  describeHalfInning,
  halfInningHits,
  halfInningOuts,
  halfInningRuns,
  halfInningStatus,
  PLAY_RESULTS,
  playResultSchema,
  playSchema,
  playsOf,
  replaceHalfInning,
  sortPlays,
  type Play,
  type PlayResult,
} from '../../shared/schemas/play'

/** 建一筆打席。只有 `result` 是必填，其餘給一組不影響判斷的預設值。 */
function play(result: PlayResult, overrides: Partial<Play> = {}): Play {
  return playSchema.parse({
    inning: 1,
    half: 'top',
    batter: { playerId: 'p1', name: '張志豪', number: '7' },
    result,
    ...overrides,
  })
}

describe('PLAY_RESULTS（結果屬性表）', () => {
  it('每一個結果都有一組完整的屬性', () => {
    for (const result of playResultSchema.options) {
      const meta = PLAY_RESULTS[result]
      expect(meta, result).toBeDefined()
      expect(meta.label.length, result).toBeGreaterThan(0)
      expect(meta.short.length, result).toBeGreaterThan(0)
    }
  })

  it('安打才有壘打數，壘打數和安打種類對得起來', () => {
    expect(PLAY_RESULTS.single.bases).toBe(1)
    expect(PLAY_RESULTS.double.bases).toBe(2)
    expect(PLAY_RESULTS.triple.bases).toBe(3)
    expect(PLAY_RESULTS.homerun.bases).toBe(4)

    for (const result of playResultSchema.options) {
      const meta = PLAY_RESULTS[result]
      if (!meta.hit) expect(meta.bases, result).toBe(0)
    }
  })

  it('保送、觸身與犧牲打不算打數（這是打擊率會不會被灌水的關鍵）', () => {
    expect(PLAY_RESULTS.walk.atBat).toBe(false)
    expect(PLAY_RESULTS.hitByPitch.atBat).toBe(false)
    expect(PLAY_RESULTS.sacrificeFly.atBat).toBe(false)
    expect(PLAY_RESULTS.sacrificeBunt.atBat).toBe(false)
  })

  it('野手選擇與失誤上壘算打數，但不算安打', () => {
    for (const result of ['fieldersChoice', 'reachedOnError'] as const) {
      expect(PLAY_RESULTS[result].atBat, result).toBe(true)
      expect(PLAY_RESULTS[result].hit, result).toBe(false)
    }
  })

  it('野手選擇算一個出局，失誤上壘不算', () => {
    // 野選的定義就是「守方選擇去刺殺跑者、讓打者上壘」—— 打者安全，
    // 但有一個跑者出局。記成 0 的話那個半局永遠滿不了三出局，
    // 整場就會被判成登錄不完整
    expect(PLAY_RESULTS.fieldersChoice.outs).toBe(1)
    expect(PLAY_RESULTS.reachedOnError.outs).toBe(0)
  })

  it('雙殺打吃掉兩個出局、三殺打吃掉三個', () => {
    expect(PLAY_RESULTS.doublePlay.outs).toBe(2)
    expect(PLAY_RESULTS.triplePlay.outs).toBe(3)
  })

  it('犧牲打製造一個出局（它是「用出局換分數」，不是白白多一個人上壘）', () => {
    expect(PLAY_RESULTS.sacrificeFly.outs).toBe(1)
    expect(PLAY_RESULTS.sacrificeBunt.outs).toBe(1)
  })

  it('跑者出局算出局，但不是一個打席', () => {
    // 盜壘失敗與牽制出局發生在打席「之間」—— 那個打者稍後還是會打完
    // 他真正的那一個打席。算成打席的話他會憑空多一個打席數。
    expect(PLAY_RESULTS.runnerOut.outs).toBe(1)
    expect(PLAY_RESULTS.runnerOut.plateAppearance).toBe(false)
    expect(PLAY_RESULTS.runnerOut.atBat).toBe(false)
  })

  it('「三振」不會被當成「三壘安打」的別名', () => {
    // 這兩個詞在中文語音辨識裡最容易混，而搞錯的後果是一次出局變成一支
    // 三壘安打 —— 得分、出局數、打擊率會一起錯掉
    expect(PLAY_RESULTS.triple.aliases).not.toContain('三振')
    expect(PLAY_RESULTS.strikeout.aliases).not.toContain('三壘安打')
    expect(PLAY_RESULTS.strikeout.aliases).not.toContain('三安')
  })

  it('常用的八顆快捷鍵都是合法的結果', () => {
    for (const result of COMMON_PLAY_RESULTS) {
      expect(PLAY_RESULTS[result], result).toBeDefined()
    }
    expect(COMMON_PLAY_RESULTS).toHaveLength(8)
  })
})

describe('半局的加總', () => {
  it('出局數是依結果加總的，不是打席數', () => {
    const plays = [play('strikeout'), play('doublePlay')]
    expect(plays).toHaveLength(2)
    expect(halfInningOuts(plays)).toBe(3)
  })

  it('得分與安打數各自加總', () => {
    const plays = [
      play('single'),
      play('double', { runs: 2, rbi: 2 }),
      play('walk'),
      play('strikeout'),
    ]
    expect(halfInningRuns(plays)).toBe(2)
    expect(halfInningHits(plays)).toBe(2)
  })
})

describe('halfInningStatus（這半局登錄到什麼程度）', () => {
  it('沒有打席是 empty', () => {
    expect(halfInningStatus([])).toBe('empty')
  })

  it('還沒三出局是 partial', () => {
    expect(halfInningStatus([play('strikeout'), play('single')])).toBe('partial')
  })

  it('三出局是 complete', () => {
    expect(halfInningStatus([play('strikeout'), play('groundout'), play('flyout')])).toBe(
      'complete',
    )
  })

  it('雙殺讓出局數超過三也算 complete', () => {
    // `=== 3` 的話，一出局後打成雙殺（共 3 出局）沒問題，但兩出局後
    // 又來一個雙殺（4 出局）會被判成「還沒登錄完」
    expect(halfInningStatus([play('strikeout'), play('groundout'), play('doublePlay')])).toBe(
      'complete',
    )
  })
})

describe('playsOf / sortPlays / replaceHalfInning', () => {
  const plays = [
    play('single', { inning: 2, half: 'top' }),
    play('walk', { inning: 1, half: 'bottom' }),
    play('strikeout', { inning: 1, half: 'top' }),
  ]

  it('篩出指定的半局', () => {
    expect(playsOf(plays, 1, 'top').map((p) => p.result)).toEqual(['strikeout'])
    expect(playsOf(plays, 3, 'top')).toEqual([])
  })

  it('依比賽順序排：同一局的上半在下半之前', () => {
    expect(sortPlays(plays).map((p) => `${p.inning}${p.half}`)).toEqual(['1top', '1bottom', '2top'])
  })

  it('換掉一個半局時，其他半局原封不動', () => {
    const next = replaceHalfInning(plays, 1, 'top', [play('homerun', { runs: 1 })])
    expect(playsOf(next, 1, 'top').map((p) => p.result)).toEqual(['homerun'])
    expect(playsOf(next, 1, 'bottom').map((p) => p.result)).toEqual(['walk'])
    expect(playsOf(next, 2, 'top').map((p) => p.result)).toEqual(['single'])
  })

  it('空陣列就是清空那個半局', () => {
    const next = replaceHalfInning(plays, 1, 'top', [])
    expect(playsOf(next, 1, 'top')).toEqual([])
    expect(next).toHaveLength(2)
  })

  it('打席身上的局數以呼叫端指定的為準', () => {
    // 從別的半局複製貼上時，打席自己帶著的座標可能還是舊的 ——
    // 照單全收的話，那幾筆會落在別的半局裡（而畫面上完全看不出來）
    const stale = play('single', { inning: 9, half: 'bottom' })
    const next = replaceHalfInning([], 3, 'top', [stale])
    expect(next[0]).toMatchObject({ inning: 3, half: 'top' })
  })
})

describe('describeHalfInning（半局賽況的一句話）', () => {
  it('依順序把打席串起來，得分寫在括號裡', () => {
    const plays = [
      play('triple', { batter: { playerId: '', name: '', number: '24' } }),
      play('strikeout', { batter: { playerId: '', name: '', number: '56' } }),
      play('doublePlay', { batter: { playerId: '', name: '', number: '18' }, runs: 1, rbi: 1 }),
    ]
    expect(describeHalfInning(plays)).toBe('#24 三壘安打、#56 三振、#18 雙殺打（得 1 分）')
  })

  it('沒有打席時回空字串（呼叫端才好整段不顯示）', () => {
    expect(describeHalfInning([])).toBe('')
  })
})

describe('describeBatter', () => {
  it.each([
    [{ playerId: 'p1', name: '張志豪', number: '7' }, '#7 張志豪'],
    [{ playerId: '', name: '', number: '24' }, '#24'],
    [{ playerId: '', name: '臨時支援', number: '' }, '臨時支援'],
    [{ playerId: '', name: '', number: '' }, '（未填）'],
  ])('%o → %s', (batter, expected) => {
    expect(describeBatter(play('single', { batter }))).toBe(expected)
  })
})

describe('defaultRbi（輸入時的打點預設值）', () => {
  it('安打得幾分就是幾打點', () => {
    expect(defaultRbi('double', 2)).toBe(2)
    expect(defaultRbi('homerun', 1)).toBe(1)
  })

  it('高飛犧牲打也有打點', () => {
    expect(defaultRbi('sacrificeFly', 1)).toBe(1)
  })

  it('失誤與野手選擇推進回來的分數不算打點', () => {
    expect(defaultRbi('reachedOnError', 1)).toBe(0)
    expect(defaultRbi('fieldersChoice', 1)).toBe(0)
  })

  it('沒得分就沒有打點', () => {
    expect(defaultRbi('single', 0)).toBe(0)
  })

  it('雙殺打依規則不給打點，跑者出局不是打席也沒有打點', () => {
    expect(defaultRbi('doublePlay', 1)).toBe(0)
    expect(defaultRbi('runnerOut', 1)).toBe(0)
  })
})

describe('defaultRuns（登錄時的得分預設值）', () => {
  it('全壘打至少打者自己回來 1 分，其他預設 0', () => {
    expect(defaultRuns('homerun')).toBe(1)
    expect(defaultRuns('double')).toBe(0)
    expect(defaultRuns('strikeout')).toBe(0)
  })
})

/**
 * 得分與打點都在打席列表上調（登錄之後隨時回頭改）。
 *
 * 得分＝這個打席隊伍得幾分（計分板用），打點＝其中算在打者身上的。
 * 多數情況兩者一樣，所以調得分時打點跟著動 —— 不該要人調兩次。
 */
describe('adjustRuns／clampRbi', () => {
  const play = (result: PlayResult, runs: number, rbi: number) => ({ result, runs, rbi })

  it('打點原本等於預設值時，跟著得分一起動', () => {
    expect(adjustRuns(play('double', 0, 0), 2)).toEqual({ runs: 2, rbi: 2 })
    expect(adjustRuns(play('double', 2, 2), 1)).toEqual({ runs: 1, rbi: 1 })
  })

  it('失誤上壘：得分動、打點維持 0（預設值本來就是 0）', () => {
    expect(adjustRuns(play('reachedOnError', 0, 0), 1)).toEqual({ runs: 1, rbi: 0 })
  })

  it('打點被手動改過之後，調得分不會蓋掉它', () => {
    // 兩分回來但其中一分是暴投：使用者把打點改成 1，之後再調得分不該被改回 2
    expect(adjustRuns(play('single', 2, 1), 3)).toEqual({ runs: 3, rbi: 1 })
  })

  it('得分往下調時，手動的打點也不能超過得分', () => {
    expect(adjustRuns(play('single', 3, 2), 1)).toEqual({ runs: 1, rbi: 1 })
  })

  it('得分在 0～4 之間，全壘打至少 1', () => {
    expect(adjustRuns(play('single', 0, 0), -1).runs).toBe(0)
    expect(adjustRuns(play('single', 4, 4), 5).runs).toBe(4)
    expect(adjustRuns(play('homerun', 1, 1), 0).runs).toBe(1)
  })

  it('打點不能超過得分，也不能是負的', () => {
    expect(clampRbi({ runs: 1 }, 2)).toBe(1)
    expect(clampRbi({ runs: 1 }, -1)).toBe(0)
  })
})

describe('playSchema', () => {
  it('不存 outs —— 出局數完全由結果決定', () => {
    // 多一個可以覆寫的數字，就多一個會和結果對不上的東西
    expect(Object.keys(playSchema.shape)).not.toContain('outs')
  })

  it('不存「我隊／對手」—— 由 battingSide(half, homeAway) 推導', () => {
    expect(Object.keys(playSchema.shape)).not.toContain('side')
  })

  it('打者可以只有背號（對手打者與臨時支援的球友沒有 playerId）', () => {
    const parsed = playSchema.parse({
      inning: 1,
      half: 'top',
      batter: { number: '24' },
      result: 'single',
    })
    expect(parsed.batter).toEqual({ playerId: '', name: '', number: '24' })
  })
})

describe('describeHalfInning 的跑者出局', () => {
  it('不寫打者：出局的是跑者，不是打擊中的那個人', () => {
    const plays = [
      play('single', { batter: { playerId: '', name: '', number: '7' } }),
      play('runnerOut', { batter: { playerId: '', name: '', number: '9' } }),
    ]
    expect(describeHalfInning(plays)).toBe('#7 一壘安打、跑者出局')
  })
})
