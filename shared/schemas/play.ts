import { z } from 'zod'
import { gameHalfSchema, halfInningOrder, type GameHalf } from './half-inning'
import { positionSchema } from './player'

/**
 * 逐打席紀錄（play-by-play）。
 *
 * ## 為什麼現在做，而當初刻意不做
 * 當初的純文字打擊紀錄（`batters`，已移除）上寫著兩個「不要做數據欄位」的
 * 理由，兩個都還成立，只是這一版把它們的前提拆掉了：
 *
 * 1. 「欄位越多，實際發生的事不是資料更完整，而是整段沒人填。」
 *    —— 所以這裡的登錄介面**自動帶下一棒**（依打線輪轉），多數打席只要按
 *    一個結果鍵就完成，再加上語音。⚠️ **哪天把自動帶下一棒拿掉，這個理由
 *    就會立刻回來**。
 * 2. 「別讓它看起來像可以算的東西 —— 一個少登三場的 `.412` 比沒有數字糟糕。」
 *    —— 所以「這場有沒有登錄完整」是**推導的**（每個半局的出局數加總是不是
 *    到 3，見 `halfInningStatus()`），不是一個要人記得勾的旗標；登錄不完整
 *    的場次不顯示打擊率（見 `deriveBatting()`）。
 *
 * CLAUDE.md 當初寫的出路就是這個：「該補的是結構化欄位**加上『這場有沒有
 * 完整登錄』的旗標**，而不是回頭去解析這些句子。」純文字的投手／打擊紀錄
 * 從來沒有被解析，後來整個拿掉了（CLAUDE.md「賽後紀錄（已由逐打席取代）」）。
 */

/**
 * 一個打席的結果。
 *
 * 列舉刻意收得很緊：每一個值都要能明確回答「製造幾個出局」「算不算打數」
 * 「算不算安打」「幾個壘打數」四個問題，否則 box score 就算不出來。
 * 表上沒有的怪事一律走 `other` 加 `note` 說明。
 */
export const playResultSchema = z.enum([
  // 安打
  'single',
  'double',
  'triple',
  'homerun',
  // 上壘，但不算打數
  'walk',
  'hitByPitch',
  // 出局
  'strikeout',
  'groundout',
  'flyout',
  'lineout',
  'foulout',
  'doublePlay',
  'triplePlay',
  // 上壘，算打數
  'fieldersChoice',
  'reachedOnError',
  // 犧牲：不算打數，但製造一個出局
  'sacrificeFly',
  'sacrificeBunt',
  // 不是打席：盜壘失敗、牽制出局
  'runnerOut',
  'other',
])

export type PlayResult = z.infer<typeof playResultSchema>

interface PlayResultMeta {
  /** 顯示用的全名。 */
  label: string
  /** 逐局摘要與 box score 裡的短碼。 */
  short: string
  /** 這個結果製造幾個出局。雙殺 2、三殺 3。 */
  outs: number
  /** 算不算一個打席（PA）。`runnerOut` 不是打席。 */
  plateAppearance: boolean
  /** 算不算一個打數（AB）。保送、觸身、犧牲打都不算。 */
  atBat: boolean
  hit: boolean
  /** 壘打數（TB）。 */
  bases: number
  /**
   * 語音／文字輸入時的別名。
   *
   * 中文的講法很多（「三安」「三壘打」「三壘安打」都是同一件事），而**語音
   * 辨識的結果收斂一定要用程式碼處理，不能靠提示詞叮嚀** —— 這是這個專案
   * 既有的紀律（見 `server/utils/gemini.ts`），而且只有這樣才測得到。
   *
   * ⚠️ 別名之間不能互相包含到會誤判的程度，「三振」與「三壘安打」是這裡
   * 最危險的一組（`tests/unit/play.test.ts` 直接守著它）。
   */
  aliases: string[]
}

/**
 * 結果屬性表 —— **這個功能的心臟**。
 *
 * 打擊率、安打數、出局數、半局完整性、box score 全部從這張表推導，
 * 所以它只能有一份。改這裡等於改全站的數字。
 */
