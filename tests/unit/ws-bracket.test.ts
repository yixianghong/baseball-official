import { describe, expect, it } from 'vitest'
import {
  BET_AMOUNT,
  MAX_BETS_PER_PLAYER,
  buildBracket,
  countPlayerBets,
  describeSeries,
  hasBetOnTeam,
  isBettingLocked,
  nextEmptySlot,
  payoutPerBet,
  reachedMaxBets,
  tallyBets,
  teamById,
  teamStanding,
  wsBetSchema,
  wsBracketConfigSchema,
  type BetSlot,
  type MlbGame,
  type MlbPostseasonResponse,
  type WsBet,
} from '../../shared/schemas/ws-bracket'
import {
  CANVAS,
  CHAMPION_SPOT,
  CONNECTIONS,
  DIAMOND,
  TEAM_SLOTS,
  WINNER_SPOTS,
  spotByKey,
} from '../../app/utils/ws-bracket-layout'
import { wsBracketOrigins } from '../../server/middleware/10.security-headers'

/**
 * 「預測世界大賽冠軍」（限期活動，見 docs/ws-bracket.md）。
 *
 * 這裡守的是整個功能的兩條推導鏈：
 * 「MLB 回應 → 樹狀圖」與「下注紀錄 → 彩池」。兩條都是純函式，所以測得到。
 */

const FETCHED_AT = '2026-10-05T12:00:00.000Z'

/** 讓每個案例只寫它在意的欄位，其餘照真實回應的形狀補齊。 */
function game(options: {
  homeId: number
  awayId: number
  /** 沒給就是還沒打。 */
  winner?: 'home' | 'away'
  gameNumber?: number
  homeScore?: number
  awayScore?: number
}): MlbGame {
  const played = options.winner !== undefined
  return {
    seriesGameNumber: options.gameNumber ?? 1,
    officialDate: '2026-10-05',
    status: { abstractGameState: played ? 'Final' : 'Preview' },
    teams: {
      home: {
        team: { id: options.homeId },
        score: options.homeScore,
        isWinner: played ? options.winner === 'home' : undefined,
      },
      away: {
        team: { id: options.awayId },
        score: options.awayScore,
        isWinner: played ? options.winner === 'away' : undefined,
      },
    },
  }
}

/** 2026 年的實際對戰組合（打過真 API 確認）。 */
const CWS = 145
const HOU = 117
const CLE = 114
const BOS = 111
const NYY = 147
const TB = 139
const PHI = 143
const ATL = 144
const LAD = 119
const CHC = 112
const SD = 135
const MIL = 158

function response(overrides: Record<string, MlbGame[]> = {}): MlbPostseasonResponse {
  const base: Record<string, MlbGame[]> = {
    F_1: [game({ homeId: HOU, awayId: CWS })],
    F_2: [game({ homeId: NYY, awayId: BOS })],
    F_3: [game({ homeId: ATL, awayId: PHI })],
    F_4: [game({ homeId: SD, awayId: CHC })],
    // 對戰組合還沒產生時，MLB 會塞 id 在 5000 區段的佔位隊伍
    D_1: [game({ homeId: TB, awayId: 5529 })],
    D_2: [game({ homeId: CLE, awayId: 5528 })],
    D_3: [game({ homeId: MIL, awayId: 5533 })],
    D_4: [game({ homeId: LAD, awayId: 5532 })],
    L_1: [game({ homeId: 5513, awayId: 5521 })],
    L_2: [game({ homeId: 5517, awayId: 5525 })],
    W_1: [game({ homeId: 2710, awayId: 2711 })],
  }
  return {
    series: Object.entries({ ...base, ...overrides }).map(([id, games]) => ({
      series: { id },
      games,
    })),
  }
}

