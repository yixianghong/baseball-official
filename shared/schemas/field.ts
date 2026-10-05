import type { Position } from './player'
import { PLAY_RESULTS, type BattedType, type FieldPoint, type PlayResult } from './play'

/**
 * 球場的幾何：座標、區域、守備員站位，以及「放開在這裡時該給什麼選項」。
 *
 * 後台的拖曳登錄（`AdminFieldPicker`）與前台的落點圖（`GameSprayChart`）
 * **都只從這裡拿座標**，所以登錄時放在哪裡、圖上就畫在哪裡，不可能各算各的。
 *
 * ## 座標系統（和 `fieldPointSchema` 相同）
 * 本壘是原點，y 軸指向中外野，**全壘打牆的距離＝1**，x 正向是一壘側。
 * 牆簡化成一段半徑 1 的圓弧：業餘球場的牆本來就各不相同，而落點圖要回答
 * 的是「打向哪裡、打多遠」，不是精確的碼數。
 *
 * 換算成 SVG 時 y 要反過來（SVG 的 y 向下），見 `toSvg()`／`fromSvg()`。
 */

/** 界外線與中線的夾角（45°）。 */
export const FOUL_ANGLE = Math.PI / 4

/**
 * 內野紅土的外緣。以全壘打牆約 107 公尺（350 英呎）估算，紅土邊緣約
 * 在本壘前方 47 公尺，所以是 0.44。只用來分「內野／外野」兩個區域。
 */
export const INFIELD_RADIUS = 0.44

/**
 * 離守備員多近算「打向他」。
 *
 * 超過這個距離的外野落點被當成**空檔**，選單會把安打排在前面。
 * 值是用手機寬度實際拖過調出來的：太小的話打在外野手面前一步的飛球
 * 會被當成空檔，太大的話左中外野的深遠安打會被當成飛球出局。
 */
export const NEAR_FIELDER = 0.15

/** 壘包位置（壘間 90 英呎 ≈ 0.257）。只用來畫圖。 */
export const BASES = {
  home: { x: 0, y: 0 },
  first: { x: 0.182, y: 0.182 },
  second: { x: 0, y: 0.364 },
  third: { x: -0.182, y: 0.182 },
} as const

/**
 * 九個守備員的**標準站位**。
 *
 * ⚠️ 只用來「預選最近的人」與畫圖示，**不代表球被誰接到**。守備站位會
 * 移動（shift），實際是誰處理的由登錄的人在選單上確認 —— 落點與處理的人
 * 是分開存的（見 `playSchema.fielder`）。
 */
export const FIELDER_SPOTS: Record<Exclude<Position, 'DH'>, FieldPoint> = {
  P: { x: 0, y: 0.173 },
  // 比真實位置再往後一點：本壘周圍要留給打擊區與那顆拖曳用的球
  C: { x: 0, y: -0.085 },
  '1B': { x: 0.25, y: 0.3 },
  '2B': { x: 0.13, y: 0.42 },
  SS: { x: -0.13, y: 0.42 },
  '3B': { x: -0.25, y: 0.3 },
  LF: { x: -0.43, y: 0.72 },
  CF: { x: 0, y: 0.86 },
  RF: { x: 0.43, y: 0.72 },
}

/** 球場上守備員圖示裡的單字。比 `1B`、`SS` 好認，而且一格放得下。 */
export const FIELDER_SHORT: Record<Exclude<Position, 'DH'>, string> = {
  P: '投',
  C: '捕',
  '1B': '一',
  '2B': '二',
  SS: '游',
  '3B': '三',
  LF: '左',
  CF: '中',
  RF: '右',
}

export type FieldZone = 'foul' | 'infield' | 'outfield' | 'beyond'

export const ZONE_LABELS: Record<FieldZone, string> = {
  foul: '界外',
  infield: '內野',
  outfield: '外野',
  beyond: '全壘打牆外',
}

/**
 * 這個點落在哪一區。
 *
 * 界外優先判斷：本壘後方（y < 0）以及超過界外線的角度都是界外 ——
 * 包括牆外的界外，那是界外球不是全壘打。
 */
