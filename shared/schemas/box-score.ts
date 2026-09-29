import { sumInnings, type Game, type Scoreboard } from './game'
import { battingSide, GAME_HALVES, type GameHalf, type HomeAway } from './half-inning'
import {
  halfInningOuts,
  halfInningRuns,
  halfInningStatus,
  PLAY_RESULTS,
  playsOf,
  sortPlays,
  type Play,
} from './play'

/**
 * 所有「從逐打席紀錄推導出來的東西」：計分板的逐局得分、box score、
 * 以及這場到底登錄完整了沒有。
 *
 * ## 為什麼獨立成一個檔案
 * 這些函式同時需要 `Game`（計分板、打線、主客場）與 `Play`，而
 * `game.ts` 已經 import 了 `play.ts`。推導放進 `game.ts` 會讓它再長 200 行，
 * 放進 `play.ts` 則會產生 `game ⇄ play` 的循環。相依方向見 `half-inning.ts`。
 *
 * ## 一條貫穿全部的規則
 * **一個半局只要有任何一筆打席，那一格就完全由打席決定；沒有打席的半局
 * 才看手填的值。** 逐格判斷，所以同一格永遠只有一個來源 —— 這是
 * `withSummedRuns()`（R 一律是逐局加總）往下多推一層，不是新的發明。
 */

/** 這個半局是我隊還是對手在打擊。 */
function sideOf(half: GameHalf, homeAway: HomeAway): 'our' | 'opponent' {
  return battingSide(half, homeAway)
}

/** 這場的打席最遠打到第幾局（沒有打席時回 0）。 */
function lastLoggedInning(plays: Play[]): number {
  return plays.reduce((max, play) => Math.max(max, play.inning), 0)
}

/** 對方。 */
function otherSide(side: Side): Side {
  return side === 'our' ? 'opponent' : 'our'
}

type Side = 'our' | 'opponent'

/** 只把逐局得分套上去（還沒處理 H／E）。 */
function applyInningRuns(game: Pick<Game, 'scoreboard' | 'plays' | 'homeAway'>): Scoreboard {
  const total = Math.max(game.scoreboard.innings.length, lastLoggedInning(game.plays))
  const existing = new Map(game.scoreboard.innings.map((inning) => [inning.inning, inning]))

  const innings = Array.from({ length: total }, (_, index) => {
    const number = index + 1
    const current = existing.get(number) ?? { inning: number, our: null, opponent: null }
    const next = { ...current, inning: number }

    for (const half of GAME_HALVES) {
      const plays = playsOf(game.plays, number, half)
      if (plays.length === 0) continue
      next[sideOf(half, game.homeAway)] = halfInningRuns(plays)
    }

    return next
  })

  return { ...game.scoreboard, innings }
}

/**
 * 哪一隊的打擊半局**全部**是由逐打席推導的。
 *
 * 「打過的半局」＝計分板上那一隊不是 `null` 的格子。每一格都有打席才算 ——
 * 只要有任何一格是手填的，就代表那一隊的比賽有一段沒有登錄，從打席加總出來
 * 的安打一定會少算。完全沒有打過的隊伍也不算（沒有東西可以推導）。
 */
function battingCovered(
  board: Scoreboard,
  plays: Play[],
  homeAway: HomeAway,
): Record<Side, boolean> {
  const covered: Record<Side, boolean> = { our: true, opponent: true }
  const any: Record<Side, boolean> = { our: false, opponent: false }

  for (const inning of board.innings) {
    for (const half of GAME_HALVES) {
      const side = sideOf(half, homeAway)
      if (inning[side] === null) continue
      any[side] = true
      if (playsOf(plays, inning.inning, half).length === 0) covered[side] = false
    }
  }
  return { our: covered.our && any.our, opponent: covered.opponent && any.opponent }
}

/**
 * 計分板 H／E 哪幾格是由逐打席推導的。後台據此把那幾格變成唯讀。
 *
 * - **H（安打）看自己打擊的半局**：那一隊每個打過的半局都有打席，H 才由打席加總。
 * - **E（失誤）看對方打擊的半局**：失誤是守備方犯的，發生在**對方**打擊的時候。
 */
export function playDerivedTotalFields(
  game: Pick<Game, 'scoreboard' | 'plays' | 'homeAway'>,
): Record<Side, { h: boolean; e: boolean }> {
  if (game.plays.length === 0) {
    return { our: { h: false, e: false }, opponent: { h: false, e: false } }
  }
  const board = applyInningRuns(game)
  const covered = battingCovered(board, game.plays, game.homeAway)
  return {
    our: { h: covered.our, e: covered.opponent },
    opponent: { h: covered.opponent, e: covered.our },
  }
}