export const PLAY_RESULTS: Record<PlayResult, PlayResultMeta> = {
  single: {
    label: '一壘安打',
    short: '1B',
    outs: 0,
    plateAppearance: true,
    atBat: true,
    hit: true,
    bases: 1,
    aliases: ['一安', '一壘打', '一壘安打', '安打'],
  },
  double: {
    label: '二壘安打',
    short: '2B',
    outs: 0,
    plateAppearance: true,
    atBat: true,
    hit: true,
    bases: 2,
    aliases: ['二安', '二壘打', '二壘安打', '兩壘安打'],
  },
  triple: {
    label: '三壘安打',
    short: '3B',
    outs: 0,
    plateAppearance: true,
    atBat: true,
    hit: true,
    bases: 3,
    aliases: ['三安', '三壘打', '三壘安打'],
  },
  homerun: {
    label: '全壘打',
    short: 'HR',
    outs: 0,
    plateAppearance: true,
    atBat: true,
    hit: true,
    bases: 4,
    aliases: ['全打', '全壘打', '紅不讓'],
  },
  walk: {
    label: '四壞球保送',
    short: 'BB',
    outs: 0,
    plateAppearance: true,
    atBat: false,
    hit: false,
    bases: 0,
    aliases: ['保送', '四壞', '四壞球', '四壞保送', '選到四壞'],
  },
  hitByPitch: {
    label: '觸身球',
    short: 'HBP',
    outs: 0,
    plateAppearance: true,
    atBat: false,
    hit: false,
    bases: 0,
    aliases: ['觸身', '觸身球', '死球', '被觸身'],
  },
  strikeout: {
    label: '三振',
    short: 'K',
    outs: 1,
    plateAppearance: true,
    atBat: true,
    hit: false,
    bases: 0,
    aliases: ['三振', '被三振', '三振出局'],
  },
  groundout: {
    label: '滾地球出局',
    short: 'GO',
    outs: 1,
    plateAppearance: true,
    atBat: true,
    hit: false,
    bases: 0,
    aliases: ['滾地', '滾地球', '滾地出局', '滾地球出局', '內野滾地球'],
  },
  flyout: {
    /*
     * ⚠️ **「飛球出局」不能當標籤**，要寫「高飛球出局」。
     *
     * 「平飛球出局」與「界外飛球出局」裡面都含有「飛球出局」—— 落點選單上
     * 三個排在一起時，第一個讀起來像是**涵蓋另外兩個的上層分類**，
     * 沒有人知道差在哪（實際被問過）。改成「高飛」之後三個就是平行的三種。
     * 規則本身由 `tests/unit/play.test.ts` 的「沒有一個標籤是另一個的子字串」守著。
     *
     * ## ⚠️ 這裡原本還有一個 `popout`（內野高飛出局），已經拿掉了
     * 它和 `flyout` 的統計屬性**一模一樣**（1 出局、算打數、非安打、0 壘打數），
     * `battedTypeOf()` 也一樣回 `'fly'` —— 唯一的差別是「在內野還是外野接到的」，
     * 而**那正是落點記下來的東西**。多一顆按鈕要人每次多做一個不影響任何數字的
     * 判斷，和「欄位越多越沒人填」是同一條。舊資料的 `popout` 在
     * `migrateLegacyGame()` 轉成 `flyout`。
     */
    label: '高飛球出局',
    short: 'FO',
    outs: 1,
    plateAppearance: true,
    atBat: true,
    hit: false,
    bases: 0,
    aliases: ['飛球', '高飛', '飛球出局', '高飛球出局', '外野飛球', '接殺', '內野高飛', '小飛球'],
  },
  lineout: {
    label: '平飛球出局',
    short: 'LO',
    outs: 1,
    plateAppearance: true,
    atBat: true,
    hit: false,
    bases: 0,
    aliases: ['平飛', '平飛球', '平飛球出局'],
  },
  foulout: {
    label: '界外飛球出局',
    short: 'FF',
    outs: 1,
    plateAppearance: true,
    atBat: true,
    hit: false,
    bases: 0,
    aliases: ['界外飛球', '界外接殺'],
  },
  doublePlay: {
    label: '雙殺打',
    short: 'DP',
    outs: 2,
    plateAppearance: true,
    atBat: true,
    hit: false,
    bases: 0,
    aliases: ['雙殺', '雙殺打', '打成雙殺'],
  },
  triplePlay: {
    label: '三殺打',
    short: 'TP',
    outs: 3,
    plateAppearance: true,
    atBat: true,
    hit: false,
    bases: 0,
    aliases: ['三殺', '三殺打'],
  },
  fieldersChoice: {
    label: '野手選擇',
    short: 'FC',
    // ⚠️ **1 而不是 0。** 野手選擇的定義就是「守方選擇去刺殺跑者，讓打者上壘」
    // —— 打者安全，但**有一個跑者出局**。記成 0 的話，每一次野選都會讓那個
    // 半局少算一個出局，於是它永遠停在「還沒滿三出局」，整場比賽就被判成
    // 登錄不完整（實際在示範資料上踩到）。
    outs: 1,
    plateAppearance: true,
    atBat: true,
    hit: false,
    bases: 0,
    aliases: ['野選', '野手選擇'],
  },
  reachedOnError: {
    label: '失誤上壘',
    short: 'E',
    outs: 0,
    plateAppearance: true,
    atBat: true,
    hit: false,
    bases: 0,
    aliases: ['失誤', '失誤上壘', '對方失誤', '守備失誤'],
  },
  sacrificeFly: {
    label: '高飛犧牲打',
    short: 'SF',
    outs: 1,
    plateAppearance: true,
    atBat: false,
    hit: false,
    bases: 0,
    aliases: ['高飛犧牲打', '犧牲飛球', '高犧'],
  },
  sacrificeBunt: {
    label: '犧牲觸擊',
    short: 'SH',
    outs: 1,
    plateAppearance: true,
    atBat: false,
    hit: false,
    bases: 0,
    aliases: ['犧牲觸擊', '短打', '犧短', '觸擊'],
  },
  runnerOut: {
    label: '跑者出局',
    short: 'RO',
    outs: 1,
    // 盜壘失敗與牽制出局發生在打席**之間**，那個打者稍後還是會打完他的打席。
    // 算成打席的話，box score 上他會多出一個憑空的打席數。
    plateAppearance: false,
    atBat: false,
    hit: false,
    bases: 0,
    aliases: ['盜壘失敗', '牽制出局', '跑者出局', '阻殺'],
  },
  other: {
    label: '其他',
    short: '—',
    outs: 0,
    plateAppearance: true,
    atBat: false,
    hit: false,
    bases: 0,
    aliases: [],
  },
}

