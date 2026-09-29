import type { SeriesId } from '#shared/schemas/ws-bracket'

/**
 * 樹狀圖的座標（限期活動，見 `docs/ws-bracket.md`）。
 *
 * 用一組固定的設計座標 + 外層橫向捲動，**不用 CSS grid 也不隨螢幕改版面**。
 * 樹狀圖是一張「圖」，它的形狀本身就是資訊 —— 手機上把它折成一欄，
 * 「誰會碰到誰」這件事就沒了，而那正是這張圖唯一要講的事。
 * 所以只有一套版面，看不完的部分左右滑（拖曳到邊緣會自動捲，見 `useWsBetDrag`）。
 *
 * ⚠️ 這裡的排版**不是**照 MLB 官方宣傳圖一格一格複製的。官方那張把聯盟冠軍
 * 與世界大賽疊在中間的金色長條上，好看但看不出誰接誰；這裡改成標準的
 * 左右對開賽程樹（AL 由左往右、NL 由右往左、世界大賽在正中間），
 * 每一條連接線都對得上實際的晉級路徑。
 */

/** 菱形的邊框方塊尺寸。座標都是**中心點**，所以半徑是它的一半。 */
export const DIAMOND = 80
export const DIAMOND_R = DIAMOND / 2

/** 晉級者的菱形小一點，球隊的大一點 —— 大小本身就在說「這格是誰」。 */
export const WINNER_DIAMOND = 68
/** 世界大賽冠軍那一格最大。 */
export const CHAMPION_DIAMOND = 108

export const CANVAS = { width: 1160, height: 780 }

/** 各欄的中心 x。AL 由左往右推進，NL 鏡像。 */
const COL = { c1: 56, c2: 196, c3: 336, c4: 440 } as const
/**
 * 世界大賽在正中央（`CANVAS.width / 2`），左右才鏡像得起來。
 *
 * ⚠️ `c4`（聯盟冠軍）刻意比「每欄 140」的節奏更靠外一點：冠軍那一格最寬
 * （160px），照原本的間距排會和它橫向疊在一起。
 */
const WS_X = 580
const MIRROR = (x: number) => CANVAS.width - x

/**
 * 各列的中心 y。
 *
 * 同一欄的兩格之間至少要留一整格的高度（菱形 80 + 代碼 16 + 頭像列 28 = 124）——
 * 不同欄的格子在水平方向本來就錯開，所以上下半區之間不必留那麼多。
 * 這就是為什麼 `wcA1 → wcA2` 是 140，而 `wcA2 → ds2Seed` 只有 90。
 */
const ROW = {
  wcA1: 100,
  wcA2: 240,
  wcAWinner: 170,
  ds2Seed: 330,
  dsB: 250,
  wcB1: 440,
  wcB2: 580,
  wcBWinner: 510,
  ds1Seed: 670,
  dsA: 590,
  cs: 420,
} as const

export interface TeamSlotSpot {
  key: string
  series: SeriesId
  /** `0` = 高種子側，`1` = 低種子側（與 `BracketSeries.sides` 同序）。 */
  side: 0 | 1
  cx: number
  cy: number
  /**
   * 下注的頭像堆往哪一邊長。
   *
   * 一律朝**外**（AL 往左、NL 往右）：往內長的話會壓在連接線與晉級格上，
   * 而那兩樣東西正是使用者用來核對「我押的這隊打到哪了」的。
   */
  stack: 'left' | 'right'
}

export interface WinnerSpot {
  series: SeriesId
  cx: number
  cy: number
  size: number
}

/** 十二個下注位置。順序就是畫面上的 DOM 順序，也是 Tab 鍵的順序。 */
export const TEAM_SLOTS: readonly TeamSlotSpot[] = [
  // ── AL ──
  { key: 'F_1:1', series: 'F_1', side: 1, cx: COL.c1, cy: ROW.wcA1, stack: 'left' },
  { key: 'F_1:0', series: 'F_1', side: 0, cx: COL.c1, cy: ROW.wcA2, stack: 'left' },
  { key: 'D_2:0', series: 'D_2', side: 0, cx: COL.c2, cy: ROW.ds2Seed, stack: 'left' },
  { key: 'F_2:1', series: 'F_2', side: 1, cx: COL.c1, cy: ROW.wcB1, stack: 'left' },
  { key: 'F_2:0', series: 'F_2', side: 0, cx: COL.c1, cy: ROW.wcB2, stack: 'left' },
  { key: 'D_1:0', series: 'D_1', side: 0, cx: COL.c2, cy: ROW.ds1Seed, stack: 'left' },
  // ── NL ──
  { key: 'F_3:1', series: 'F_3', side: 1, cx: MIRROR(COL.c1), cy: ROW.wcA1, stack: 'right' },
  { key: 'F_3:0', series: 'F_3', side: 0, cx: MIRROR(COL.c1), cy: ROW.wcA2, stack: 'right' },
  { key: 'D_4:0', series: 'D_4', side: 0, cx: MIRROR(COL.c2), cy: ROW.ds2Seed, stack: 'right' },
  { key: 'F_4:1', series: 'F_4', side: 1, cx: MIRROR(COL.c1), cy: ROW.wcB1, stack: 'right' },
  { key: 'F_4:0', series: 'F_4', side: 0, cx: MIRROR(COL.c1), cy: ROW.wcB2, stack: 'right' },
  { key: 'D_3:0', series: 'D_3', side: 0, cx: MIRROR(COL.c2), cy: ROW.ds1Seed, stack: 'right' },
]