/**
 * 把逐打席套進計分板：逐局得分、H（安打）、E（失誤）。
 *
 * ## 逐局得分是「逐格」判斷
 * 實際的登錄過程一定是零碎的：先補了第 3 局上，對手的半局還沒登。整張表
 * 二選一的話，這種中間狀態不是把已登錄的丟掉，就是把手填的清空。逐格判斷
 * 讓兩種來源可以並存，而且**每一格的來源都是確定的**。
 *
 * ## H／E 是「整隊」判斷
 * H／E 是整場的總計，沒有逐格可以對應。一隊只要有**任何一個打過的半局是手填
 * 的**，就代表有一段沒登錄 —— 那時候從打席加總只會安靜地少算，而「看起來對
 * 但少了三支」比「這是人填的」糟糕得多，所以那一隊的 H 維持手填。
 * 全部由打席推導時才接管（見 `playDerivedTotalFields()`）。
 *
 * ⚠️ **E 只數得到「失誤上壘」**：失誤讓打者上壘的那一種。讓跑者多推進一個壘、
 * 漏接界外飛球這類不改變打席結果的失誤，逐打席沒有地方記，所以推導出來的 E
 * 可能比實際少。
 *
 * ## 局數會跟著打席長
 * 在 7 局的計分板上登錄了第 9 局的打席，就補出第 8、9 局 —— 那代表比賽打到
 * 延長了。少了這一段，第 9 局的得分會安靜地消失（畫面上完全看不出來）。
 * 補出來的另一側是 `null`（沒打這半局），因為我們確實不知道。
 */
export function applyPlayDerivedScores(
  game: Pick<Game, 'scoreboard' | 'plays' | 'homeAway'>,
): Scoreboard {
  if (game.plays.length === 0) return game.scoreboard

  const board = applyInningRuns(game)
  const fields = playDerivedTotalFields(game)
  const hits = playDerivedHits(game)
  const errors = playDerivedErrors(game)

  const totals = { ...board.totals }
  for (const side of ['our', 'opponent'] as const) {
    totals[side] = {
      ...board.totals[side],
      ...(fields[side].h ? { h: hits[side] } : {}),
      ...(fields[side].e ? { e: errors[side] } : {}),
    }
  }
  return { ...board, totals }
}

/** 逐打席累計的安打數，依**打擊方**分開。 */
export function playDerivedHits(game: Pick<Game, 'plays' | 'homeAway'>): Record<Side, number> {
  const hits = { our: 0, opponent: 0 }
  for (const play of game.plays) {
    if (!PLAY_RESULTS[play.result].hit) continue
    hits[sideOf(play.half, game.homeAway)] += 1
  }
  return hits
}

/**
 * 逐打席累計的失誤數，依**守備方**分開 —— 計分板上的 E 是「這一隊犯了幾次失誤」，
 * 而失誤上壘發生在對方打擊的時候。只數得到失誤上壘，見 `applyPlayDerivedScores()`。
 */
export function playDerivedErrors(game: Pick<Game, 'plays' | 'homeAway'>): Record<Side, number> {
  const errors = { our: 0, opponent: 0 }
  for (const play of game.plays) {
    if (play.result !== 'reachedOnError') continue
    errors[otherSide(sideOf(play.half, game.homeAway))] += 1
  }
  return errors
}

// ── 打擊成績 ────────────────────────────────────────────────────

export interface BattingLine {
  playerId: string
  name: string
  number: string
  /** 打席（PA）。 */
  pa: number
  /** 打數（AB）。保送、觸身、犧牲打不算。 */
  ab: number
  h: number
  double: number
  triple: number
  hr: number
  rbi: number
  bb: number
  so: number
  /** 壘打數（TB）。 */
  tb: number
  /**
   * 打擊率。**這場沒有登錄完整時是 `null`，不是 0** ——
   * 0 會被畫成 `.000`，而那是「打了沒打中」的意思，和「資料不全」完全不同。
   */
  avg: number | null
}

/** 同一個人的識別。我隊球員有 `playerId`；對手打者只有背號。 */
function batterKey(batter: Play['batter']): string {
  if (batter.playerId) return `id:${batter.playerId}`
  if (batter.number) return `no:${batter.number}`
  return `name:${batter.name.trim()}`
}

