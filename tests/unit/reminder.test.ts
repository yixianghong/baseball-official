import { describe, expect, it } from 'vitest'
import { dueReminders, reminderPayload, REMINDER_WINDOWS } from '../../shared/schemas/reminder'
import { daysBetweenDateKeys, taipeiDateKey, type Game } from '../../shared/schemas/game'

/**
 * 比賽自動提醒。
 *
 * 這是唯一一段「會主動送東西到別人手機上」的邏輯，而推播送出去收不回來。
 * 所以每一個邊界都列出來：時區、漏跑、重複執行、已經延賽的場次。
 */

const game = (id: string, date: string, extra: Partial<Game> = {}): Game =>
  ({
    id,
    date,
    time: '09:00',
    opponent: '藍鷹隊',
    venue: '市立棒球場',
    mapUrl: '',
    city: '',
    league: '',
    homeAway: 'home',
    status: 'scheduled',
    result: null,
    note: '',
    coverImageUrl: '',
    opponentLogoUrl: '',
    remindersSent: [],
    attendance: [],
    lineup: [],
    pitchers: [],
    scoreboard: {
      innings: [],
      totals: { our: { r: 0, h: 0, e: 0 }, opponent: { r: 0, h: 0, e: 0 } },
    },
    createdAt: '',
    updatedAt: '',
    ...extra,
  }) as Game

const TODAY = '2026-09-23'
const plus = (days: number) => {
  const date = new Date(Date.parse(`${TODAY}T00:00:00Z`) + days * 86_400_000)
  return date.toISOString().slice(0, 10)
}

describe('taipeiDateKey', () => {
  it('台北時間的凌晨仍算「今天」，不會退回前一天', () => {
    // 正式環境跑在 UTC 的 Cloud Run 上。台北 2026-09-23 01:00 = UTC 09-22 17:00，
    // 用伺服器本地日期會算成 9/22 —— 所有提醒整整差一天
    expect(taipeiDateKey(new Date('2026-09-22T17:00:00Z'))).toBe('2026-09-23')
  })

  it('台北時間的深夜還沒跨日', () => {
    expect(taipeiDateKey(new Date('2026-09-23T15:59:00Z'))).toBe('2026-09-23')
    expect(taipeiDateKey(new Date('2026-09-23T16:00:00Z'))).toBe('2026-09-24')
  })
})

describe('daysBetweenDateKeys', () => {
  it('算得出天數差，格式不對時回 null', () => {
    expect(daysBetweenDateKeys('2026-09-23', '2026-09-30')).toBe(7)
    expect(daysBetweenDateKeys('2026-09-23', '2026-09-22')).toBe(-1)
    expect(daysBetweenDateKeys('2026-09-23', '九月三十')).toBeNull()
  })
})

describe('dueReminders', () => {
  it('賽前一天送一則', () => {
    const due = dueReminders([game('g1', plus(1))], TODAY)
    expect(due).toHaveLength(1)
    expect(due[0]!.kind).toBe('d1')
  })

  it('賽前 3～7 天送早鳥提醒', () => {
    for (const days of [3, 5, 7]) {
      const due = dueReminders([game('g1', plus(days))], TODAY)
      expect(
        due.map((d) => d.kind),
        `${days} 天`,
      ).toEqual(['d7'])
    }
  })

  it('剩兩天以內不送早鳥提醒，交給賽前一天那則', () => {
    // 不然新增一場後天的比賽，會連兩天各收到一則講同一件事的通知
    expect(dueReminders([game('g1', plus(2))], TODAY)).toEqual([])
  })

  it('超過一週、今天、已經過去的比賽都不送', () => {
    for (const days of [8, 30, 0, -1]) {
      expect(dueReminders([game('g1', plus(days))], TODAY), `${days} 天`).toEqual([])
    }
  })

  it('送過的不會再送（排程器重試不會洗版）', () => {
    const sent = game('g1', plus(1), { remindersSent: ['d1'] })
    expect(dueReminders([sent], TODAY)).toEqual([])
  })

  it('送過早鳥提醒的，賽前一天仍然會再送一則', () => {
    const sent = game('g1', plus(1), { remindersSent: ['d7'] })
    expect(dueReminders([sent], TODAY).map((d) => d.kind)).toEqual(['d1'])
  })

  it('延賽、取消、已結束的場次不提醒', () => {
    // 提醒一場不會發生的比賽，比不提醒更糟
    for (const status of ['postponed', 'canceled', 'finished'] as const) {
      expect(dueReminders([game('g1', plus(1), { status })], TODAY), status).toEqual([])
    }
  })

  it('排程漏跑一天之後補跑，早鳥提醒仍然送得出去', () => {
    // 只認「剛好第 7 天」的話，漏跑那一次就永遠收不到了
    expect(REMINDER_WINDOWS.d7.min).toBeLessThan(REMINDER_WINDOWS.d7.max)
    expect(dueReminders([game('g1', plus(6))], TODAY).map((d) => d.kind)).toEqual(['d7'])
  })

  it('同一場同一天最多一則', () => {
    const due = dueReminders([game('g1', plus(1)), game('g2', plus(5))], TODAY)
    expect(due.map((d) => `${d.game.id}:${d.kind}`)).toEqual(['g1:d1', 'g2:d7'])
  })

  it('日期近的排前面', () => {
    const due = dueReminders([game('g1', plus(7)), game('g2', plus(1)), game('g3', plus(4))], TODAY)
    expect(due.map((d) => d.game.id)).toEqual(['g2', 'g3', 'g1'])
  })
})

describe('reminderPayload', () => {
  it('賽前一天講「明天幾點對戰誰」', () => {
    const payload = reminderPayload({ game: game('g1', plus(1)), kind: 'd1', days: 1 })
    expect(payload.title).toBe('明天 09:00 對戰 藍鷹隊')
    expect(payload.body).toBe('市立棒球場・主場')
    expect(payload.url).toBe('/games/g1')
  })

  it('早鳥提醒講的是實際還有幾天，不是寫死的 7', () => {
    // 區間是 3～7 天，寫死「7 天後」在第 5 天送出時就是錯的，而且收不回來
    const payload = reminderPayload({ game: game('g1', plus(5)), kind: 'd7', days: 5 })
    expect(payload.title).toBe('還有 5 天：對戰 藍鷹隊')
    expect(payload.body).toContain('9/28')
  })

  it('兩場不同比賽的 tag 不一樣', () => {
    // 同 tag 的通知會互相取代，共用一個 tag 會讓使用者只看得到其中一場
    const a = reminderPayload({ game: game('g1', plus(1)), kind: 'd1', days: 1 })
    const b = reminderPayload({ game: game('g2', plus(1)), kind: 'd1', days: 1 })
    expect(a.tag).not.toBe(b.tag)
  })

  it('對手名稱很長時標題不會超過上限', () => {
    const long = game('g1', plus(1), { opponent: '超'.repeat(40) })
    const payload = reminderPayload({ game: long, kind: 'd1', days: 1 })
    expect(payload.title!.length).toBeLessThanOrEqual(60)
  })
})
