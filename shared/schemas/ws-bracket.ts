import { z } from 'zod'

/**
 * 「預測世界大賽冠軍」小遊戲的共用契約。
 *
 * ⚠️ **這是一個獨立於主站架構的限期活動**，刻意集中在少數幾個以 `ws-bracket`
 * 命名的檔案裡，活動結束後整包刪掉就好。它唯一違反全站紀律的地方是
 * **下注資料由瀏覽器直接讀寫 Realtime Database**（不經過 BFF、不存 Firestore）——
 * 那是為了「即時」與「跟正式資料完全分家」刻意換來的，理由與拆除步驟寫在
 * `docs/ws-bracket.md`。
 *
 * 這個檔案本身沒有任何副作用：全部是型別、對照表與純函式，所以
 * `tests/unit/ws-bracket.test.ts` 測得到。
 */

// ────────────────────────────────────────────────────────────────────────────
// 球隊
// ────────────────────────────────────────────────────────────────────────────

export interface MlbTeam {
  /** MLB statsapi 的球隊 id，是唯一穩定的識別碼（隊名會改，id 不會）。 */
  id: number
  /** 隊伍代碼，同時也是隊徽檔名與下注時存進資料庫的值。 */
  code: string
  /** 中文隊名。 */
  name: string
  league: 'AL' | 'NL'
}

/**
 * 三十支球隊全列出來，不只列今年進季後賽的十二支。
 *
 * 樹狀圖是**從 MLB 的回應推導**的，寫死十二支的話，只要官方把某一格填成
 * 別的隊（改制、補賽、或單純是明年再辦一次），畫面就會出現一個查不到名字的
 * 空格。多寫十八行換掉一整類「只在特定情況才炸」的狀況。
 *
 * 隊徽只有進季後賽的那十二支有（`app/assets/img/mlb/`），沒有圖的會退回代碼。
 */
export const MLB_TEAMS: readonly MlbTeam[] = [
  { id: 108, code: 'LAA', name: '洛杉磯天使', league: 'AL' },
  { id: 109, code: 'ARI', name: '亞利桑那響尾蛇', league: 'NL' },
  { id: 110, code: 'BAL', name: '巴爾的摩金鶯', league: 'AL' },
  { id: 111, code: 'BOS', name: '波士頓紅襪', league: 'AL' },
  { id: 112, code: 'CHC', name: '芝加哥小熊', league: 'NL' },
  { id: 113, code: 'CIN', name: '辛辛那提紅人', league: 'NL' },
  { id: 114, code: 'CLE', name: '克里夫蘭守護者', league: 'AL' },
  { id: 115, code: 'COL', name: '科羅拉多落磯', league: 'NL' },
  { id: 116, code: 'DET', name: '底特律老虎', league: 'AL' },
  { id: 117, code: 'HOU', name: '休士頓太空人', league: 'AL' },
  { id: 118, code: 'KC', name: '堪薩斯市皇家', league: 'AL' },
  { id: 119, code: 'LAD', name: '洛杉磯道奇', league: 'NL' },
  { id: 120, code: 'WSH', name: '華盛頓國民', league: 'NL' },
  { id: 121, code: 'NYM', name: '紐約大都會', league: 'NL' },
  { id: 133, code: 'ATH', name: '運動家', league: 'AL' },
  { id: 134, code: 'PIT', name: '匹茲堡海盜', league: 'NL' },
  { id: 135, code: 'SD', name: '聖地牙哥教士', league: 'NL' },
  { id: 136, code: 'SEA', name: '西雅圖水手', league: 'AL' },
  { id: 137, code: 'SF', name: '舊金山巨人', league: 'NL' },
  { id: 138, code: 'STL', name: '聖路易紅雀', league: 'NL' },
  { id: 139, code: 'TB', name: '坦帕灣光芒', league: 'AL' },
  { id: 140, code: 'TEX', name: '德州遊騎兵', league: 'AL' },
  { id: 141, code: 'TOR', name: '多倫多藍鳥', league: 'AL' },
  { id: 142, code: 'MIN', name: '明尼蘇達雙城', league: 'AL' },
  { id: 143, code: 'PHI', name: '費城費城人', league: 'NL' },
  { id: 144, code: 'ATL', name: '亞特蘭大勇士', league: 'NL' },
  { id: 145, code: 'CWS', name: '芝加哥白襪', league: 'AL' },
  { id: 146, code: 'MIA', name: '邁阿密馬林魚', league: 'NL' },
  { id: 147, code: 'NYY', name: '紐約洋基', league: 'AL' },
  { id: 158, code: 'MIL', name: '密爾瓦基釀酒人', league: 'NL' },
]