/**
 * 打擊成績，我隊與對手分開。
 *
 * ## 排序是「第一次上場的順序」
 * 不照打線排：對手沒有打線可以照，而兩邊用不同的排序規則會讓同一張表的
 * 左右兩半讀起來不一樣。第一次上場的順序天然就很接近棒次。
 *
 * ## 沒有「得分（R）」那一欄
 * 要知道是誰跑回本壘，就得記下每一個跑者的推進 —— 那是專業記錄軟體的
 * 工作量，而這個球隊沒有記錄員。誠實地少一欄，好過憑空生一個數字：
 * 這張表會被截圖丟進群組，上面的每個數字都會被當真。
 */
export function deriveBatting(game: Pick<Game, 'plays' | 'homeAway' | 'scoreboard'>): {
  our: BattingLine[]
  opponent: BattingLine[]
} {
  const complete = playLogComplete(game)
  const lines = { our: new Map<string, BattingLine>(), opponent: new Map<string, BattingLine>() }

  for (const play of sortPlays(game.plays)) {
    const meta = PLAY_RESULTS[play.result]
    // 盜壘失敗與牽制出局不是打席 —— 算進去的話，那個人會多出一個
    // 憑空的打席數，而他稍後還是會打完他真正的那一個打席
    if (!meta.plateAppearance) continue

    const key = batterKey(play.batter)
    if (key === 'name:') continue

    const bucket = lines[sideOf(play.half, game.homeAway)]
    const line = bucket.get(key) ?? {
      playerId: play.batter.playerId,
      name: play.batter.name,
      number: play.batter.number,
      pa: 0,
      ab: 0,
      h: 0,
      double: 0,
      triple: 0,
      hr: 0,
      rbi: 0,
      bb: 0,
      so: 0,
      tb: 0,
      avg: null,
    }

    line.pa += 1
    if (meta.atBat) line.ab += 1
    if (meta.hit) line.h += 1
    if (play.result === 'double') line.double += 1
    if (play.result === 'triple') line.triple += 1
    if (play.result === 'homerun') line.hr += 1
    if (play.result === 'walk') line.bb += 1
    if (play.result === 'strikeout') line.so += 1
    line.rbi += play.rbi
    line.tb += meta.bases

    bucket.set(key, line)
  }

  const finish = (bucket: Map<string, BattingLine>): BattingLine[] =>
    [...bucket.values()].map((line) => ({
      ...line,
      avg: complete && line.ab > 0 ? line.h / line.ab : null,
    }))

  return { our: finish(lines.our), opponent: finish(lines.opponent) }
}

// ── 投手成績 ────────────────────────────────────────────────────

export interface PitchingLine {
  playerId: string
  name: string
  number: string
  /** 投球製造的出局數。`3` 就是 1 局，呈現時走 `formatInningsPitched()`。 */
  outs: number
  h: number
  so: number
  bb: number
  /** 失分。**不分責失與非責失** —— 那需要重建「沒有失誤的話會怎樣」。 */
  runs: number
}

/**
 * 我隊投手的成績。
 *
 * 只看**我隊防守的那些半局**（`battingSide()` 回 `opponent` 的），所以就算
 * 有人在我隊進攻的半局誤填了投手，也不會污染成績。
 *
 * 投手記在每一筆打席上而不是半局上，是為了換投：一個半局中間換人的話，
 * 記在半局上就得把那半局拆開。
 */
export function derivePitching(game: Pick<Game, 'plays' | 'homeAway'>): PitchingLine[] {
  const lines = new Map<string, PitchingLine>()

  for (const play of sortPlays(game.plays)) {
    if (sideOf(play.half, game.homeAway) !== 'opponent') continue

    const key = batterKey(play.pitcher)
    if (key === 'name:') continue

    const meta = PLAY_RESULTS[play.result]
    const line = lines.get(key) ?? {
      playerId: play.pitcher.playerId,
      name: play.pitcher.name,
      number: play.pitcher.number,
      outs: 0,
      h: 0,
      so: 0,
      bb: 0,
      runs: 0,
    }

    line.outs += meta.outs
    if (meta.hit) line.h += 1
    if (play.result === 'strikeout') line.so += 1
    if (play.result === 'walk') line.bb += 1
    line.runs += play.runs

    lines.set(key, line)
  }

  return [...lines.values()]
}

/**
 * 出局數寫成投球局數：`20` → `6.2`（六又三分之二局）。
 *
 * 小數點後的那一位是「又幾個出局」而不是十進位的小數 —— 這是棒球的寫法，
 * `6.2` 不是 6.2 局。所以它回傳字串，不回傳數字：回數字的話，總有一天
 * 有人會把兩個投手的局數加起來。
 */
export function formatInningsPitched(outs: number): string {
  return `${Math.floor(outs / 3)}.${outs % 3}`
}