export function zoneOf(point: FieldPoint): FieldZone {
  const angle = Math.atan2(point.x, point.y)
  if (point.y < 0 || Math.abs(angle) > FOUL_ANGLE) return 'foul'

  const distance = Math.hypot(point.x, point.y)
  if (distance >= 1) return 'beyond'
  return distance < INFIELD_RADIUS ? 'infield' : 'outfield'
}

/** 離這個點最近的守備員，以及距離。 */
export function nearestFielder(point: FieldPoint): { position: Position; distance: number } {
  let best: { position: Position; distance: number } = { position: 'P', distance: Infinity }
  for (const [position, spot] of Object.entries(FIELDER_SPOTS)) {
    const distance = Math.hypot(point.x - spot.x, point.y - spot.y)
    if (distance < best.distance) best = { position: position as Position, distance }
  }
  return best
}

/**
 * 放開在這裡時，選單上的結果要怎麼排。
 *
 * 排序而不是過濾：規則猜錯的時候（例如打向外野手但他沒接到），使用者
 * 還是要選得到正確的那一個，只是要多看一眼。過濾掉的話就只能取消重拖。
 * 選單只顯示前幾個，其餘收進「更多」。
 */
export function suggestResults(point: FieldPoint): PlayResult[] {
  const zone = zoneOf(point)

  if (zone === 'beyond') return ['homerun']

  // 界外區只有界外飛球出局能構成打席結果 —— 界外滾地、沒接到的界外飛球
  // 都只是一個好球，打席還沒結束
  if (zone === 'foul') return ['foulout', 'reachedOnError']

  const near = nearestFielder(point).distance <= NEAR_FIELDER

  /*
   * ⚠️ **前六個就是選單第一層**（`AdminLandingSheet` 切在那裡），所以那六格
   * 要留給**真的常按的那幾種**：安打、滾地球出局、飛球出局、失誤上壘。
   *
   * 內野原本把「雙殺打、野手選擇」排在第 2、3 格，而**一壘安打排到第 7**
   * —— 也就是內野安打每次都要先點「更多結果」。雙殺打一場頂多一兩次，
   * 內野安打比它常見得多。少見但合法的結果照樣在第二層，一個都沒有過濾掉
   * （這條規則沒有變）。
   *
   * 區域還是會影響順序 —— 球落在內野時「滾地球出局」排第一、落在外野空檔時
   * 「安打」排第一 —— 但**不會把常用的那幾種擠出第一層**。
   */
  if (zone === 'infield') {
    return [
      'groundout',
      // 安打排在一起：分開的話要在六顆按鈕之間找第二顆
      'single',
      'double',
      'flyout',
      'lineout',
      'reachedOnError',
      // ── 以下第二層 ──
      'doublePlay',
      'fieldersChoice',
      'sacrificeBunt',
      'triple',
      'triplePlay',
    ]
  }

  if (near) {
    return [
      'flyout',
      'single',
      'double',
      'lineout',
      'reachedOnError',
      'sacrificeFly',
      // ── 以下第二層 ──
      'triple',
      'doublePlay',
    ]
  }

  // 外野空檔：安打排前面
  return [
    'single',
    'double',
    'triple',
    'flyout',
    'lineout',
    'reachedOnError',
    // ── 以下第二層 ──
    'homerun',
    'sacrificeFly',
  ]
}

/**
 * 安打的擊球類型預設值：內野滾地、外野平飛、牆外高飛。
 *
 * 只是**預設**，選單上可以改。給預設值是為了讓多數情況不必多點一下 ——
 * 多一個每次都要點的欄位，就是當初「欄位越多越沒人填」的那個理由。
 */
export function defaultBatted(point: FieldPoint): BattedType {
  const zone = zoneOf(point)
  if (zone === 'infield') return 'ground'
  if (zone === 'outfield') return 'line'
  return 'fly'
}

/**
 * 沒有落點的結果 —— 放在本壘旁邊那一排按鈕，點一下就好，不用拖。
 *
 * 三振與保送佔一場打席的三成以上，每次都拖到投手身上會變慢，而且
 * 「投手前滾地」是真的會拖到投手的情況，兩者混在同一個選單裡很容易點錯。
 */