const TEAM_BY_ID = new Map(MLB_TEAMS.map((t) => [t.id, t]))
const TEAM_BY_CODE = new Map(MLB_TEAMS.map((t) => [t.code, t]))

/**
 * 依 id 查球隊。
 *
 * ⚠️ 查不到**不是錯誤**：季後賽賽程表在對戰組合還沒產生時會塞佔位隊伍
 * （`HOU/CWS`、`AL Higher Seed`，id 在 2000／5000 區段）。查不到就代表
 * 「這一格還沒有人」，回 `null` 讓畫面畫成待定的菱形。
 */
export function teamById(id: number | undefined | null): MlbTeam | null {
  return id == null ? null : (TEAM_BY_ID.get(id) ?? null)
}

export function teamByCode(code: string | undefined | null): MlbTeam | null {
  return code ? (TEAM_BY_CODE.get(code) ?? null) : null
}

// ────────────────────────────────────────────────────────────────────────────
// 樹狀圖骨架
// ────────────────────────────────────────────────────────────────────────────

/**
 * MLB 的系列賽代號。實測 2025 與 2026 兩季的回應，這組 id 與字母的對應是固定的：
 *
 * ```
 * F_1 = AL 外卡 A（3 vs 6）→ D_2 = ALDS B（對上分區第 2 種子）─┐
 *                                                              ├─ L_1 = ALCS ─┐
 * F_2 = AL 外卡 B（4 vs 5）→ D_1 = ALDS A（對上分區第 1 種子）─┘              │
 *                                                                             ├─ W_1 = 世界大賽
 * F_3 = NL 外卡 A（3 vs 6）→ D_4 = NLDS B（對上分區第 2 種子）─┐              │
 *                                                              ├─ L_2 = NLCS ─┘
 * F_4 = NL 外卡 B（4 vs 5）→ D_3 = NLDS A（對上分區第 1 種子）─┘
 * ```
 *
 * ⚠️ **字母 A 的外卡接的是 B 的分區賽**，不是同一個字母 —— 看起來像寫錯，
 * 但 2025（DET 打完外卡 A 去對 SEA，而 SEA 是第 2 種子）與 2026 的資料都是這樣。
 * 照直覺把 A 接 A 的話，整個上半區與下半區會對調，而畫面上看起來完全正常。
 */
export const SERIES_IDS = [
  'F_1',
  'F_2',
  'F_3',
  'F_4',
  'D_1',
  'D_2',
  'D_3',
  'D_4',
  'L_1',
  'L_2',
  'W_1',
] as const

export type SeriesId = (typeof SERIES_IDS)[number]

export type BracketRound = 'WC' | 'DS' | 'CS' | 'WS'

/** 各輪的勝場數。外卡三戰兩勝、分區五戰三勝、聯盟與世界大賽七戰四勝。 */
export const WINS_NEEDED: Record<BracketRound, number> = { WC: 2, DS: 3, CS: 4, WS: 4 }

export const ROUND_LABELS: Record<BracketRound, string> = {
  WC: '外卡系列賽',
  DS: '分區系列賽',
  CS: '聯盟冠軍賽',
  WS: '世界大賽',
}

interface SeriesShape {
  round: BracketRound
  league: 'AL' | 'NL' | null
  /** 這一輪的中文標題（畫在樹狀圖的標籤上）。 */
  label: string
  /** [高種子側, 低種子側] 的種子編號。`null` 代表這一輪不標種子。 */
  seeds: [number | null, number | null]
  /** 低種子那一側由誰晉級而來。`null` 代表那一側是直接晉級的分區冠軍。 */
  feeds: [SeriesId | null, SeriesId | null]
}

/**
 * 樹狀圖的骨架。**只有這一張表是寫死的**，球隊、比分、勝負全部由 MLB 回應填入。
 *
 * `feeds` 的順序與 `seeds` 一致：`[高種子側, 低種子側]`。畫面上高種子側在上、
 * 低種子側在下，和 MLB 官方的賽程圖一致。
 */