/** 一個人的身分快照。球員改名不影響歷史紀錄，和打線、出席同一套做法。 */
const personSchema = z.object({
  /** 我隊球員有值；對手打者與臨時支援的球友沒有。 */
  playerId: z.string().default(''),
  name: z.string().max(20).default(''),
  number: z.string().max(3).default(''),
})

const EMPTY_PERSON = { playerId: '', name: '', number: '' }

/**
 * 球的落點。
 *
 * ## 座標系統
 * **本壘是原點，y 軸指向中外野，全壘打牆的距離＝1**，x 正向是一壘側。
 * 刻意不存英呎：業餘球場的大小各不相同，同一個「90 公尺」在不同場地
 * 是完全不同的位置，只有「相對於這座球場」才有意義。後台登錄與前台
 * 落點圖都用同一套座標（`shared/schemas/field.ts`），所以畫出來一定對得上。
 *
 * 範圍比球場寬一點：牆外（全壘打）與界外區的落點也要存得下。
 */
export const fieldPointSchema = z.object({
  x: z.number().min(-1.5).max(1.5),
  y: z.number().min(-0.3).max(1.5),
})

export type FieldPoint = z.infer<typeof fieldPointSchema>

/** 擊球類型。落點圖用不同符號畫，看得出是打穿內野還是打過外野頭頂。 */
export const battedTypeSchema = z.enum(['ground', 'line', 'fly'])
export type BattedType = z.infer<typeof battedTypeSchema>

export const BATTED_LABELS: Record<BattedType, string> = {
  ground: '滾地',
  line: '平飛',
  fly: '高飛',
}

/** 打者站哪一邊打。左右開弓的人每個打席可能不同，所以存在打席上。 */
export const batSideSchema = z.enum(['L', 'R'])
export type BatSide = z.infer<typeof batSideSchema>