describe('buildBracket', () => {
  it('把十二支球隊依樹狀圖的順序排出來', () => {
    const bracket = buildBracket(response(), FETCHED_AT)

    expect(bracket.contenders.map((t) => t.code)).toEqual([
      // AL：外卡兩隊 + 該區分區賽的高種子
      'HOU',
      'CWS',
      'CLE',
      'NYY',
      'BOS',
      'TB',
      // NL
      'ATL',
      'PHI',
      'LAD',
      'SD',
      'CHC',
      'MIL',
    ])
  })

  it('佔位隊伍當成「還沒產生」，不是查不到的球隊', () => {
    const bracket = buildBracket(response(), FETCHED_AT)

    // 分區賽的低種子側要等外卡打完
    expect(bracket.series.D_2.sides[1].team).toBeNull()
    expect(bracket.series.W_1.sides[0].team).toBeNull()
    // 但高種子（輪空的分區冠軍）一開始就在
    expect(bracket.series.D_2.sides[0].team?.code).toBe('CLE')
  })

  it('第一戰的主隊就是高種子', () => {
    const bracket = buildBracket(response(), FETCHED_AT)

    expect(bracket.series.F_1.sides[0].team?.code).toBe('HOU')
    expect(bracket.series.F_1.sides[0].seed).toBe(3)
    expect(bracket.series.F_1.sides[1].team?.code).toBe('CWS')
    expect(bracket.series.F_1.sides[1].seed).toBe(6)
  })

  it('勝場數由 isWinner 數出來，達到門檻才算晉級', () => {
    const oneWin = buildBracket(
      response({ F_1: [game({ homeId: HOU, awayId: CWS, winner: 'home' })] }),
      FETCHED_AT,
    )
    expect(oneWin.series.F_1.state).toBe('live')
    expect(oneWin.series.F_1.winner).toBeNull()

    const twoWins = buildBracket(
      response({
        F_1: [
          game({ homeId: HOU, awayId: CWS, winner: 'home', gameNumber: 1 }),
          game({ homeId: HOU, awayId: CWS, winner: 'home', gameNumber: 2 }),
        ],
      }),
      FETCHED_AT,
    )
    expect(twoWins.series.F_1.state).toBe('final')
    expect(twoWins.series.F_1.winner).toBe('HOU')
  })

  it('⚠️ 打完但還沒晉級的球隊不算淘汰', () => {
    // 這是最容易寫錯的一條：用「有沒有出現在下一輪」判斷的話，
    // 正在打的球隊會被畫成灰的，因為它本來就還沒出現在下一輪。
    const bracket = buildBracket(
      response({ F_1: [game({ homeId: HOU, awayId: CWS, winner: 'home' })] }),
      FETCHED_AT,
    )

    expect(bracket.eliminated).toEqual([])
    expect(teamStanding(bracket, 'CWS')).toBe('alive')
  })

  it('系列賽結束後，輸的那一隊才算淘汰', () => {
    const bracket = buildBracket(
      response({
        F_1: [
          game({ homeId: HOU, awayId: CWS, winner: 'away', gameNumber: 1 }),
          game({ homeId: HOU, awayId: CWS, winner: 'away', gameNumber: 2 }),
        ],
      }),
      FETCHED_AT,
    )

    expect(bracket.eliminated).toEqual(['HOU'])
    expect(teamStanding(bracket, 'HOU')).toBe('eliminated')
    expect(teamStanding(bracket, 'CWS')).toBe('alive')
  })

  it('只有世界大賽打完才有冠軍', () => {
    const before = buildBracket(response(), FETCHED_AT)
    expect(before.champion).toBeNull()

    const after = buildBracket(
      response({
        W_1: [1, 2, 3, 4].map((n) =>
          game({ homeId: LAD, awayId: TB, winner: 'home', gameNumber: n }),
        ),
      }),
      FETCHED_AT,
    )
    expect(after.champion?.code).toBe('LAD')
    expect(teamStanding(after, 'LAD')).toBe('champion')
    expect(teamStanding(after, 'TB')).toBe('eliminated')
  })

  it('MLB 掛掉（沒有資料）時回傳一張完整但全空的樹，不是拋錯', () => {
    const bracket = buildBracket(null, FETCHED_AT)

    expect(Object.keys(bracket.series)).toHaveLength(11)
    expect(bracket.contenders).toEqual([])
    expect(bracket.champion).toBeNull()
    expect(bracket.series.W_1.state).toBe('scheduled')
  })

  it('回傳順序顛倒也不影響結果', () => {
    const played = {
      F_1: [
        game({ homeId: HOU, awayId: CWS, winner: 'home', gameNumber: 2 }),
        game({ homeId: HOU, awayId: CWS, winner: 'away', gameNumber: 1 }),
      ],
    }
    const bracket = buildBracket(response(played), FETCHED_AT)

    expect(bracket.series.F_1.sides[0].wins).toBe(1)
    expect(bracket.series.F_1.sides[1].wins).toBe(1)
    expect(bracket.series.F_1.games.map((g) => g.gameNumber)).toEqual([1, 2])
  })
})