export const SERIES_SHAPE: Record<SeriesId, SeriesShape> = {
  F_1: { round: 'WC', league: 'AL', label: 'AL 外卡', seeds: [3, 6], feeds: [null, null] },
  F_2: { round: 'WC', league: 'AL', label: 'AL 外卡', seeds: [4, 5], feeds: [null, null] },
  F_3: { round: 'WC', league: 'NL', label: 'NL 外卡', seeds: [3, 6], feeds: [null, null] },
  F_4: { round: 'WC', league: 'NL', label: 'NL 外卡', seeds: [4, 5], feeds: [null, null] },
  D_1: { round: 'DS', league: 'AL', label: 'ALDS', seeds: [1, null], feeds: [null, 'F_2'] },
  D_2: { round: 'DS', league: 'AL', label: 'ALDS', seeds: [2, null], feeds: [null, 'F_1'] },
  D_3: { round: 'DS', league: 'NL', label: 'NLDS', seeds: [1, null], feeds: [null, 'F_4'] },
  D_4: { round: 'DS', league: 'NL', label: 'NLDS', seeds: [2, null], feeds: [null, 'F_3'] },
  L_1: { round: 'CS', league: 'AL', label: 'ALCS', seeds: [null, null], feeds: ['D_1', 'D_2'] },
  L_2: { round: 'CS', league: 'NL', label: 'NLCS', seeds: [null, null], feeds: ['D_3', 'D_4'] },
  W_1: { round: 'WS', league: null, label: '世界大賽', seeds: [null, null], feeds: ['L_1', 'L_2'] },
}

// ────────────────────────────────────────────────────────────────────────────
// MLB 回應（只宣告我們真的會讀的欄位）
// ────────────────────────────────────────────────────────────────────────────

export interface MlbGameSide {
  team?: { id?: number; name?: string }
  score?: number
  isWinner?: boolean
}

export interface MlbGame {
  gamePk?: number
  officialDate?: string
  gameDate?: string
  seriesGameNumber?: number
  status?: { abstractGameState?: string; detailedState?: string }
  teams?: { away?: MlbGameSide; home?: MlbGameSide }
}

export interface MlbSeries {
  series?: { id?: string }
  games?: MlbGame[]
}

export interface MlbPostseasonResponse {
  series?: MlbSeries[]
}

// ────────────────────────────────────────────────────────────────────────────
// 推導出來的樹狀圖
// ────────────────────────────────────────────────────────────────────────────

export interface BracketSide {
  /** `null` 代表這一側還沒產生（前一輪還沒打完）。 */
  team: MlbTeam | null
  seed: number | null
  /** 這個系列賽已經贏幾場。 */
  wins: number
}

export interface BracketGame {
  date: string
  gameNumber: number
  state: 'scheduled' | 'live' | 'final'
  /** 依 `sides` 的順序，`null` 代表還沒打。 */
  scores: [number | null, number | null]
}

export interface BracketSeries {
  id: SeriesId
  round: BracketRound
  league: 'AL' | 'NL' | null
  label: string
  winsNeeded: number
  /** `[高種子側, 低種子側]`。 */
  sides: [BracketSide, BracketSide]
  state: 'scheduled' | 'live' | 'final'
  /** 晉級者的代碼，系列賽還沒結束時是 `null`。 */
  winner: string | null
  games: BracketGame[]
}

export interface Bracket {
  series: Record<SeriesId, BracketSeries>
  /** 下注位置：十二支進季後賽的球隊，依樹狀圖由上而下排列。 */
  contenders: MlbTeam[]
  /** 已經被淘汰的球隊代碼。 */
  eliminated: string[]
  /** 世界大賽冠軍，還沒產生時是 `null`。 */
  champion: MlbTeam | null
  /** 從 MLB 抓回來的時間（ISO 字串），畫面上要寫出來。 */
  fetchedAt: string
}

function gameState(game: MlbGame): 'scheduled' | 'live' | 'final' {
  const abstract = game.status?.abstractGameState
  if (abstract === 'Final') return 'final'
  if (abstract === 'Live') return 'live'
  return 'scheduled'
}