/**
 * 一個打席。
 *
 * ## 不存 `id`，也不存 `seq`
 * `plays` 是一個**有序扁平陣列**（和 `clips` 完全同構），半局內的順序就是
 * 陣列順序，而寫入時是**整個半局一起覆蓋**的（見 `saveHalfInningPlays()`）
 * —— 所以不需要穩定鍵，也就不需要在前端生 UUID。
 *
 * ## 不存「我隊／對手」
 * 由 `battingSide(half, homeAway)` 推導。`homeAway` 填錯又改回來時，
 * 計分板與打席歸屬會一起修正（正確），而影片標籤不動（也正確）——
 * 這是既有的規則，見 `half-inning.ts`。
 *
 * ## 不存 `outs`
 * 出局數完全由 `result` 決定（`PLAY_RESULTS[result].outs`）。多一個可以
 * 覆寫的數字，就多一個會和結果對不上的東西 —— 和 `withSummedRuns()`、
 * `gameResult()`、`deriveBench()` 是同一個道理。表上沒有的情況走 `other`。
 */
export const playSchema = z.object({
  inning: z.number().int().min(1).max(20),
  half: gameHalfSchema,
  batter: personSchema.default(EMPTY_PERSON),
  /**
   * 這個打席的投手。
   *
   * 我隊防守的半局填我隊投手 —— 投手成績（`derivePitching()`）就是從這裡
   * 逐打席累加出來的，所以換投才記得下來。我隊進攻的半局通常留空：
   * 對手的投手我們沒有名冊，記了也推不出任何東西。
   */
  pitcher: personSchema.default(EMPTY_PERSON),
  result: playResultSchema,
  /**
   * 這個打席**隊伍**得了幾分（含被推進回來的跑者）。
   *
   * 這是少數非存不可的欄位：一支安打得幾分取決於壘上有誰，而這個專案
   * **刻意不追蹤跑者推進**（那是專業記錄軟體的工作量），所以推導不出來。
   */
  runs: z.number().int().min(0).max(4).default(0),
  /**
   * 打點。和 `runs` 不同：失誤、暴投、野手選擇推進回來的分數算隊伍得分，
   * 但不算打者的打點。登錄介面會依結果自動帶一個預設值，可以改。
   */
  rbi: z.number().int().min(0).max(4).default(0),
  note: z.string().max(60).default(''),
  /**
   * 語音辨識的原話。手動輸入時是空的。
   *
   * 留著是為了事後校正 —— 辨識錯的時候，看得到當初講了什麼才知道該改成
   * 什麼；只留一個收斂後的列舉值，錯了就再也查不出來。
   */
  transcript: z.string().max(200).default(''),

  // ── 落點（全部選填）─────────────────────────────────────────
  // 用按鈕或語音登錄的打席沒有落點，三振、保送這類結果本來就沒有落點。
  // 全部預設 null，所以這四個欄位加進來之前的打席照樣有效。

  /**
   * 球落在哪裡。`null` 代表沒有落點（三振、保送），或是用按鈕／語音登錄的。
   *
   * ⚠️ 語音**刻意不產生**落點：「游擊方向」可以對到一個大概的位置，但那是
   * 猜出來的座標，混進落點圖裡就會被當成真的。
   */
  location: fieldPointSchema.nullable().default(null),
  /**
   * 第一個處理球的人（雙殺 6-4-3 只記 6）。只在出局、失誤、野選時有值 ——
   * 穿越的安打沒有人「處理」它。和落點**分開存**：球打在游擊與三壘中間時，
   * 落點照實記，處理的人另外選。
   */
  fielder: positionSchema.nullable().default(null),
  /**
   * 擊球類型。**只有安打需要存** —— 出局的類型從結果就推得出來
   * （飛球出局就是 fly），見 `battedTypeOf()`。存兩份的話遲早對不上。
   */
  batted: battedTypeSchema.nullable().default(null),
  /**
   * 這個打席站哪一邊打。我隊從名冊帶入（左右開弓時才問），對手是 `null`。
   *
   * 存在打席上而不是每次去讀名冊：左右開弓的人每個打席可能不同，而且
   * 名冊日後改了也不該回頭改到歷史紀錄 —— 和姓名快照同一個道理。
   */
  bats: batSideSchema.nullable().default(null),

  /**
   * 這個打席是打線上的第幾棒（我隊才有，對手是 `null`）。
   *
   * ## 為什麼要存
   * 代打會**永久換掉那一棒**：第 5 棒被代打之後，下一輪輪到第 5 棒時上場的是
   * 代打的人，不是原本的先發。而 `lineup` 是**賽前**排的名單（會印在出賽名單
   * 圖卡上），不能為了代打去改它 —— 改了之後賽前那張圖卡就和當天貼出去的
   * 對不上。所以「現在第 5 棒是誰」由打席推導：最後一個記在第 5 棒的人。
   * 見 `battingOrderAt()`。
   *
   * 舊的打席沒有這個欄位（`null`），推導時退回「數打席」的算法。
   */
  battingSlot: z.number().int().min(1).max(15).nullable().default(null),
})