export const NO_LANDING_RESULTS = ['strikeout', 'walk', 'hitByPitch', 'runnerOut', 'other'] as const

/**
 * 這個結果要不要記「處理的人」。
 *
 * 出局、失誤、野選才有人處理球；穿越的安打與全壘打沒有。
 */
export function needsFielder(result: PlayResult): boolean {
  if ((NO_LANDING_RESULTS as readonly string[]).includes(result)) return false
  const meta = PLAY_RESULTS[result]
  return meta.outs > 0 || result === 'reachedOnError' || result === 'fieldersChoice'
}

/**
 * 這個結果要不要問擊球類型。
 *
 * 只有安打與失誤上壘 —— 出局的類型從結果就推得出來（`battedTypeOf()`），
 * 再問一次就是存兩份會對不上的資料。
 */
export function needsBattedType(result: PlayResult): boolean {
  return PLAY_RESULTS[result].hit || result === 'reachedOnError'
}

/**
 * 存進資料庫之前的落點：取到小數第三位，並夾在 schema 的範圍內。
 *
 * 第三位大約是 10 公分，比任何人的手指都準；多存的位數只是雜訊。
 * 夾範圍是因為拖到 SVG 的邊緣外面一點點也會算進來，而 schema 會把
 * 超出範圍的整筆打席擋掉。
 */
export function roundPoint(point: FieldPoint): FieldPoint {
  const round = (value: number, min: number, max: number) =>
    Math.round(Math.min(Math.max(value, min), max) * 1000) / 1000
  return { x: round(point.x, -1.5, 1.5), y: round(point.y, -0.3, 1.5) }
}

// ── SVG ─────────────────────────────────────────────────────────

/**
 * 球場 SVG 的 `viewBox`。
 *
 * 左右留到 ±0.9（界外飛球的空間），上方留到牆外 0.15（全壘打的落點），
 * 下方留到本壘後方 0.12（捕手與打擊區）。長寬比約 1.42，在 360px 寬的
 * 手機上高度約 254px，二壘手與游擊手的圖示中心相距約 52px —— 手指點得開。
 */
export const FIELD_VIEWBOX = { x: -0.9, y: -1.15, width: 1.8, height: 1.27 } as const

/**
 * 這個點在畫出來的球場範圍內嗎。
 *
 * 拖到球場外面放開＝取消。這是使用者唯一的「反悔」手勢 —— 已經拖出去
 * 才發現選錯打者的時候，拖回外面放掉就好，不必等選單跳出來再按取消。
 */
export function isInsideField(point: FieldPoint): boolean {
  const { x, y, width, height } = FIELD_VIEWBOX
  const svg = toSvg(point)
  return svg.x >= x && svg.x <= x + width && svg.y >= y && svg.y <= y + height
}

export function viewBoxString(): string {
  const { x, y, width, height } = FIELD_VIEWBOX
  return `${x} ${y} ${width} ${height}`
}

/** 球場座標 → SVG 座標（y 反向）。 */
export function toSvg(point: FieldPoint): { x: number; y: number } {
  return { x: point.x, y: -point.y }
}

/** SVG 座標 → 球場座標。 */
export function fromSvg(point: { x: number; y: number }): FieldPoint {
  return { x: point.x, y: -point.y }
}

/** 全壘打牆（半徑 1、±45°）的 SVG path。 */
export function fencePath(): string {
  const corner = Math.SQRT1_2
  return `M ${-corner} ${-corner} A 1 1 0 0 1 ${corner} ${-corner}`
}

/** 內野紅土（扇形）的 SVG path。 */
export function infieldPath(): string {
  const r = INFIELD_RADIUS
  const corner = r * Math.SQRT1_2
  return `M 0 0 L ${-corner} ${-corner} A ${r} ${r} 0 0 1 ${corner} ${-corner} Z`
}

/** 整個場內（界內到牆）的 SVG path。 */
export function fairTerritoryPath(): string {
  const corner = Math.SQRT1_2
  return `M 0 0 L ${-corner} ${-corner} A 1 1 0 0 1 ${corner} ${-corner} Z`
}