/**
 * 把一支 MLB 系列賽轉成樹狀圖上的一格。
 *
 * **勝場數自己數 `isWinner`，不讀 `leagueRecord.wins`。** 後者是**逐場**的欄位
 * （記到那一場為止的系列賽戰績），要用它就得先挑出「最後一場已完成的比賽」——
 * 而未完成的比賽也帶著這個欄位、值是 `0-0`，挑錯一場就會把已經 3–1 的系列賽
 * 讀成 0–0。數 `isWinner` 不必挑，回傳的順序改變也不影響結果。
 */
function readSeries(id: SeriesId, raw: MlbSeries | undefined): BracketSeries {
  const shape = SERIES_SHAPE[id]
  const winsNeeded = WINS_NEEDED[shape.round]
  const games = [...(raw?.games ?? [])].sort(
    (a, b) => (a.seriesGameNumber ?? 0) - (b.seriesGameNumber ?? 0),
  )

  /*
   * 誰是高種子：第一戰的主隊。
   *
   * 外卡、分區、聯盟、世界大賽的第一戰都在高種子的主場，所以這一條規則
   * 四輪通用，不必為每一輪各寫一次。
   */
  const first = games[0]
  const highTeam = teamById(first?.teams?.home?.team?.id)
  const lowTeam = teamById(first?.teams?.away?.team?.id)

  const winsOf = (team: MlbTeam | null): number => {
    if (!team) return 0
    return games.filter((g) =>
      [g.teams?.home, g.teams?.away].some((s) => s?.team?.id === team.id && s?.isWinner === true),
    ).length
  }

  const sides: [BracketSide, BracketSide] = [
    { team: highTeam, seed: shape.seeds[0], wins: winsOf(highTeam) },
    { team: lowTeam, seed: shape.seeds[1], wins: winsOf(lowTeam) },
  ]

  const winnerSide = sides.find((s) => s.team && s.wins >= winsNeeded) ?? null
  const played = games.filter((g) => gameState(g) !== 'scheduled')

  return {
    id,
    round: shape.round,
    league: shape.league,
    label: shape.label,
    winsNeeded,
    sides,
    state: winnerSide ? 'final' : played.length > 0 ? 'live' : 'scheduled',
    winner: winnerSide?.team?.code ?? null,
    games: games.map((g) => ({
      date: g.officialDate ?? '',
      gameNumber: g.seriesGameNumber ?? 0,
      state: gameState(g),
      // 分數依 sides 的順序（高種子在前），不是 MLB 的主客順序 —— 主客每場會換
      scores: [scoreOf(g, highTeam), scoreOf(g, lowTeam)] as [number | null, number | null],
    })),
  }
}

function scoreOf(game: MlbGame, team: MlbTeam | null): number | null {
  if (!team) return null
  const side = [game.teams?.home, game.teams?.away].find((s) => s?.team?.id === team.id)
  return side?.score ?? null
}

/**
 * 從 MLB 的季後賽賽程回應推導出整張樹狀圖。
 *
 * 純函式：同樣的輸入永遠得到同樣的輸出，沒有任何時間或網路相依
 * （`fetchedAt` 由呼叫端傳進來），所以整條推導鏈測得到。
 */
export function buildBracket(
  response: MlbPostseasonResponse | null | undefined,
  fetchedAt: string,
): Bracket {
  const byId = new Map<string, MlbSeries>()
  for (const s of response?.series ?? []) {
    if (s.series?.id) byId.set(s.series.id, s)
  }

  const series = Object.fromEntries(
    SERIES_IDS.map((id) => [id, readSeries(id, byId.get(id))]),
  ) as Record<SeriesId, BracketSeries>

  /*
   * 下注位置＝十二支球隊，順序照樹狀圖由上而下（AL 在前、NL 在後）。
   *
   * 外卡的兩隊 + 該區分區賽的高種子，就是這一區的三支球隊 —— 不必另外查
   * 戰績表拿種子排名，賽程表的結構本身已經把它說完了。
   */
  const contenders: MlbTeam[] = []
  const addSlot = (team: MlbTeam | null) => {
    if (team && !contenders.some((t) => t.id === team.id)) contenders.push(team)
  }
  for (const [wc, ds] of [
    ['F_1', 'D_2'],
    ['F_2', 'D_1'],
    ['F_3', 'D_4'],
    ['F_4', 'D_3'],
  ] as [SeriesId, SeriesId][]) {
    addSlot(series[wc].sides[0].team)
    addSlot(series[wc].sides[1].team)
    addSlot(series[ds].sides[0].team)
  }

  /*
   * 淘汰＝「打了一個已經結束的系列賽而且不是晉級的那一隊」。
   *
   * 不用「沒有出現在後面的輪次裡」判斷 —— 那樣的話，系列賽正在進行中的隊伍
   * 也會被當成淘汰（它本來就還沒出現在下一輪），前台會把還在打的球隊畫成灰的。
   */
  const eliminated = new Set<string>()
  for (const id of SERIES_IDS) {
    const s = series[id]
    if (s.state !== 'final') continue
    for (const side of s.sides) {
      if (side.team && side.team.code !== s.winner) eliminated.add(side.team.code)
    }
  }

  return {
    series,
    contenders,
    eliminated: [...eliminated],
    champion: teamByCode(series.W_1.winner),
    fetchedAt,
  }
}

