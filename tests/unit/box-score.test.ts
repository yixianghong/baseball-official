import { describe, expect, it } from 'vitest'
import {
  applyPlayDerivedScores,
  deriveBatting,
  derivePitching,
  formatInningsPitched,
  halfInningSummary,
  playDerivedErrors,
  playDerivedHits,
  playDerivedTotalFields,
  playedHalfInnings,
  playLogComplete,
  playLogProgress,
} from '../../shared/schemas/box-score'
import { playSchema, type Play, type PlayResult } from '../../shared/schemas/play'
import type { GameHalf, HomeAway } from '../../shared/schemas/half-inning'
import type { Scoreboard } from '../../shared/schemas/game'

/** `[第幾局, 上/下, 打者背號或 id, 結果, 得分?]` —— 和示範資料同一種寫法。 */
type Spec = [number, GameHalf, string, PlayResult] | [number, GameHalf, string, PlayResult, number]

function buildPlays(spec: Spec[], pitcherNumber = '1'): Play[] {
  return spec.map(([inning, half, number, result, runs = 0]) =>
    playSchema.parse({
      inning,
      half,
      batter: { number, name: `選手${number}` },
      pitcher: {
        number: pitcherNumber,
        name: `投手${pitcherNumber}`,
        playerId: `pitcher-${pitcherNumber}`,
      },
      result,
      runs,
      rbi: runs,
    }),
  )
}

function board(innings: Array<[number | null, number | null]>): Scoreboard {
  return {
    innings: innings.map(([our, opponent], index) => ({ inning: index + 1, our, opponent })),
    totals: { our: { r: 0, h: 0, e: 0 }, opponent: { r: 0, h: 0, e: 0 } },
  }
}

/** 一個乾淨的三上三下（三個出局、沒有得分）。 */
function threeUp(inning: number, half: GameHalf, prefix: string): Spec[] {
  return [
    [inning, half, `${prefix}1`, 'strikeout'],
    [inning, half, `${prefix}2`, 'groundout'],
    [inning, half, `${prefix}3`, 'flyout'],
  ]
}

describe('applyPlayDerivedScores（逐打席接管逐局得分）', () => {
  // 主場 = 我隊後攻，所以上半局是對手打擊
  const homeAway: HomeAway = 'home'

  it('有打席的半局：那一格由打席加總，手填的值被取代', () => {
    const game = {
      homeAway,
      scoreboard: board([
        [9, 9],
        [9, 9],
      ]),
      plays: buildPlays([
        [1, 'bottom', '7', 'double', 2],
        [1, 'bottom', '9', 'strikeout'],
      ]),
    }

    // 1 下是我隊打擊 → our 變成 2；同一格的 opponent 沒有打席，維持 9
    expect(applyPlayDerivedScores(game).innings[0]).toEqual({ inning: 1, our: 2, opponent: 9 })
  })

  it('沒有打席的半局：完全維持手填的值', () => {
    // 這是整條規則的另一半。少了它，登錄到一半的比賽會把還沒登的那幾格
    // 全部歸零 —— 而畫面上看起來就是「分數自己不見了」
    const game = {
      homeAway,
      scoreboard: board([
        [3, 1],
        [0, 5],
      ]),
      plays: buildPlays([[1, 'bottom', '7', 'homerun', 1]]),
    }

    const result = applyPlayDerivedScores(game)
    expect(result.innings[0]).toEqual({ inning: 1, our: 1, opponent: 1 })
    expect(result.innings[1]).toEqual({ inning: 2, our: 0, opponent: 5 })
  })

  it('完全沒有打席時回傳原本那一份（同一個物件參考）', () => {
    // 後台是自動儲存的：每次都回新物件會讓「光是打開頁面」就送出一次 PATCH，
    // 和 withSummedRuns() 是同一個理由
    const scoreboard = board([[1, 2]])
    const game = { homeAway, scoreboard, plays: [] }
    expect(applyPlayDerivedScores(game)).toBe(scoreboard)
  })

  it('打席打到計分板還沒有的局數時，把局數補出來', () => {
    // 七局的計分板上登錄了第 9 局，代表比賽打到延長了。
    // 少了這一段，第 9 局的得分會安靜地消失
    const game = {
      homeAway,
      scoreboard: board([[0, 0]]),
      plays: buildPlays([[3, 'bottom', '7', 'single', 1]]),
    }

    const result = applyPlayDerivedScores(game)
    expect(result.innings).toHaveLength(3)
    // 補出來的另一側是 null（沒打這半局）—— 我們確實不知道
    expect(result.innings[1]).toEqual({ inning: 2, our: null, opponent: null })
    expect(result.innings[2]).toEqual({ inning: 3, our: 1, opponent: null })
  })

  it('客場時上下半局對調（走 battingSide，不是寫死我隊在上）', () => {
    const game = {
      homeAway: 'away' as HomeAway,
      scoreboard: board([[null, null]]),
      plays: buildPlays([[1, 'top', '7', 'homerun', 1]]),
    }
    // 客隊先攻 → 客場時 1 上是我隊打擊
    expect(applyPlayDerivedScores(game).innings[0]).toEqual({ inning: 1, our: 1, opponent: null })
  })
})