export type Play = z.infer<typeof playSchema>

/**
 * 這個打席的擊球類型：安打看存的值，出局從結果推導。
 *
 * 落點圖只呼叫這一支，不直接讀 `play.batted` —— 否則所有出局都會畫成
 * 「沒有類型」。
 */
export function battedTypeOf(play: Pick<Play, 'result' | 'batted'>): BattedType | null {
  switch (play.result) {
    case 'groundout':
    case 'doublePlay':
    case 'triplePlay':
    case 'fieldersChoice':
    case 'sacrificeBunt':
      return 'ground'
    case 'flyout':
    case 'foulout':
    case 'sacrificeFly':
      return 'fly'
    case 'lineout':
      return 'line'
    default:
      return play.batted
  }
}

/** 一場最多幾個打席。7 局 × 2 半局 × 約 7 個打席 ≈ 98，延長賽留餘裕。 */
export const MAX_PLAYS_PER_GAME = 200

/** 一個半局最多幾個打席。打到第 20 個還沒三出局的半局，資料八成是壞的。 */
export const MAX_PLAYS_PER_HALF_INNING = 20

// ── 推導（純函式，全部測得到）──────────────────────────────────

/** 篩出某個半局的打席，保持原本的順序。 */
export function playsOf(plays: Play[], inning: number, half: GameHalf): Play[] {
  return plays.filter((play) => play.inning === inning && play.half === half)
}

/** 這半局製造了幾個出局。 */
export function halfInningOuts(plays: Play[]): number {
  return plays.reduce((sum, play) => sum + PLAY_RESULTS[play.result].outs, 0)
}

/** 這半局得了幾分。 */
export function halfInningRuns(plays: Play[]): number {
  return plays.reduce((sum, play) => sum + play.runs, 0)
}

/** 這半局的安打數。 */
export function halfInningHits(plays: Play[]): number {
  return plays.filter((play) => PLAY_RESULTS[play.result].hit).length
}

/**
 * 這半局登錄到什麼程度。
 *
 * **這就是「這場有沒有完整登錄」的旗標，而且是推導的** —— 不是一個要人
 * 記得勾的核取方塊。三出局才叫打完一個半局，是棒球規則本身，不是額外的
 * 資料；讓人自己宣告「我登錄完了」的話，忘了勾的場次會長得跟登錄到一半的
 * 一模一樣，而那正是打擊率會開始騙人的地方。
 *
 * ⚠️ `>= 3` 而不是 `=== 3`：最後一個打席可能是雙殺或三殺，出局數會超過 3。
 */
export function halfInningStatus(plays: Play[]): 'empty' | 'partial' | 'complete' {
  if (plays.length === 0) return 'empty'
  return halfInningOuts(plays) >= 3 ? 'complete' : 'partial'
}

/** 打席上的人怎麼稱呼。有背號就 `#24 張宏宇`，只有背號就 `#24`。 */
export function describeBatter(play: Play): string {
  return describePerson(play.batter)
}

/**
 * 「#24 張志豪」。打者與投手共用 —— 兩邊存的是同一種形狀，而「背號和姓名
 * 要怎麼湊成一句」在畫面上到處都要用（打席列表、半局賽況、AI 的提示詞）。
 */
export function describePerson(person: { name: string; number: string }): string {
  const { name, number } = person
  if (number && name) return `#${number} ${name}`
  if (number) return `#${number}`
  return name || '（未填）'
}

/**
 * 這半局的賽況，一句話。
 *
 * 「#24 三壘安打、#56 三振、#18 雙殺打（得 1 分）」—— 接在前台每一段
 * 影片底下，讓縮圖牆有文字內容，也讓人不用點開就知道那半局發生了什麼。
 */