/** 某支球隊現在的處境。畫面靠它決定要不要變灰、要不要關閉下注。 */
export type TeamStanding = 'alive' | 'eliminated' | 'champion'

export function teamStanding(bracket: Bracket, code: string): TeamStanding {
  if (bracket.champion?.code === code) return 'champion'
  return bracket.eliminated.includes(code) ? 'eliminated' : 'alive'
}

/**
 * 一句話說明這個系列賽的狀況，例如「休士頓太空人 晉級」「2–1 領先」。
 *
 * 收在這裡而不是寫在元件裡：樹狀圖的格子與下方的賽程清單都要講同一件事，
 * 兩邊各拼一次字串遲早會有一邊忘了更新。
 */
export function describeSeries(series: BracketSeries): string {
  const [high, low] = series.sides
  if (!high.team || !low.team) return '對戰組合未定'
  if (series.state === 'final') {
    const winner = series.winner === high.team.code ? high : low
    const loser = series.winner === high.team.code ? low : high
    return `${winner.team!.name} ${winner.wins}–${loser.wins} 晉級`
  }
  if (series.state === 'scheduled') return `${series.winsNeeded * 2 - 1} 戰 ${series.winsNeeded} 勝`
  if (high.wins === low.wins) return `戰成 ${high.wins}–${low.wins} 平手`
  const lead = high.wins > low.wins ? high : low
  const trail = high.wins > low.wins ? low : high
  return `${lead.team!.name} ${lead.wins}–${trail.wins} 領先`
}

// ────────────────────────────────────────────────────────────────────────────
// 下注
// ────────────────────────────────────────────────────────────────────────────

/** 一注的金額（新台幣）。 */
export const BET_AMOUNT = 200

/**
 * 一注裡有多少進球隊隊費，不進彩池分配。
 *
 * ⚠️ **從「一注」算，不是從「總彩池」算。** 200 的一半是 100，
 * 整數、不會有浮點數或四捨五入的問題；如果改成「彩池總額 × 50%」，
 * 遇到奇數注數時 `pot` 仍然整除（`count * 200` 一定是偶數），但邏輯上
 * 這筆錢本來就是逐注收的（隊費也是每一注各扣一半，不是活動結束後
 * 才從總額撥一筆），從一注算才對得上「這一注的錢去了哪裡」這個問題。
 */
export const TEAM_DUES_PER_BET = BET_AMOUNT / 2

/** 一注裡真正進彩池、會分給押中的人的部分。 */
export const PAYOUT_PER_BET = BET_AMOUNT - TEAM_DUES_PER_BET

/**
 * 一筆下注。這是**寫進 Realtime Database 的形狀**，所以欄位改動要同步改
 * `database.rules.json` 的 `.validate` —— 規則才是真正擋得住亂寫的那一層，
 * 這個 schema 只擋得住我們自己寫錯。
 *
 * 姓名與背號存**快照**，和打線、出席同一個道理：球員改名或退隊之後，
 * 已經下過的注仍然要看得出當時是誰下的。頭像則是即時從名冊查（`playerId`），
 * 換照片時舊的注也跟著換 —— 照片不是紀錄的一部分。
 */