describe('playDerivedHits', () => {
  it('兩邊的安打分開算，而且只算安打', () => {
    const game = {
      homeAway: 'home' as HomeAway,
      plays: buildPlays([
        [1, 'top', '11', 'single'],
        [1, 'top', '12', 'walk'],
        [1, 'bottom', '7', 'double'],
        [1, 'bottom', '9', 'triple'],
        [1, 'bottom', '5', 'reachedOnError'],
      ]),
    }
    expect(playDerivedHits(game)).toEqual({ our: 2, opponent: 1 })
  })
})

describe('deriveBatting（打擊成績）', () => {
  const homeAway: HomeAway = 'home'

  const complete = {
    homeAway,
    // 1 上與 1 下都打過（0 是「打了沒得分」，null 才是「沒打這半局」）
    scoreboard: board([[3, 0]]),
    plays: buildPlays([
      ...threeUp(1, 'top', '1'),
      [1, 'bottom', '7', 'single'],
      [1, 'bottom', '7', 'walk'],
      [1, 'bottom', '7', 'strikeout'],
      [1, 'bottom', '9', 'sacrificeFly', 1],
      [1, 'bottom', '9', 'double', 2],
      [1, 'bottom', '5', 'groundout'],
    ]),
  }

  it('保送與犧牲打算打席、不算打數', () => {
    const [seven] = deriveBatting(complete).our
    expect(seven).toMatchObject({ number: '7', pa: 3, ab: 2, h: 1, bb: 1, so: 1 })

    const nine = deriveBatting(complete).our[1]
    expect(nine).toMatchObject({ number: '9', pa: 2, ab: 1, h: 1, rbi: 3 })
  })

  it('壘打數依安打種類累加', () => {
    const nine = deriveBatting(complete).our[1]
    // 高飛犧牲打 0 + 二壘安打 2
    expect(nine?.tb).toBe(2)
  })

  it('登錄完整時算得出打擊率', () => {
    // 1 下三個出局（三振、高飛犧牲打、滾地出局）＝ 登錄完整
    const [seven] = deriveBatting(complete).our
    expect(seven?.avg).toBeCloseTo(0.5)
  })

  it('登錄不完整時打擊率是 null，不是 0', () => {
    // `0` 會被畫成 `.000`，那是「打了沒打中」的意思 —— 和「資料不全」
    // 完全不同，而這正是一個少登三場的 .412 會開始騙人的地方
    const partial = {
      homeAway,
      scoreboard: board([[null, null]]),
      plays: buildPlays([[1, 'bottom', '7', 'single']]),
    }
    expect(deriveBatting(partial).our[0]?.avg).toBeNull()
  })

  it('我隊與對手分開', () => {
    const game = {
      homeAway,
      scoreboard: board([[null, null]]),
      plays: buildPlays([
        [1, 'top', '11', 'single'],
        [1, 'bottom', '7', 'single'],
      ]),
    }
    const { our, opponent } = deriveBatting(game)
    expect(our.map((line) => line.number)).toEqual(['7'])
    expect(opponent.map((line) => line.number)).toEqual(['11'])
  })

  it('跑者出局不算打席（不會讓人憑空多一個打席數）', () => {
    const game = {
      homeAway,
      scoreboard: board([[null, null]]),
      plays: buildPlays([
        [1, 'bottom', '7', 'single'],
        [1, 'bottom', '7', 'runnerOut'],
      ]),
    }
    expect(deriveBatting(game).our[0]).toMatchObject({ pa: 1, ab: 1, h: 1 })
  })

  it('排序是第一次上場的順序', () => {
    const game = {
      homeAway,
      scoreboard: board([[null, null]]),
      plays: buildPlays([
        [2, 'bottom', '9', 'single'],
        [1, 'bottom', '7', 'single'],
      ]),
    }
    expect(deriveBatting(game).our.map((line) => line.number)).toEqual(['7', '9'])
  })

  it('沒有「得分（R）」那一欄', () => {
    // 要知道是誰跑回本壘就得追蹤每一個跑者的推進，這個專案刻意不做。
    // 誠實地少一欄，好過憑空生一個會被當真的數字
    const line = deriveBatting(complete).our[0]!
    expect(Object.keys(line)).not.toContain('r')
    expect(Object.keys(line)).not.toContain('runs')
  })
})

