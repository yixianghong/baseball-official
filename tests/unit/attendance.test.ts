import { describe, expect, it } from 'vitest'
import type { AttendanceEntry } from '../../shared/schemas/game'
import type { Player } from '../../shared/schemas/player'
import {
  attendanceLocked,
  formatLockAt,
  mergeAttendanceWithRoster,
} from '../../shared/schemas/attendance'
import {
  applyAttendanceAnswer,
  selfReportStatusSchema,
} from '../../shared/schemas/attendance-request'

/**
 * 把現役球員補進出席名單。
 *
 * 這支函式被呼叫兩次（頁面灌資料時、編輯器掛載時），而**兩次必須算出完全
 * 一樣的結果** —— 那是「打開一場還沒登記出席的比賽不會寫入資料庫」的唯一
 * 依據。以前補名單只在編輯器裡做，發生在自動儲存取基準之後，於是光是開頁面
 * 就會把 11 筆「未回覆」寫進資料庫。
 */

function player(id: string, name: string, overrides: Partial<Player> = {}): Player {
  return {
    id,
    number: id.replace('p', ''),
    name,
    positions: ['P'],
    bats: 'R',
    throws: 'R',
    joinedYear: null,
    bio: '',
    photoUrl: '',
    status: 'active',
    sortOrder: 0,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  }
}

const players = [
  player('p1', '陳冠宇'),
  player('p2', '林建良'),
  player('p3', '退隊的人', { status: 'inactive' }),
]

const entry = (playerId: string, name: string, status: AttendanceEntry['status']) => ({
  playerId,
  name,
  number: playerId.replace('p', ''),
  status,
  note: '',
})

describe('mergeAttendanceWithRoster', () => {
  it('名單是空的時候帶入現役球員，狀態為未回覆', () => {
    const merged = mergeAttendanceWithRoster([], players)

    expect(merged.map((item) => item.name)).toEqual(['陳冠宇', '林建良'])
    expect(merged.every((item) => item.status === 'pending')).toBe(true)
  })

  it('不會把已經登記過的回覆洗掉', () => {
    const merged = mergeAttendanceWithRoster([entry('p2', '林建良', 'yes')], players)

    // 排序跟著球員名單走，所以林建良仍然在第二個
    expect(merged.map((item) => [item.name, item.status])).toEqual([
      ['陳冠宇', 'pending'],
      ['林建良', 'yes'],
    ])
  })

  it('退隊的人不會被加進來，但先前登記過的保留在最後', () => {
    const merged = mergeAttendanceWithRoster([entry('p3', '退隊的人', 'yes')], players)

    expect(merged.map((item) => item.name)).toEqual(['陳冠宇', '林建良', '退隊的人'])
  })

  it('補過一次之後再補一次結果完全相同（打開頁面不會寫入資料庫的依據）', () => {
    const once = mergeAttendanceWithRoster([], players)
    const twice = mergeAttendanceWithRoster(once, players)

    // 不是「長度一樣」而是「整份一模一樣」—— 編輯器靠 JSON 比對決定不寫回 model
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once))
  })
})

describe('applyAttendanceAnswer', () => {
  const entries = [
    { playerId: 'p1', name: '王大明', number: '1', status: 'pending' as const, note: '' },
    { playerId: 'p2', name: '林建良', number: '2', status: 'yes' as const, note: '晚到' },
  ]

  it('只改那個人的狀態', () => {
    const next = applyAttendanceAnswer(entries, { playerId: 'p1', status: 'yes' })

    expect(next?.[0]).toMatchObject({ playerId: 'p1', status: 'yes' })
    expect(next?.[1]).toEqual(entries[1])
  })

  it('⚠️ 名單上沒有這個人就回 null —— 這支端點不能把人加進名單', () => {
    // 它沒有登入驗證，能加人的話就變成一支匿名的任意寫入
    expect(applyAttendanceAnswer(entries, { playerId: 'ghost', status: 'yes' })).toBeNull()
  })

  it('⚠️ 不動姓名、背號與備註 —— 自由文字只有後台填得了', () => {
    const next = applyAttendanceAnswer(entries, { playerId: 'p2', status: 'no' })

    expect(next?.[1]).toEqual({ ...entries[1], status: 'no' })
  })

  it('不改動傳進來的陣列，順序也不動', () => {
    const next = applyAttendanceAnswer(entries, { playerId: 'p2', status: 'no' })

    expect(entries[1]!.status).toBe('yes')
    expect(next?.map((entry) => entry.playerId)).toEqual(['p1', 'p2'])
  })
})

describe('selfReportStatusSchema', () => {
  it('收得下三個真正的答案', () => {
    for (const status of ['yes', 'no', 'maybe']) {
      expect(selfReportStatusSchema.safeParse(status).success).toBe(true)
    }
  })

  it('⚠️ 不收 pending —— 它是「還沒回覆」，不是一個答案', () => {
    // 做成可以選的話，名單上會出現「他按了未回覆」與「他還沒按」兩種
    // 長得一模一樣、意思卻不同的情況
    expect(selfReportStatusSchema.safeParse('pending').success).toBe(false)
  })
})

describe('attendanceLocked', () => {
  /** 台北時間 2026-10-09 18:30 的那一刻（UTC 是 10:30）。 */
  const now = new Date('2026-10-09T10:30:00Z')

  it('沒設截止時間、還沒開打 → 開著', () => {
    expect(attendanceLocked({ status: 'scheduled', attendanceLockAt: '' }, now)).toBe(false)
  })

  it('⚠️ 開打就鎖，而且關不掉 —— 那份名單已經是歷史紀錄', () => {
    for (const status of ['live', 'finished', 'postponed', 'canceled'] as const) {
      expect(attendanceLocked({ status, attendanceLockAt: '' }, now)).toBe(true)
    }
  })

  it('截止時間還沒到 → 開著；到了（含剛好那一分鐘）→ 鎖住', () => {
    const at = (value: string) =>
      attendanceLocked({ status: 'scheduled', attendanceLockAt: value }, now)

    expect(at('2026-10-09T18:31')).toBe(false)
    expect(at('2026-10-09T18:30')).toBe(true)
    expect(at('2026-10-09T18:29')).toBe(true)
    expect(at('2026-10-10T09:00')).toBe(false)
  })

  it('⚠️ 比的是台北時間，不是伺服器的 UTC', () => {
    /*
     * Cloud Run 跑在 UTC。台北時間 00:00–07:59 這八小時裡伺服器還停在前一天
     * —— 用 UTC 去比，截止時間會整整差八小時，而本機（就是台北時間）
     * 完全重現不了。
     */
    const taipeiMidnight = new Date('2026-10-09T16:00:00Z') // 台北 10/10 00:00

    expect(
      attendanceLocked(
        { status: 'scheduled', attendanceLockAt: '2026-10-09T23:00' },
        taipeiMidnight,
      ),
    ).toBe(true)
    expect(
      attendanceLocked(
        { status: 'scheduled', attendanceLockAt: '2026-10-10T09:00' },
        taipeiMidnight,
      ),
    ).toBe(false)
  })
})

describe('formatLockAt', () => {
  it('寫成畫面上看得懂的樣子', () => {
    expect(formatLockAt('2026-10-09T18:30')).toBe('10/9 18:30')
  })

  it('格式不認得就原樣回傳，不要變成 Invalid Date', () => {
    expect(formatLockAt('')).toBe('')
    expect(formatLockAt('亂寫')).toBe('亂寫')
  })
})