export const wsBetSchema = z.object({
  playerId: z.string().min(1).max(64),
  playerName: z.string().min(1).max(20),
  playerNumber: z.string().max(3).default(''),
  /** 押哪一隊奪冠。值是 `MLB_TEAMS` 的 `code`。 */
  team: z.string().min(2).max(4),
  /** 伺服器時間（毫秒）。由 RTDB 的 `serverTimestamp()` 產生。 */
  createdAt: z.number().int().nonnegative(),
})

export type WsBetInput = z.infer<typeof wsBetSchema>

/**
 * 一個人最多能押幾注，存進 RTDB 的哪兩個固定鍵。
 *
 * ⚠️ **這是「一人最多兩注」唯一擋得住的做法，長度就是規則本身。**
 * RTDB 的規則語言**沒有 `numChildren()`**（這是實測 `firebase deploy` 才
 * 發現的，官方文件列的方法清單裡其實沒有它）。沒有這個方法，唯一能限制
 * 「某個節點底下最多幾個子節點」的寫法，是把可能的鍵名寫死、其餘一律拒絕
 * （`database.rules.json` 的 `$other: { ".validate": false }`）——
 * 所以這裡不是「隨便挑兩個字當 key」，這兩個字**就是**上限本身：
 * 改成三注要嘛在這裡加 `'slot3'`、規則檔同步加一段幾乎一樣的區塊。
 */
export const BET_SLOTS = ['slot1', 'slot2'] as const

export type BetSlot = (typeof BET_SLOTS)[number]

/** 一個人最多能下幾注（不分球隊）。就是 `BET_SLOTS` 的長度。 */
export const MAX_BETS_PER_PLAYER = BET_SLOTS.length

/**
 * 讀回來的下注多兩個欄位：`id` 與 `slot`。
 *
 * `slot` 是這筆紀錄存在 RTDB 的哪一個固定位置（`ws-bracket/bets/{playerId}/{slot}`），
 * 不是球隊 —— 「同一隊只能押一次」現在是寫入時互相比對兩個槽位的球隊代碼
 * 擋下的（見安全規則），路徑本身不再靠球隊代碼保證唯一。
 *
 * `id` 是 `${playerId}/${slot}`：移除時原樣接在 `bets/` 後面就是完整路徑，
 * 也拿來當 Vue 列表的 `:key`。
 */
export type WsBet = WsBetInput & { id: string; slot: BetSlot }

/** 這個人在這一隊押過了嗎。 */
export function hasBetOnTeam(bets: readonly WsBet[], playerId: string, team: string): boolean {
  return bets.some((b) => b.playerId === playerId && b.team === team)
}

/** 這個人目前總共押了幾注（不分球隊）。 */
export function countPlayerBets(bets: readonly WsBet[], playerId: string): number {
  return bets.filter((b) => b.playerId === playerId).length
}

/**
 * 這個人是不是已經押滿了。
 *
 * 畫面用它決定要不要把整個人的頭像收起來（`BracketRoster` 的
 * `maxBetsPerPlayer`）；真正擋得住的是安全規則裡固定的兩個槽位鍵，
 * 這裡算錯了也只是畫面不同步。
 */
export function reachedMaxBets(bets: readonly WsBet[], playerId: string): boolean {
  return countPlayerBets(bets, playerId) >= MAX_BETS_PER_PLAYER
}

/**
 * 這個人下一注要寫進哪一個槽位。兩格都滿了回傳 `null`。
 *
 * 用「第一個還空著的」而不是固定某一格：使用者移除一注之後，空出來的可能
 * 是 `slot1` 也可能是 `slot2`，下一次下注要填進那個空格，不是永遠對著
 * `slot1` 硬寫（那樣移除 `slot1` 之後再押就會踩到規則的
 * `data.exists()`，因為真正空的其實是別格）。
 */
export function nextEmptySlot(bets: readonly WsBet[], playerId: string): BetSlot | null {
  const used = new Set(bets.filter((b) => b.playerId === playerId).map((b) => b.slot))
  return BET_SLOTS.find((slot) => !used.has(slot)) ?? null
}

/**
 * 鎖盤設定（RTDB 的 `ws-bracket/config`）。
 *
 * `lockAt` 是「從這個時間起不能再動」的毫秒時間戳，`null` 代表不鎖。
 * **只有 service account 寫得了**（後台的鎖盤頁走 BFF），前台只讀。
 */