describe('derivePitching（投手成績）', () => {
  it('只算我隊防守的半局', () => {
    // 我隊進攻的半局裡就算誤填了投手，也不該污染成績
    const game = {
      homeAway: 'home' as HomeAway,
      plays: buildPlays([
        [1, 'top', '11', 'strikeout'],
        [1, 'top', '12', 'single', 1],
        [1, 'top', '13', 'doublePlay'],
        [1, 'bottom', '7', 'homerun', 3],
      ]),
    }

    const lines = derivePitching(game)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ number: '1', outs: 3, h: 1, so: 1, bb: 0, runs: 1 })
  })

  it('換投時兩位各自累計（投手記在打席上而不是半局上）', () => {
    const plays = [
      ...buildPlays([[1, 'top', '11', 'strikeout']], '1'),
      ...buildPlays([[1, 'top', '12', 'walk']], '24'),
    ]
    const lines = derivePitching({ homeAway: 'home', plays })
    expect(lines.map((line) => line.number)).toEqual(['1', '24'])
    expect(lines[1]).toMatchObject({ outs: 0, bb: 1 })
  })
})

describe('formatInningsPitched', () => {
  it.each([
    [0, '0.0'],
    [1, '0.1'],
    [3, '1.0'],
    [20, '6.2'],
  ])('%i 個出局 → %s 局', (outs, expected) => {
    expect(formatInningsPitched(outs)).toBe(expected)
  })

  it('回傳字串而不是數字', () => {
    // `6.2` 是「六又三分之二局」，不是十進位的 6.2 ——
    // 回數字的話，總有一天有人會把兩個投手的局數加起來
    expect(typeof formatInningsPitched(20)).toBe('string')
  })
})

describe('playedHalfInnings（哪些半局真的打過）', () => {
  it('計分板上是 null 的半局不算打過', () => {
    // null 是「沒打這半局」（主隊領先時九下不用打），0 是「打了沒得分」
    const game = {
      homeAway: 'home' as HomeAway,
      scoreboard: board([
        [0, 0],
        [1, null],
      ]),
    }
    expect(playedHalfInnings(game)).toEqual([
      { inning: 1, half: 'top' },
      { inning: 1, half: 'bottom' },
      { inning: 2, half: 'bottom' },
    ])
  })
})

