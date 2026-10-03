import { z } from 'zod'

/**
 * 「第幾局的哪半局」這個座標，以及由它推導出來的東西。
 *
 * ## 為什麼獨立成一個檔案
 * 半局是這個專案裡**三份資料共用的身分**：計分板的一格、一段錄影
 * （`gameClipSchema`）、一批逐打席紀錄（`playSchema`）。原本這些定義住在
 * `game.ts` 裡，但 `play.ts` 需要它們、而 `game.ts` 又需要 `play.ts`
 * （`gameSchema.plays`）—— 留在原地就是一個循環 import。
 *
 * 所以相依方向排成一條線：
 *
 * ```
 * half-inning.ts   ← 不相依任何東西
 * play.ts          ← import half-inning
 * game.ts          ← import half-inning + play
 * box-score.ts     ← import game + play
 * ```
 *
 * `game.ts` 會把這個檔案的匯出**原樣再匯出一次**，所以全站既有的
 * `import { battingSide } from '#shared/schemas/game'` 完全不受影響。
 */

/** 主客場。 */
export const homeAwaySchema = z.enum(['home', 'away'])
export type HomeAway = z.infer<typeof homeAwaySchema>

/**
 * 上半局／下半局。
 *
 * ## 為什麼這裡存 `top`／`bottom`，而計分板存 `our`／`opponent`
 * 看起來矛盾，但兩者記的是不同的事實：
 *
 * - 計分板記的是「**我隊**這局得幾分」——「幾分」天生屬於某一隊，
 *   上下半局是由 `homeAway` 推導出來的呈現方式（見 `scoreboardSchema`）。
 * - 錄影片段與逐打席紀錄記的是「這發生在**第幾局的哪半局**」——那是當下的
 *   物理事實，和誰在打擊無關。
 *
 * 這個差別在 `homeAway` 填錯又改回來的時候才看得出來：存 `our`／`opponent`
 * 的計分板會跟著修正（正確），而存 `top`／`bottom` 的影片標籤不會跟著變
 * （也正確 —— 你當時拍的就是上半局）。反過來存的話兩邊都會錯。
 */
export const gameHalfSchema = z.enum(['top', 'bottom'])
export type GameHalf = z.infer<typeof gameHalfSchema>

export const HALF_LABELS: Record<GameHalf, string> = {
  top: '上',
  bottom: '下',
}

/** 依比賽順序。要把一局展開成兩個半局時用它，不要各處自己寫陣列。 */
export const GAME_HALVES = ['top', 'bottom'] as const

/**
 * 這半局是哪一隊在打擊。**客隊先攻**，所以上半局打擊的是客隊。
 *
 * 前台與後台都要講得出「第 3 局上」是誰在攻 —— 在球場邊按錄影按鈕、
 * 或在逐局紀錄頁登錄打席的人看的是場上，而不是記得自己是主場還是客場。
 */
export function battingSide(half: GameHalf, homeAway: HomeAway): 'our' | 'opponent' {
  return (half === 'top') === (homeAway === 'away') ? 'our' : 'opponent'
}

/**
 * 坐哪一邊的休息室。**先攻在三壘側、後攻在一壘側**（大會的規定）。
 *
 * 推導而不是存欄位：它完全由 `homeAway` 決定，多存一份就多一個會不同步的東西
 * （和 `gameResult()`、`deriveBench()` 同一條原則）。賽前在群組問「我們坐哪邊」
 * 很常見，所以前台的比賽頁直接寫出來。
 */
export function dugoutLabel(homeAway: HomeAway): string {
  return homeAway === 'away' ? '三壘休息室' : '一壘休息室'
}

/**
 * 計分板由上而下的兩列。**上面那列是先攻**，也就是打上半局的那一方。
 *
 * 資料層存的是「我隊／對手」，不存上下半局（見 `game.ts` 開頭的說明），
 * 所以要呈現成計分板的時候得自己排。**前台與後台一定要用同一支函式**：
 * 各寫各的結果是後台永遠「我隊在上」、前台依主客場換位，同一場比賽兩邊
 * 長得不一樣 —— 而計分板正是要拿來核對的東西，順序相反看起來就像資料被改過。
 *
 * 直接由 `battingSide()` 推導，連「客隊先攻」這條規則也只寫在一個地方。
 */
export function scoreboardSides(homeAway: HomeAway): ['our' | 'opponent', 'our' | 'opponent'] {
  return [battingSide('top', homeAway), battingSide('bottom', homeAway)]
}

/**
 * 「A vs B」要排成什麼順序：**先攻的寫在前面**。
 *
 * 和計分板（`scoreboardSides()`）是**同一條規則的同一個來源** —— 直接建在它
 * 上面，所以「客隊先攻」這件事全站只寫在 `battingSide()` 一個地方。
 *
 * 大會的賽程表就是這樣寫的（前者攻方／三壘休息區、後者守方／一壘休息區），
 * 而賽程辨識也是照這個順序讀回來的（`resolveMatchup()`）。
 * ⚠️ 卡片上固定寫成「我隊 vs 對手」的話，**同一場比賽在大會的表上和我們的網站
 * 上順序相反** —— 而那正是球員拿來對照的東西，看起來就像排錯場次。
 *
 * 泛型是為了讓呼叫端傳什麼都行：只要隊名時傳字串，要連隊徽一起排時傳物件。
 */
export function matchupOrder<T>(homeAway: HomeAway, our: T, opponent: T): [T, T] {
  const [first, second] = scoreboardSides(homeAway)
  const pick = (side: 'our' | 'opponent') => (side === 'our' ? our : opponent)
  return [pick(first), pick(second)]
}

/**
 * 把半局排成比賽順序用的序數。第 3 局上 < 第 3 局下 < 第 4 局上。
 *
 * 排序與「哪一個半局比較後面」的比較都走它 —— 各處自己寫
 * `inning * 2 + (half === 'bottom' ? 1 : 0)` 的話，遲早有一處把上下寫反，
 * 而那種錯誤在只看單一半局時完全看不出來。
 */
export function halfInningOrder(inning: number, half: GameHalf): number {
  return inning * 2 + (half === 'bottom' ? 1 : 0)
}

/** 「第 3 局上」。標題、aria-label、檔名以外的地方都用它。 */
export function halfInningLabel(inning: number, half: GameHalf): string {
  return `第 ${inning} 局${HALF_LABELS[half]}`
}