export const wsBracketConfigSchema = z.object({
  lockAt: z.number().int().nonnegative().nullable().default(null),
})

export type WsBracketConfig = z.infer<typeof wsBracketConfigSchema>

/** 後台鎖盤頁送上來的東西。`null` = 解除鎖盤。 */
export const wsLockInputSchema = z.object({
  lockAt: z.number().int().nonnegative().nullable(),
})

export type WsLockInput = z.infer<typeof wsLockInputSchema>

/**
 * 現在能不能下注／移除。
 *
 * **時間一到就鎖，不必有人按第二次** —— 「我會鎖盤」如果真的要靠人在那一秒
 * 按下去，那個人塞車的時候就有人多押了一注。後台設的是時間，按「立即鎖盤」
 * 只是把那個時間設成現在。
 *
 * 這只是畫面用的判斷；真正擋得住的是安全規則裡的同一條比較
 * （`now < config/lockAt`），所以繞過前端直接打 API 也寫不進去。
 */
export function isBettingLocked(lockAt: number | null | undefined, now: number): boolean {
  return lockAt != null && now >= lockAt
}

export interface TeamTally {
  code: string
  count: number
  amount: number
  /**
   * 押這一隊的人，依下注時間排序。
   *
   * ⚠️ **每個人在這裡只會出現一次。** 「同一隊同一人只能押一注」是
   * RTDB 的路徑結構本身保證的（見 `WsBet.id` 的說明），不是這裡算出來的 ——
   * 所以跟舊版不同，這裡不再有「這個人押了幾注」的 `count` 欄位可以顯示。
   */
  bettors: { playerId: string; name: string; number: string }[]
}

export interface BetTally {
  byTeam: Record<string, TeamTally>
  totalCount: number
  /** 總彩池（全部下注金額的總和，含隊費）。 */
  pot: number
  /** 進隊費的部分，不參與分配。 */
  duesTotal: number
  /** 真正會分給押中的人的部分（`pot - duesTotal`）。`payoutPerBet()` 用的是這個。 */
  payoutPool: number
}

/**
 * 統計下注。
 *
 * ⚠️ **不用再處理「同一個人重複押同一隊」** —— RTDB 的路徑結構
 * （`bets/{playerId}/{team}`）讓這件事在寫入的當下就不可能發生，
 * 不必在讀出來之後合併。這裡只是單純依球隊分組。
 *
 * 依下注時間排序（`bets` 進來時已經照 `createdAt` 排過），不是依人名 ——
 * 這張表要回答的是「誰先押的」，跟後面彩池表用注數排序是不同的問題。
 */
export function tallyBets(bets: readonly WsBet[]): BetTally {
  const byTeam: Record<string, TeamTally> = {}

  for (const bet of bets) {
    const tally = (byTeam[bet.team] ??= { code: bet.team, count: 0, amount: 0, bettors: [] })
    tally.count += 1
    tally.amount += BET_AMOUNT
    tally.bettors.push({ playerId: bet.playerId, name: bet.playerName, number: bet.playerNumber })
  }

  return {
    byTeam,
    totalCount: bets.length,
    pot: bets.length * BET_AMOUNT,
    duesTotal: bets.length * TEAM_DUES_PER_BET,
    payoutPool: bets.length * PAYOUT_PER_BET,
  }
}

/**
 * 押中的話，一注可以分到多少。
 *
 * **分母是 `payoutPool`，不是 `pot`。** 彩池有一半進球隊隊費，只有另一半
 * 才拿來分給押中世界大賽冠軍的人 —— 用 `pot` 算的話，每注可分的金額會是
 * 實際發得出來的兩倍，領錢的時候才發現對不上。
 *
 * **冠軍還沒產生時回傳的是「假如這一隊奪冠」的預估值**，所以畫面上一定要
 * 寫成「預估」—— 後面每多一注，已經下注的人分到的就會變。少了那兩個字，
 * 這個數字看起來就像已經確定的獎金。
 *
 * 沒有人押中時回 `0`：剩下的錢要怎麼處理是人的決定，不是這個函式該猜的。
 */
export function payoutPerBet(tally: BetTally, code: string): number {
  const winningBets = tally.byTeam[code]?.count ?? 0
  if (winningBets === 0) return 0
  return Math.floor(tally.payoutPool / winningBets)
}