describe('playLogComplete（這場登錄完整了嗎）', () => {
  const homeAway: HomeAway = 'home'

  it('每一個打過的半局都登到三出局時為 true', () => {
    const game = {
      homeAway,
      scoreboard: board([[0, 0]]),
      plays: buildPlays([...threeUp(1, 'top', '1'), ...threeUp(1, 'bottom', '2')]),
    }
    expect(playLogComplete(game)).toBe(true)
  })

  it('中間有半局沒登錄時為 false', () => {
    const game = {
      homeAway,
      scoreboard: board([[0, 0]]),
      plays: buildPlays(threeUp(1, 'top', '1')),
    }
    expect(playLogComplete(game)).toBe(false)
  })

  it('半局只登到一半時為 false', () => {
    const game = {
      homeAway,
      scoreboard: board([[0, 0]]),
      plays: buildPlays([...threeUp(1, 'top', '1'), [1, 'bottom', '21', 'strikeout'] as Spec]),
    }
    expect(playLogComplete(game)).toBe(false)
  })

  it('最後一個半局不要求三出局（再見安打就是這樣結束的）', () => {
    // 不放過這個例外的話，每一場再見獲勝都會被判成登錄不完整 ——
    // 而那正是這個球隊最想留紀錄的那幾場
    const game = {
      homeAway,
      scoreboard: board([
        [0, 0],
        [1, 0],
      ]),
      plays: buildPlays([
        ...threeUp(1, 'top', '1'),
        ...threeUp(1, 'bottom', '2'),
        ...threeUp(2, 'top', '3'),
        [2, 'bottom', '7', 'single'],
        [2, 'bottom', '9', 'homerun', 1],
      ]),
    }
    expect(playLogComplete(game)).toBe(true)
  })

  it('最後一個半局完全沒登錄時還是 false', () => {
    const game = {
      homeAway,
      scoreboard: board([[0, 0]]),
      plays: buildPlays(threeUp(1, 'top', '1')),
    }
    expect(playLogComplete(game)).toBe(false)
  })

  it('計分板整個是空的時候是 false', () => {
    // 延賽、還沒打的場次沒有任何半局，說它「登錄完整」只會讓 box score
    // 拿一張空表去算打擊率
    expect(playLogComplete({ homeAway, scoreboard: board([]), plays: [] })).toBe(false)
  })
})

describe('playLogProgress', () => {
  it('數得出「已登錄 N／打過 M」', () => {
    const game = {
      homeAway: 'home' as HomeAway,
      scoreboard: board([
        [0, 0],
        [0, 0],
      ]),
      plays: buildPlays(threeUp(1, 'top', '1')),
    }
    expect(playLogProgress(game)).toEqual({ logged: 1, played: 4 })
  })
})

describe('halfInningSummary', () => {
  it('一次給出這半局是誰在打、幾分、幾出局、登錄到什麼程度', () => {
    const game = {
      homeAway: 'home' as HomeAway,
      plays: buildPlays([
        [3, 'bottom', '7', 'double', 1],
        [3, 'bottom', '9', 'strikeout'],
      ]),
    }
    expect(halfInningSummary(game, 3, 'bottom')).toMatchObject({
      side: 'our',
      runs: 1,
      outs: 1,
      status: 'partial',
    })
    expect(halfInningSummary(game, 3, 'top')).toMatchObject({ side: 'opponent', status: 'empty' })
  })
})

/**
 * 計分板的 H／E 由逐打席推導。
 *
 * H／E 是整場總計，沒有逐格可以對應，所以是**整隊**判斷：一隊每個打過的半局
 * 都有打席，那一隊的 H（與對方的 E）才由打席加總；有任何一格是手填的，
 * 就代表有一段沒登錄，推導只會安靜地少算 —— 那時維持手填。
 */