export function describeHalfInning(plays: Play[]): string {
  if (plays.length === 0) return ''

  const parts = plays.map((play) => {
    const label = PLAY_RESULTS[play.result].label
    const runs = play.runs > 0 ? `（得 ${play.runs} 分）` : ''
    // 跑者出局記在「當時打擊中的人」身上，但出局的不是他 ——
    // 寫成「#9 跑者出局」會被讀成 9 號出局了
    if (!PLAY_RESULTS[play.result].plateAppearance) return `${label}${runs}`
    return `${describeBatter(play)} ${label}${runs}`
  })

  return parts.join('、')
}

/** 把一場的打席依比賽順序排好（同一個半局內維持登錄順序）。 */
export function sortPlays(plays: Play[]): Play[] {
  return [...plays].sort(
    (a, b) => halfInningOrder(a.inning, a.half) - halfInningOrder(b.inning, b.half),
  )
}

/**
 * 把一個半局的打席換掉，其餘半局原封不動。
 *
 * 寫入的粒度就是一個半局（見 `saveHalfInningPlays()`），所以這個合併規則
 * 前後端共用一份：前端拿它做樂觀更新，後端拿它算出要寫進資料庫的陣列。
 * 兩邊各寫一次的話，畫面上看到的和存進去的遲早會不一樣。
 */
export function replaceHalfInning(
  plays: Play[],
  inning: number,
  half: GameHalf,
  next: Play[],
): Play[] {
  const others = plays.filter((play) => !(play.inning === inning && play.half === half))
  // 送進來的 inning/half 以呼叫端指定的為準 —— 從別的半局複製貼上時，
  // 打席自己身上帶的座標可能還是舊的
  const normalized = next.map((play) => ({ ...play, inning, half }))
  return sortPlays([...others, ...normalized])
}

/**
 * 依結果決定打點的預設值。
 *
 * 只是輸入時的**預設**，不是規則 —— 登錄的人可以改（二壘安打清空壘包
 * 得 2 分就是 2 打點）。失誤、野手選擇、暴投推進回來的分數不算打點，
 * 所以那幾種預設 0，即使隊伍得了分。
 */
export function defaultRbi(result: PlayResult, runs: number): number {
  if (runs <= 0) return 0
  // 失誤、野手選擇推進回來的分數不算打點；雙殺打依規則也不給打點；
  // 跑者出局不是打席，沒有打者可以記
  const noRbi: PlayResult[] = [
    'reachedOnError',
    'fieldersChoice',
    'doublePlay',
    'triplePlay',
    'runnerOut',
    'other',
  ]
  return noRbi.includes(result) ? 0 : runs
}

/**
 * 登錄時的得分預設值：全壘打 1 分（打者自己跑回來），其餘 0。
 *
 * 壘上有人的話，登錄之後在那一筆上把得分往上調 —— 得分與打點都在打席
 * 列表上改，登錄前不必先想好（見 `adjustRuns()`）。
 */
export function defaultRuns(result: PlayResult): number {
  return result === 'homerun' ? 1 : 0
}

/**
 * 調整一筆打席的得分，打點跟著變。
 *
 * ## 打點什麼時候跟著得分動
 * 打點原本等於「照結果算出來的預設值」時，就跟著新的得分重算 —— 多數情況
 * 兩者一樣（兩人在壘的二壘安打：得 2 分、2 打點），不該要人調兩次。
 * 打點曾經被手動改過（不等於預設值）時就不動，那是使用者刻意的判斷。
 *
 * 範圍：得分 0～4，全壘打至少 1（打者自己一定回來）；打點不超過得分。
 */
export function adjustRuns(
  play: Pick<Play, 'result' | 'runs' | 'rbi'>,
  runs: number,
): { runs: number; rbi: number } {
  const min = play.result === 'homerun' ? 1 : 0
  const next = Math.min(Math.max(runs, min), 4)
  const followsDefault = play.rbi === defaultRbi(play.result, play.runs)
  const rbi = followsDefault ? defaultRbi(play.result, next) : Math.min(play.rbi, next)
  return { runs: next, rbi }
}

/** 調整打點：0～得分。一個打席的打點不可能比那個打席回來的分數多。 */
export function clampRbi(play: Pick<Play, 'runs'>, rbi: number): number {
  return Math.min(Math.max(rbi, 0), play.runs)
}