describe('teamById', () => {
  it('認得三十支球隊', () => {
    expect(teamById(117)?.name).toBe('休士頓太空人')
    expect(teamById(119)?.league).toBe('NL')
  })

  it('佔位隊伍與 null 都回 null', () => {
    expect(teamById(5528)).toBeNull()
    expect(teamById(null)).toBeNull()
    expect(teamById(undefined)).toBeNull()
  })
})

describe('describeSeries', () => {
  const at = (overrides: Record<string, MlbGame[]>) =>
    buildBracket(response(overrides), FETCHED_AT).series.F_1

  it('還沒開打時寫賽制', () => {
    expect(describeSeries(at({}))).toBe('3 戰 2 勝')
  })

  it('進行中寫誰領先', () => {
    expect(describeSeries(at({ F_1: [game({ homeId: HOU, awayId: CWS, winner: 'away' })] }))).toBe(
      '芝加哥白襪 1–0 領先',
    )
  })

  it('打完寫誰晉級', () => {
    const games = [1, 2].map((n) =>
      game({ homeId: HOU, awayId: CWS, winner: 'home', gameNumber: n }),
    )
    expect(describeSeries(at({ F_1: games }))).toBe('休士頓太空人 2–0 晉級')
  })

  it('對戰組合未定時不會硬湊出一句話', () => {
    const bracket = buildBracket(response(), FETCHED_AT)
    expect(describeSeries(bracket.series.W_1)).toBe('對戰組合未定')
  })
})

/**
 * 建一筆測試用的下注。`slot` 預設 `'slot1'`，只有真的需要測「同一個人兩注」
 * 的案例才會指定 `'slot2'` —— 這是規則語言沒有 `numChildren()` 之後唯一能
 * 擋住「一人最多兩注」的做法（見 `shared/schemas/ws-bracket.ts` 的
 * `BET_SLOTS` 說明），所以測試資料也要照這個形狀造。
 */
function bet(playerId: string, team: string, at: number, slot: BetSlot = 'slot1'): WsBet {
  return {
    id: `${playerId}/${slot}`,
    slot,
    playerId,
    playerName: playerId,
    playerNumber: '7',
    team,
    createdAt: at,
  }
}

describe('tallyBets', () => {
  it('⚠️ 每個人在同一隊只會出現一次，不再有「押了幾注」的 count', () => {
    // 「同一隊同一人只能押一注」現在是 RTDB 路徑結構本身保證的
    // （bets/{playerId}/{team} 或 slot1／slot2 + 寫入時互相比對），
    // 不必再靠讀出來之後合併 —— tallyBets 不會、也不需要看到重複。
    const tally = tallyBets([bet('a', 'LAD', 1), bet('b', 'LAD', 2, 'slot2')])

    expect(tally.byTeam.LAD!.count).toBe(2)
    expect(tally.byTeam.LAD!.amount).toBe(2 * BET_AMOUNT)
    expect(tally.byTeam.LAD!.bettors).toEqual([
      { playerId: 'a', name: 'a', number: '7' },
      { playerId: 'b', name: 'b', number: '7' },
    ])
  })

  it('彩池是全部的注，不只押中的那一隊', () => {
    const tally = tallyBets([bet('a', 'LAD', 1), bet('b', 'TB', 2)])
    expect(tally.totalCount).toBe(2)
    expect(tally.pot).toBe(2 * BET_AMOUNT)
  })

  it('⚠️ 一半進隊費、一半進可分彩池，兩個加起來要等於總額', () => {
    // 200 一注：隊費 100、可分彩池 100。用「一注算」而不是「總額 × 50%」
    // 就不會有浮點數或四捨五入的問題，這裡順便守住這個不變式。
    const tally = tallyBets([bet('a', 'LAD', 1), bet('b', 'TB', 2), bet('c', 'TB', 3)])
    expect(tally.duesTotal).toBe(300)
    expect(tally.payoutPool).toBe(300)
    expect(tally.duesTotal + tally.payoutPool).toBe(tally.pot)
  })

  it('沒有人下注時每一項都是零，不是 undefined', () => {
    const tally = tallyBets([])
    expect(tally).toEqual({
      byTeam: {},
      totalCount: 0,
      pot: 0,
      duesTotal: 0,
      payoutPool: 0,
    })
  })
})

