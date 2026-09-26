import { describe, expect, it } from 'vitest'
import type { AttendanceEntry } from '../../shared/schemas/game'
import type { Player } from '../../shared/schemas/player'
import { mergeAttendanceWithRoster } from '../../app/utils/attendance'

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
