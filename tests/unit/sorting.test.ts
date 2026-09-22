import { describe, expect, it } from 'vitest'
import { comparePlayers, describeHands, type Player } from '../../shared/schemas/player'
import { compareAnnouncements, type Announcement } from '../../shared/schemas/announcement'

/**
 * 排序規則。
 *
 * 這兩個比較函式定義在 `shared/`，被前台、後台與 BFF 共用 —— 正是因為
 * 排序若各寫各的，使用者就會在不同畫面看到不同的排列順序。
 */

function player(overrides: Partial<Player>): Player {
  return {
    id: 'x',
    number: '1',
    name: '球員',
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

describe('comparePlayers', () => {
  it('sortOrder 優先於背號', () => {
    const a = player({ sortOrder: 1, number: '99' })
    const b = player({ sortOrder: 2, number: '1' })
    expect([b, a].sort(comparePlayers)[0]).toBe(a)
  })

  it('背號以數值大小排序，而不是字串', () => {
    // 字串排序會把 '10' 排在 '9' 前面
    const nine = player({ number: '9' })
    const ten = player({ number: '10' })
    expect([ten, nine].sort(comparePlayers)[0]).toBe(nine)
  })

  it('沒有背號的球員排在最後', () => {
    const withNumber = player({ number: '99' })
    const without = player({ number: '' })
    expect([without, withNumber].sort(comparePlayers)[0]).toBe(withNumber)
  })
})

function announcement(overrides: Partial<Announcement>): Announcement {
  return {
    id: 'x',
    title: '公告',
    content: '內容',
    category: 'general',
    pinned: false,
    status: 'published',
    publishedAt: '2026-01-01T00:00:00.000Z',
    coverImageUrl: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('compareAnnouncements', () => {
  it('置頂的永遠排在最前面，即使比較舊', () => {
    const pinnedOld = announcement({ pinned: true, publishedAt: '2026-01-01T00:00:00.000Z' })
    const newer = announcement({ publishedAt: '2026-06-01T00:00:00.000Z' })
    expect([newer, pinnedOld].sort(compareAnnouncements)[0]).toBe(pinnedOld)
  })

  it('同為置頂時依發布時間新到舊', () => {
    const older = announcement({ pinned: true, publishedAt: '2026-01-01T00:00:00.000Z' })
    const newer = announcement({ pinned: true, publishedAt: '2026-06-01T00:00:00.000Z' })
    expect([older, newer].sort(compareAnnouncements)[0]).toBe(newer)
  })

  it('沒有發布時間時退回建立時間', () => {
    const noPublished = announcement({ publishedAt: '', createdAt: '2026-06-01T00:00:00.000Z' })
    const older = announcement({ publishedAt: '2026-01-01T00:00:00.000Z' })
    expect([older, noPublished].sort(compareAnnouncements)[0]).toBe(noPublished)
  })
})

describe('describeHands', () => {
  it.each([
    ['R', 'R', '右投右打'],
    ['L', 'L', '左投左打'],
    ['R', 'L', '右投左打'],
    ['L', 'R', '左投右打'],
  ] as const)('%s 投 %s 打 → %s', (throwsWith, batsWith, expected) => {
    expect(describeHands(throwsWith, batsWith)).toBe(expected)
  })

  it.each([
    ['R', '右投左右開弓'],
    ['L', '左投左右開弓'],
  ] as const)('左右開弓不會變成「…左右開弓打」（%s 投）', (throwsWith, expected) => {
    // 單純把兩個標籤串起來會得到「右投左右開弓打」，讀不通
    expect(describeHands(throwsWith, 'S')).toBe(expected)
  })
})