describe('payoutPerBet', () => {
  it('⚠️ 押中的注平分的是可分彩池，不是收到的總額', () => {
    // 總彩池 600，一半（300）進隊費，只有 300 拿來分。
    // 押 LAD 的只有 1 注 → 全拿；押 TB 的有 2 注 → 各分一半。
    // 用 pot 算的話這裡會得到 600／300，剛好是正確答案的兩倍。
    const tally = tallyBets([bet('a', 'LAD', 1), bet('b', 'TB', 2), bet('c', 'TB', 3)])
    expect(payoutPerBet(tally, 'LAD')).toBe(300)
    expect(payoutPerBet(tally, 'TB')).toBe(150)
  })

  it('沒有人押中時回 0，不是 Infinity', () => {
    const tally = tallyBets([bet('a', 'LAD', 1)])
    expect(payoutPerBet(tally, 'TB')).toBe(0)
    expect(payoutPerBet(tallyBets([]), 'LAD')).toBe(0)
  })
})

describe('一人最多兩注、同一隊只能一注', () => {
  it('hasBetOnTeam：這個人押過這一隊', () => {
    const bets = [bet('a', 'LAD', 1)]
    expect(hasBetOnTeam(bets, 'a', 'LAD')).toBe(true)
    expect(hasBetOnTeam(bets, 'a', 'TB')).toBe(false)
    expect(hasBetOnTeam(bets, 'b', 'LAD')).toBe(false)
  })

  it('countPlayerBets／reachedMaxBets：跨球隊加總，滿兩注才算到頂', () => {
    expect(countPlayerBets([], 'a')).toBe(0)
    expect(reachedMaxBets([], 'a')).toBe(false)

    const oneBet = [bet('a', 'LAD', 1)]
    expect(countPlayerBets(oneBet, 'a')).toBe(1)
    expect(reachedMaxBets(oneBet, 'a')).toBe(false)

    const twoBets = [bet('a', 'LAD', 1), bet('a', 'TB', 2, 'slot2')]
    expect(countPlayerBets(twoBets, 'a')).toBe(2)
    expect(reachedMaxBets(twoBets, 'a')).toBe(true)
    expect(twoBets.length).toBe(MAX_BETS_PER_PLAYER)
  })

  it('nextEmptySlot：第一次押給 slot1，第二次押給 slot2', () => {
    expect(nextEmptySlot([], 'a')).toBe('slot1')
    expect(nextEmptySlot([bet('a', 'LAD', 1, 'slot1')], 'a')).toBe('slot2')
  })

  it('⚠️ nextEmptySlot 填的是空著的那一格，不是永遠對著 slot1', () => {
    // 使用者可能先移除 slot1、留著 slot2 —— 下一次要押的是 slot1，
    // 不是「兩格都算滿了」，也不是不管三七二十一固定寫 slot1
    // （那樣在 slot1 還占用時會撞上安全規則的 data.exists()）。
    expect(nextEmptySlot([bet('a', 'TB', 1, 'slot2')], 'a')).toBe('slot1')
  })

  it('兩格都滿了回 null', () => {
    const full = [bet('a', 'LAD', 1, 'slot1'), bet('a', 'TB', 2, 'slot2')]
    expect(nextEmptySlot(full, 'a')).toBeNull()
  })

  it('別人的注不算進這個人的額度', () => {
    const bets = [bet('a', 'LAD', 1), bet('b', 'TB', 2)]
    expect(countPlayerBets(bets, 'a')).toBe(1)
    expect(nextEmptySlot(bets, 'b')).toBe('slot2')
  })
})