// ── 完整性 ──────────────────────────────────────────────────────

/**
 * 這場比賽實際打過的半局（計分板上不是 `null` 的那些格）。
 *
 * `null` 是「沒打這半局」（主隊領先時九下不用打），`0` 是「打了沒得分」——
 * 兩者意義完全不同，而完整性的判斷完全依賴這個區別。
 */
export function playedHalfInnings(
  game: Pick<Game, 'scoreboard' | 'homeAway'>,
): Array<{ inning: number; half: GameHalf }> {
  const result: Array<{ inning: number; half: GameHalf }> = []
  for (const inning of game.scoreboard.innings) {
    for (const half of GAME_HALVES) {
      if (inning[sideOf(half, game.homeAway)] === null) continue
      result.push({ inning: inning.inning, half })
    }
  }
  return result
}

/** 已經登錄到「三出局」的半局有幾個，以及實際打過幾個。 */
export function playLogProgress(game: Pick<Game, 'scoreboard' | 'plays' | 'homeAway'>): {
  logged: number
  played: number
} {
  const played = playedHalfInnings(game)
  const logged = played.filter(
    ({ inning, half }) => halfInningStatus(playsOf(game.plays, inning, half)) === 'complete',
  ).length
  return { logged, played: played.length }
}

/**
 * 這場是不是以再見分收尾 —— 後攻方在最後一個半局打下致勝分，
 * 比賽當場結束，所以那個半局**不會有三個出局**。
 *
 * 判斷用「誰後攻」加上「誰贏」，兩件事都在既有資料裡（`homeAway` 與逐局
 * 得分），不需要額外的欄位。
 */
function endsOnWalkOff(game: Pick<Game, 'scoreboard' | 'plays' | 'homeAway'>): boolean {
  const played = playedHalfInnings(game)
  const last = played.at(-1)
  // 再見分一定發生在下半局（後攻方的半局）
  if (!last || last.half !== 'bottom') return false

  const walkOffSide = sideOf('bottom', game.homeAway)
  const other = walkOffSide === 'our' ? 'opponent' : 'our'
  const sums = sumInnings(applyPlayDerivedScores(game))
  return sums[walkOffSide] > sums[other]
}

/**
 * 這場登錄完整了嗎 —— **box score 要不要顯示打擊率，就看這一個**。
 *
 * 規則：實際打過的每一個半局都要登錄到三出局。
 *
 * ## ⚠️ 再見分的那個半局是唯一的例外
 * 後攻方打下致勝分的那一刻比賽就結束了，那個半局不會有三個出局。不放過
 * 這個例外的話，**每一場再見獲勝都會被判成登錄不完整** —— 而那正是這個
 * 球隊最想留紀錄的那幾場。
 *
 * 例外收得這麼緊是刻意的。曾經想過「最後一個半局一律免驗三出局」，
 * 但那條規則會把「登到一半就沒登了」也算成完整 —— 而那正是打擊率開始
 * 騙人的地方，也正是這整個旗標存在的理由。提前結束（天候、扣分）的場次
 * 不受影響：那種比賽的最後一個半局照樣打滿三出局才被喊停。
 *
 * 計分板整個是空的（延賽、還沒打）時回 `false`：那時候一筆打席都沒有，
 * 說它「登錄完整」只會讓 box score 拿一張空表去算打擊率。
 */
export function playLogComplete(game: Pick<Game, 'scoreboard' | 'plays' | 'homeAway'>): boolean {
  const played = playedHalfInnings(game)
  if (played.length === 0) return false

  const walkOff = endsOnWalkOff(game)

  return played.every(({ inning, half }, index) => {
    const status = halfInningStatus(playsOf(game.plays, inning, half))
    if (walkOff && index === played.length - 1) return status !== 'empty'
    return status === 'complete'
  })
}

/**
 * 某個半局在後台半局選擇器上要顯示的摘要。
 *
 * 把「得幾分」「幾個出局」「登錄到什麼程度」算在同一個地方，
 * 元件就不必各自再湊一次。
 */
export function halfInningSummary(
  game: Pick<Game, 'plays' | 'homeAway'>,
  inning: number,
  half: GameHalf,
): {
  side: 'our' | 'opponent'
  plays: Play[]
  runs: number
  outs: number
  status: 'empty' | 'partial' | 'complete'
} {
  const plays = playsOf(game.plays, inning, half)
  return {
    side: sideOf(half, game.homeAway),
    plays,
    runs: halfInningRuns(plays),
    outs: halfInningOuts(plays),
    status: halfInningStatus(plays),
  }
}