describe('applyPlayDerivedScores：H／E', () => {
  const homeAway: HomeAway = 'home' // 上半局對手打擊、下半局我隊打擊

  function withTotals(innings: Array<[number | null, number | null]>) {
    const scoreboard = board(innings)
    scoreboard.totals = { our: { r: 0, h: 9, e: 9 }, opponent: { r: 0, h: 9, e: 9 } }
    return scoreboard
  }

  const fullGame = buildPlays([
    [1, 'top', '11', 'single'],
    [1, 'top', '12', 'reachedOnError'], // 我隊守備失誤
    ...threeUp(1, 'top', '2'),
    [1, 'bottom', '7', 'double'],
    [1, 'bottom', '9', 'single'],
    [1, 'bottom', '5', 'reachedOnError'], // 對手守備失誤
    ...threeUp(1, 'bottom', '3'),
  ])

  it('兩隊的半局都有登錄時，H 與 E 全部由打席推導', () => {
    const result = applyPlayDerivedScores({
      homeAway,
      scoreboard: withTotals([[0, 0]]),
      plays: fullGame,
    })
    expect(result.totals.our).toMatchObject({ h: 2, e: 1 })
    expect(result.totals.opponent).toMatchObject({ h: 1, e: 1 })
  })

  it('E 算在守備方：對方打擊時的失誤上壘，是我隊的失誤', () => {
    const plays = buildPlays([[1, 'top', '12', 'reachedOnError']])
    expect(playDerivedErrors({ homeAway, plays })).toEqual({ our: 1, opponent: 0 })
  })

  it('失誤上壘不算安打', () => {
    const plays = buildPlays([[1, 'bottom', '5', 'reachedOnError']])
    expect(playDerivedHits({ homeAway, plays })).toEqual({ our: 0, opponent: 0 })
  })

  it('一隊有任何一個半局是手填的，那一隊的 H 維持手填', () => {
    // 第 2 局下（我隊）是手填的 3 分、沒有打席 → 我隊有一段沒登錄
    const result = applyPlayDerivedScores({
      homeAway,
      scoreboard: withTotals([
        [0, 0],
        [3, null],
      ]),
      plays: fullGame,
    })
    expect(result.totals.our.h).toBe(9) // 維持手填
    expect(result.totals.opponent.h).toBe(1) // 對手的半局全部有登錄，照樣推導
  })

  it('E 看的是對方打擊的半局：我隊打擊有一段沒登，對手的 E 維持手填', () => {
    const result = applyPlayDerivedScores({
      homeAway,
      scoreboard: withTotals([
        [0, 0],
        [3, null],
      ]),
      plays: fullGame,
    })
    expect(result.totals.opponent.e).toBe(9) // 對手的失誤發生在我隊打擊時 → 那段沒登
    expect(result.totals.our.e).toBe(1) // 我隊的失誤發生在對手打擊時 → 全部有登
  })

  it('只登錄了一隊時，另一隊的 H 與這一隊的 E 維持手填', () => {
    const plays = buildPlays(threeUp(1, 'bottom', '3')) // 只有我隊打擊
    const result = applyPlayDerivedScores({ homeAway, scoreboard: withTotals([[0, 0]]), plays })
    expect(result.totals.our.h).toBe(0)
    expect(result.totals.opponent.e).toBe(0)
    expect(result.totals.opponent.h).toBe(9)
    expect(result.totals.our.e).toBe(9)
  })

  it('playDerivedTotalFields 說得出哪幾格是推導的（後台據此鎖住）', () => {
    const plays = buildPlays(threeUp(1, 'bottom', '3'))
    expect(playDerivedTotalFields({ homeAway, scoreboard: withTotals([[0, 0]]), plays })).toEqual({
      our: { h: true, e: false },
      opponent: { h: false, e: true },
    })
  })

  it('完全沒有打席時，H／E 都不是推導的', () => {
    expect(
      playDerivedTotalFields({ homeAway, scoreboard: withTotals([[1, 2]]), plays: [] }),
    ).toEqual({ our: { h: false, e: false }, opponent: { h: false, e: false } })
  })

  it('R 仍然不在這裡處理（由 withSummedRuns 加總）', () => {
    const result = applyPlayDerivedScores({
      homeAway,
      scoreboard: withTotals([[0, 0]]),
      plays: fullGame,
    })
    expect(result.totals.our.r).toBe(0)
  })
})