describe('isBettingLocked', () => {
  const NOON = new Date('2026-10-20T12:00:00Z').getTime()

  it('沒設定鎖盤時間就是不鎖', () => {
    expect(isBettingLocked(null, NOON)).toBe(false)
    expect(isBettingLocked(undefined, NOON)).toBe(false)
  })

  it('還沒到時間就還能下注', () => {
    expect(isBettingLocked(NOON + 1, NOON)).toBe(false)
  })

  it('⚠️ 剛好到那一毫秒就算鎖了', () => {
    // 邊界要往「鎖住」倒，不是往「還能押」——「剛好卡在截止那一秒押進去的」
    // 是這種賭盤最容易吵架的地方。安全規則用的是 `now < lockAt`，
    // 兩邊要同一個方向，否則畫面說可以、資料庫說不行。
    expect(isBettingLocked(NOON, NOON)).toBe(true)
    expect(isBettingLocked(NOON - 1, NOON)).toBe(true)
  })

  it('立即鎖盤（把時間設成現在）會立刻生效', () => {
    expect(isBettingLocked(Date.now(), Date.now() + 1)).toBe(true)
  })
})

describe('wsBracketConfigSchema', () => {
  it('沒有 config 節點時當成不鎖，不是壞掉', () => {
    expect(wsBracketConfigSchema.parse({}).lockAt).toBeNull()
  })

  it('讀得懂設定好的時間', () => {
    expect(wsBracketConfigSchema.parse({ lockAt: 1_800_000_000_000 }).lockAt).toBe(
      1_800_000_000_000,
    )
  })

  it('壞掉的值 parse 不過 —— 呼叫端會退回「沒有鎖」', () => {
    // 反過來（壞掉就鎖住）看似安全，實際上是把一筆讀不懂的資料變成
    // 「整個活動停擺而且沒有人知道為什麼」。真正擋得住的是安全規則。
    expect(wsBracketConfigSchema.safeParse({ lockAt: '明天' }).success).toBe(false)
    expect(wsBracketConfigSchema.safeParse({ lockAt: -1 }).success).toBe(false)
  })
})

describe('wsBetSchema', () => {
  it('擋掉壞掉的紀錄（RTDB 上的節點任何人都能新增）', () => {
    expect(
      wsBetSchema.safeParse({ playerId: '', playerName: 'a', team: 'LAD', createdAt: 1 }).success,
    ).toBe(false)
    expect(
      wsBetSchema.safeParse({ playerId: 'x', playerName: '', team: 'LAD', createdAt: 1 }).success,
    ).toBe(false)
    expect(
      wsBetSchema.safeParse({ playerId: 'x', playerName: 'a', team: 'L', createdAt: 1 }).success,
    ).toBe(false)
    expect(
      wsBetSchema.safeParse({ playerId: 'x', playerName: 'a', team: 'LAD', createdAt: -1 }).success,
    ).toBe(false)
  })

  it('背號可以不填（有些人沒有背號）', () => {
    const parsed = wsBetSchema.parse({ playerId: 'x', playerName: 'a', team: 'LAD', createdAt: 1 })
    expect(parsed.playerNumber).toBe('')
  })
})

