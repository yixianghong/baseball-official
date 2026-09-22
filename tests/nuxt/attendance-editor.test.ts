// @vitest-environment nuxt
import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import type { AttendanceEntry } from '../../shared/schemas/game'
import type { Player } from '../../shared/schemas/player'
import AttendanceEditor from '../../app/components/admin/AttendanceEditor.vue'

/**
 * 出席名單會自動跟著現役球員走。
 *
 * 原本這是兩顆按鈕（「帶入現役名單」「同步現役名單」），但它們永遠只有一個
 * 正確答案 —— 進到這一頁就是要登記今天誰會來，名單當然要先在那裡。
 * 需要先按一下才看得到隊員，那一步沒有任何決定可言。
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

/** 掛載元件並回傳它最後寫回 v-model 的內容。 */
async function mountWith(initial: AttendanceEntry[]) {
  let current = initial
  await mountSuspended(AttendanceEditor, {
    props: {
      players,
      modelValue: current,
      'onUpdate:modelValue': (value: AttendanceEntry[]) => {
        current = value
      },
    },
  })
  return () => current
}

describe('AttendanceEditor 自動帶入名單', () => {
  it('名單是空的時候自動帶入現役球員，狀態為未回覆', async () => {
    const result = await mountWith([])

    expect(result().map((entry) => entry.name)).toEqual(['陳冠宇', '林建良'])
    expect(result().every((entry) => entry.status === 'pending')).toBe(true)
  })

  it('不會把已經登記過的回覆洗掉', async () => {
    const result = await mountWith([
      { playerId: 'p1', name: '陳冠宇', number: '1', status: 'yes', note: '準時到' },
    ])

    const chen = result().find((entry) => entry.playerId === 'p1')
    expect(chen?.status).toBe('yes')
    expect(chen?.note).toBe('準時到')
    // 缺少的隊員補進來
    expect(result().some((entry) => entry.playerId === 'p2')).toBe(true)
  })

  it('已退隊但先前登記過的人保留下來（他當時確實回報過）', async () => {
    const result = await mountWith([
      { playerId: 'p3', name: '退隊的人', number: '3', status: 'yes', note: '' },
    ])

    expect(result().some((entry) => entry.playerId === 'p3')).toBe(true)
  })

  it('退隊的人不會被自動加進新的名單', async () => {
    const result = await mountWith([])
    expect(result().some((entry) => entry.playerId === 'p3')).toBe(false)
  })

  it('內容已經一致時不寫回 model（避免頁面一直處於「有未儲存變更」）', async () => {
    const already: AttendanceEntry[] = [
      { playerId: 'p1', name: '陳冠宇', number: '1', status: 'pending', note: '' },
      { playerId: 'p2', name: '林建良', number: '2', status: 'pending', note: '' },
    ]

    let writes = 0
    await mountSuspended(AttendanceEditor, {
      props: {
        players,
        modelValue: already,
        'onUpdate:modelValue': () => {
          writes += 1
        },
      },
    })

    expect(writes).toBe(0)
  })

  it('不再顯示帶入、同步、清空那幾顆按鈕', async () => {
    let current: AttendanceEntry[] = []
    const component = await mountSuspended(AttendanceEditor, {
      props: {
        players,
        modelValue: current,
        'onUpdate:modelValue': (value: AttendanceEntry[]) => {
          current = value
        },
      },
    })

    const text = component.text()
    expect(text).not.toContain('帶入現役名單')
    expect(text).not.toContain('同步現役名單')
    expect(text).not.toContain('全部設為未回覆')
  })
})
