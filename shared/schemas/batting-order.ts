import type { LineupEntry } from './game'
import { battingSide, halfInningOrder, type GameHalf, type HomeAway } from './half-inning'
import { PLAY_RESULTS, sortPlays, type Play } from './play'

/**
 * 打線在某個半局開始時（或進行到一半時）的狀態：每一棒現在是誰、輪到第幾棒。
 *
 * ## 為什麼是推導的
 * 代打會永久換掉那一棒，但 `lineup` 是賽前的名單（出賽名單圖卡印的就是它），
 * 不能改。所以「第 5 棒現在是誰」＝**最後一個記在第 5 棒的打席的打者**，
 * 沒有就是先發。和候補名單、勝敗、逐局得分同一條紀律：推導得出來就不另存。
 *
 * ## 只看「這個半局為止」的打席
 * 回頭修改第 2 局時，第 5 局已經登錄的打席不能算進來 —— 否則回到前面的
 * 半局，畫面上輪到的打者會是第 5 局之後的那一位。
 *
 * ## ⚠️ 只有「打席」會換棒
 * 跑者出局（盜壘失敗、牽制）發生在打席**之間**，打擊區上的人還沒打完。
 * 所以輪棒只數 `plateAppearance` 為 true 的結果 —— 跑者出局之後，
 * 下一筆還是同一個人。三出局是跑者出局造成的話，他下一局當首棒，
 * 這也自然成立。
 */

export interface SlotState {
  /** 第幾棒（`lineup` 的 `order`）。 */
  slot: number
  /** 賽前名單上的先發。 */
  starter: Pick<LineupEntry, 'playerId' | 'name' | 'number' | 'position'>
  /** 現在站這一棒的人。被代打過就是代打的人。 */
  current: Play['batter']
  /** 這一棒是不是已經被代打換掉了。 */
  substituted: boolean
}

export interface BattingOrderState {
  slots: SlotState[]
  /** 照打線應該輪到第幾棒。打線是空的、或這半局不是我隊打擊時為 `null`。 */
  nextSlot: number | null
}

function samePerson(a: Play['batter'], b: Play['batter']): boolean {
  if (a.playerId && b.playerId) return a.playerId === b.playerId
  return a.name.trim() === b.name.trim() && a.number === b.number
}

export function battingOrderAt(
  game: { plays: Play[]; homeAway: HomeAway; lineup: LineupEntry[] },
  inning: number,
  half: GameHalf,
): BattingOrderState {
  const lineup = [...game.lineup].sort((a, b) => a.order - b.order)
  const slots: SlotState[] = lineup.map((entry) => {
    const starter = {
      playerId: entry.playerId,
      name: entry.name,
      number: entry.number,
      position: entry.position,
    }
    return {
      slot: entry.order,
      starter,
      current: { playerId: entry.playerId, name: entry.name, number: entry.number },
      substituted: false,
    }
  })

  if (battingSide(half, game.homeAway) !== 'our' || slots.length === 0) {
    return { slots, nextSlot: null }
  }

  const limit = halfInningOrder(inning, half)
  const ours = sortPlays(game.plays).filter(
    (play) =>
      battingSide(play.half, game.homeAway) === 'our' &&
      halfInningOrder(play.inning, play.half) <= limit,
  )

  // 誰站在哪一棒：最後一個記在那一棒的人（包含跑者出局 —— 那也是他）
  for (const play of ours) {
    const slot = slots.find((item) => item.slot === play.battingSlot)
    if (!slot) continue
    slot.current = { ...play.batter }
    slot.substituted = !samePerson(play.batter, {
      playerId: slot.starter.playerId,
      name: slot.starter.name,
      number: slot.starter.number,
    })
  }

  // 輪到第幾棒：只看真的打完的打席
  const appearances = ours.filter((play) => PLAY_RESULTS[play.result].plateAppearance)
  const last = appearances.at(-1)

  if (!last) return { slots, nextSlot: slots[0]!.slot }

  const lastIndex = slots.findIndex((item) => item.slot === last.battingSlot)
  if (lastIndex >= 0) {
    return { slots, nextSlot: slots[(lastIndex + 1) % slots.length]!.slot }
  }

  // 舊資料沒有記第幾棒：退回數打席
  return { slots, nextSlot: slots[appearances.length % slots.length]!.slot }
}

/** 這個人現在站第幾棒（語音辨識出來的打者用它補上棒次）。找不到回 `null`。 */
export function slotOfBatter(slots: SlotState[], batter: Play['batter']): number | null {
  const found = slots.find((item) =>
    batter.playerId
      ? item.current.playerId === batter.playerId
      : batter.number !== '' && item.current.number === batter.number,
  )
  return found?.slot ?? null
}