describe('樹狀圖的座標表', () => {
  it('十二個下注位置剛好對上十二支球隊', () => {
    expect(TEAM_SLOTS).toHaveLength(12)
    expect(new Set(TEAM_SLOTS.map((s) => s.key)).size).toBe(12)
  })

  it('每一條連接線的兩端都查得到座標', () => {
    // spotByKey 查不到會直接拋 —— 排版表與連接表對不上時，
    // 畫面上的症狀是「少了一條線」，安靜到沒有人會發現
    for (const [from, to] of CONNECTIONS) {
      expect(() => spotByKey(from)).not.toThrow()
      expect(() => spotByKey(to)).not.toThrow()
    }
  })

  /*
   * 座標是手寫的常數，而「兩格疊在一起」在瀏覽器裡看得出來、在 CI 裡看不出來 ——
   * 改動任何一個數字都可能讓某兩格重疊或超出畫布，而且**不會有任何錯誤訊息**。
   * 這一組就是替那件事把關。
   *
   * 每一格佔的空間要跟元件實際畫出來的一致，所以尺寸抄自元件：
   * 下注格 `BracketSlot` 是 108×136、晉級格 `BracketWinner` 是 132 寬 +
   * 底下一行說明、冠軍格 128 寬 + 兩行字。
   */
  interface Box {
    id: string
    x: number
    y: number
    w: number
    h: number
  }

  const boxes: Box[] = [
    ...TEAM_SLOTS.map((s) => ({
      id: s.key,
      x: s.cx - 54,
      y: s.cy - DIAMOND / 2 - 8,
      w: 108,
      h: 136,
    })),
    ...WINNER_SPOTS.map((s) => ({
      id: s.series,
      x: s.cx - 66,
      y: s.cy - s.size / 2,
      w: 132,
      h: s.size + 26,
    })),
    // 冠軍格在 BracketTree.vue 裡是 `w-32`（128px）且 `-translate-x-1/2`
    {
      id: 'W_1',
      x: CHAMPION_SPOT.cx - 64,
      y: CHAMPION_SPOT.cy - CHAMPION_SPOT.size / 2,
      w: 128,
      h: CHAMPION_SPOT.size + 40,
    },
  ]

  it('沒有任何兩格重疊', () => {
    const overlaps: string[] = []
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i]!
        const b = boxes[j]!
        const dx = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
        const dy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
        if (dx > 0 && dy > 0) overlaps.push(`${a.id} × ${b.id}（${dx}×${dy}px）`)
      }
    }
    expect(overlaps).toEqual([])
  })

  it('所有格子都在畫布範圍內', () => {
    const outside = boxes.filter(
      (b) => b.x < 0 || b.y < 0 || b.x + b.w > CANVAS.width || b.y + b.h > CANVAS.height,
    )
    expect(outside.map((b) => b.id)).toEqual([])
  })
})

describe('wsBracketOrigins（CSP 的 connect-src 例外）', () => {
  it('沒設定時不開任何例外 —— 環境變數一拿掉，例外就跟著消失', () => {
    expect(wsBracketOrigins(undefined)).toEqual([])
    expect(wsBracketOrigins('')).toEqual([])
  })

  it('⚠️ 要涵蓋同區域的分片主機，不能只開設定裡那一個', () => {
    // RTDB 會把連線導到 `s-gke-apse1-….asia-southeast1.firebasedatabase.app`
    // 這種動態決定的主機。只開設定裡那一個的話，連線會有時候成功、有時候
    // 被擋，而被擋的樣子是畫面永遠「共 0 注」—— 和「沒有人下注」分不出來。
    expect(
      wsBracketOrigins('https://hg-baseball-default-rtdb.asia-southeast1.firebasedatabase.app'),
    ).toEqual([
      'https://hg-baseball-default-rtdb.asia-southeast1.firebasedatabase.app',
      'wss://hg-baseball-default-rtdb.asia-southeast1.firebasedatabase.app',
      'https://*.asia-southeast1.firebasedatabase.app',
      'wss://*.asia-southeast1.firebasedatabase.app',
    ])
  })

  it('us-central1 的舊網址格式也要涵蓋', () => {
    expect(wsBracketOrigins('https://hg-baseball-default-rtdb.firebaseio.com')).toEqual([
      'https://hg-baseball-default-rtdb.firebaseio.com',
      'wss://hg-baseball-default-rtdb.firebaseio.com',
      'https://*.firebaseio.com',
      'wss://*.firebaseio.com',
    ])
  })

  it('填了看不懂的東西時不要讓整個網站掛掉，只是不開例外', () => {
    expect(wsBracketOrigins('這不是網址')).toEqual([])
  })
})