/** 晉級者的格子（賽前是「?」）。世界大賽那一格另外處理，它是唯一置中的。 */
export const WINNER_SPOTS: readonly WinnerSpot[] = [
  { series: 'F_1', cx: COL.c2, cy: ROW.wcAWinner, size: WINNER_DIAMOND },
  { series: 'F_2', cx: COL.c2, cy: ROW.wcBWinner, size: WINNER_DIAMOND },
  { series: 'D_2', cx: COL.c3, cy: ROW.dsB, size: WINNER_DIAMOND },
  { series: 'D_1', cx: COL.c3, cy: ROW.dsA, size: WINNER_DIAMOND },
  { series: 'L_1', cx: COL.c4, cy: ROW.cs, size: DIAMOND },
  { series: 'F_3', cx: MIRROR(COL.c2), cy: ROW.wcAWinner, size: WINNER_DIAMOND },
  { series: 'F_4', cx: MIRROR(COL.c2), cy: ROW.wcBWinner, size: WINNER_DIAMOND },
  { series: 'D_4', cx: MIRROR(COL.c3), cy: ROW.dsB, size: WINNER_DIAMOND },
  { series: 'D_3', cx: MIRROR(COL.c3), cy: ROW.dsA, size: WINNER_DIAMOND },
  { series: 'L_2', cx: MIRROR(COL.c4), cy: ROW.cs, size: DIAMOND },
]

export const CHAMPION_SPOT = {
  series: 'W_1' as SeriesId,
  cx: WS_X,
  cy: ROW.cs,
  size: CHAMPION_DIAMOND,
}

/**
 * 輪次標題：排在畫布最上緣，對齊該輪**晉級者**所在的那一欄。
 *
 * 放在上面而不是夾在欄與欄之間：中間那些空隙的高度不一樣，字塞進去之後
 * 有的貼著線、有的浮在半空，看起來像沒對齊。
 */
export const ROUND_TAGS: readonly { text: string; cx: number; cy: number }[] = [
  { text: 'AL 外卡', cx: COL.c2, cy: 26 },
  { text: 'ALDS', cx: COL.c3, cy: 26 },
  { text: 'ALCS', cx: COL.c4, cy: 26 },
  { text: '世界大賽', cx: WS_X, cy: 26 },
  { text: 'NLCS', cx: MIRROR(COL.c4), cy: 26 },
  { text: 'NLDS', cx: MIRROR(COL.c3), cy: 26 },
  { text: 'NL 外卡', cx: MIRROR(COL.c2), cy: 26 },
]

/**
 * 連接線。每一條是「從某一格的外緣，轉兩個直角，接到下一格的外緣」。
 *
 * 走 SVG 是因為它只是圖、不接任何手勢 —— CLAUDE.md 那條「Chrome 不理會
 * SVG 子元素上的 touch-action」的坑只發生在要在 SVG 上拖曳的時候。
 * 這一層蓋著 `pointer-events-none`，拖曳判斷靠 `elementFromPoint()` 打到
 * 底下的 HTML 格子。
 */
export function connectorPath(
  from: { cx: number; cy: number; size: number },
  to: { cx: number; cy: number; size: number },
): string {
  const dir = to.cx > from.cx ? 1 : -1
  const x1 = from.cx + (dir * from.size) / 2
  const x2 = to.cx - (dir * to.size) / 2
  const mid = (x1 + x2) / 2
  return `M ${x1} ${from.cy} H ${mid} V ${to.cy} H ${x2}`
}

/** 每一條線的兩端（由哪一格連到哪一格）。 */
export const CONNECTIONS: readonly [string, string][] = [
  // AL
  ['F_1:1', 'F_1'],
  ['F_1:0', 'F_1'],
  ['F_1', 'D_2'],
  ['D_2:0', 'D_2'],
  ['F_2:1', 'F_2'],
  ['F_2:0', 'F_2'],
  ['F_2', 'D_1'],
  ['D_1:0', 'D_1'],
  ['D_2', 'L_1'],
  ['D_1', 'L_1'],
  ['L_1', 'W_1'],
  // NL
  ['F_3:1', 'F_3'],
  ['F_3:0', 'F_3'],
  ['F_3', 'D_4'],
  ['D_4:0', 'D_4'],
  ['F_4:1', 'F_4'],
  ['F_4:0', 'F_4'],
  ['F_4', 'D_3'],
  ['D_3:0', 'D_3'],
  ['D_4', 'L_2'],
  ['D_3', 'L_2'],
  ['L_2', 'W_1'],
]

/** 把 `CONNECTIONS` 的字串鍵查回座標。找不到就是排版表寫錯了，直接讓它顯眼地壞掉。 */
export function spotByKey(key: string): { cx: number; cy: number; size: number } {
  const slot = TEAM_SLOTS.find((s) => s.key === key)
  if (slot) return { cx: slot.cx, cy: slot.cy, size: DIAMOND }
  const winner = WINNER_SPOTS.find((s) => s.series === key)
  if (winner) return { cx: winner.cx, cy: winner.cy, size: winner.size }
  if (key === 'W_1') return CHAMPION_SPOT
  throw new Error(`未知的樹狀圖座標：${key}`)
}
