// @vitest-environment nuxt
import { h } from 'vue'
import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import type { AttendanceEntry, LineupEntry } from '../../shared/schemas/game'
import type { Player } from '../../shared/schemas/player'
import LineupEditor from '../../app/components/admin/LineupEditor.vue'

/**
 * 打線編輯器的挑人清單。
 *
 * 排打線的當下最不想做的事，就是從全隊名單裡挑出今天會到的那幾位 ——
 * 所以有出席統計時，選單只列回報出席的人。
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
  player('p3', '王柏翔'),
  player('p4', '退隊的人', { status: 'inactive' }),
]

function attendance(statuses: Record<string, AttendanceEntry['status']>): AttendanceEntry[] {
  return players.map((p) => ({
    playerId: p.id,
    name: p.name,
    number: p.number,
    status: statuses[p.id] ?? 'pending',
    note: '',
  }))
}

/** 讀出第一個「球員」下拉裡的所有選項文字。 */
function optionTexts(component: { findAll: (selector: string) => Array<{ text: () => string }> }) {
  return component.findAll('select option').map((option) => option.text())
}

describe('LineupEditor 的挑人清單', () => {
  it('沒有出席統計時列出全部現役球員', async () => {
    const component = await mountSuspended(LineupEditor, {
      props: {
        players,
        modelValue: [{ order: 1, playerId: '', name: '', number: '', position: 'P' }],
        'onUpdate:modelValue': () => {},
      },
    })

    const texts = optionTexts(component).join(' ')
    expect(texts).toContain('陳冠宇')
    expect(texts).toContain('林建良')
    expect(texts).toContain('王柏翔')
    // 退隊的人不該出現
    expect(texts).not.toContain('退隊的人')
    expect(component.text()).toContain('還沒有人回報出席')
  })

  it('有出席統計時只列回報出席的球員', async () => {
    const component = await mountSuspended(LineupEditor, {
      props: {
        players,
        attendance: attendance({ p1: 'yes', p2: 'no', p3: 'maybe' }),
        modelValue: [{ order: 1, playerId: '', name: '', number: '', position: 'P' }],
        'onUpdate:modelValue': () => {},
      },
    })

    const texts = optionTexts(component).join(' ')
    expect(texts).toContain('陳冠宇')
    // 回報不出席與待確認的都不列 —— 打線是排給確定會到的人
    expect(texts).not.toContain('林建良')
    expect(texts).not.toContain('王柏翔')
    expect(component.text()).toContain('只顯示回報出席的 1 位球員')
  })

  it('已經排進打線的球員即使沒回報出席也留在選單裡', async () => {
    // 少了這條，打開編輯畫面會看到自己先前的選擇被清空
    const lineup: LineupEntry[] = [
      { order: 1, playerId: 'p2', name: '林建良', number: '2', position: 'C' },
    ]

    const component = await mountSuspended(LineupEditor, {
      props: {
        players,
        attendance: attendance({ p1: 'yes', p2: 'no' }),
        modelValue: lineup,
        'onUpdate:modelValue': () => {},
      },
    })

    expect(optionTexts(component).join(' ')).toContain('林建良')
  })

  it('可以切換成顯示全部球員（臨時來的人不一定有回報）', async () => {
    const component = await mountSuspended(LineupEditor, {
      props: {
        players,
        attendance: attendance({ p1: 'yes' }),
        modelValue: [{ order: 1, playerId: '', name: '', number: '', position: 'P' }],
        'onUpdate:modelValue': () => {},
      },
    })

    const toggle = component
      .findAll('button')
      .find((button) => button.text().includes('顯示全部球員'))
    expect(toggle).toBeDefined()

    await toggle!.trigger('click')

    const texts = optionTexts(component).join(' ')
    expect(texts).toContain('林建良')
    expect(texts).toContain('王柏翔')
  })
})

/**
 * 底部操作列。
 *
 * 排打線是「一直往下加棒次」的工作：按鈕放最上面，排到第七、八棒時得捲回去
 * 才按得到；放最下面則每加一棒它就往下跑一次。所以收在一條固定於畫面底部的
 * 操作列裡，儲存按鈕由頁面透過 slot 放進同一列。
 */
describe('LineupEditor 的底部操作列', () => {
  const lineup: LineupEntry[] = [
    { order: 1, playerId: 'p1', name: '陳冠宇', number: '1', position: 'P' },
    { order: 2, playerId: 'p2', name: '林建良', number: '2', position: 'C' },
  ]

  it('新增棒次、清空與棒次數都在同一列', async () => {
    const component = await mountSuspended(LineupEditor, {
      props: { players, modelValue: lineup, 'onUpdate:modelValue': () => {} },
    })

    const bar = component.find('.sticky')
    expect(bar.exists()).toBe(true)
    expect(bar.text()).toContain('新增棒次')
    expect(bar.text()).toContain('全部清空')
    expect(bar.text()).toContain('共 2 棒')
  })

  it('頁面傳進來的儲存按鈕會出現在同一列', async () => {
    const component = await mountSuspended(LineupEditor, {
      props: { players, modelValue: lineup, 'onUpdate:modelValue': () => {} },
      slots: { actions: () => h('button', '儲存先發陣容') },
    })

    expect(component.find('.sticky').text()).toContain('儲存先發陣容')
  })

  it('打線是空的時候顯示「帶入前九人」而不是「清空」', async () => {
    const component = await mountSuspended(LineupEditor, {
      props: { players, modelValue: [], 'onUpdate:modelValue': () => {} },
    })

    const bar = component.find('.sticky')
    expect(bar.text()).toContain('前九人帶入')
    expect(bar.text()).not.toContain('全部清空')
  })

  it('清空需要按兩次（避免誤觸把排好的打線清掉）', async () => {
    let cleared = false
    const component = await mountSuspended(LineupEditor, {
      props: {
        players,
        modelValue: lineup,
        'onUpdate:modelValue': (value: LineupEntry[]) => {
          if (value.length === 0) cleared = true
        },
      },
    })

    const clearButton = component
      .findAll('button')
      .find((button) => button.text().includes('全部清空'))!

    await clearButton.trigger('click')
    expect(cleared).toBe(false)
    expect(clearButton.text()).toContain('確定清空')

    await clearButton.trigger('click')
    expect(cleared).toBe(true)
  })
})

/**
 * 拖曳排序。
 *
 * 用瀏覽器原生的 drag and drop，不引入排序套件。原生 DnD 在觸控裝置上不會
 * 觸發，所以上下箭頭按鈕保留著 —— 只做拖曳等於把手機與鍵盤使用者排除在外。
 */
describe('LineupEditor 的拖曳排序', () => {
  const lineup: LineupEntry[] = [
    { order: 1, playerId: 'p1', name: '陳冠宇', number: '1', position: 'P' },
    { order: 2, playerId: 'p2', name: '林建良', number: '2', position: 'C' },
    { order: 3, playerId: 'p3', name: '王柏翔', number: '3', position: '1B' },
  ]

  /** 掛載並回傳（元件, 讀取最新 model 的函式）。 */
  async function mountEditor() {
    let current = lineup
    const component = await mountSuspended(LineupEditor, {
      props: {
        players,
        modelValue: current,
        'onUpdate:modelValue': (value: LineupEntry[]) => {
          current = value
        },
      },
    })
    return { component, latest: () => current }
  }

  it('每一列都可以拖曳', async () => {
    const { component } = await mountEditor()
    const rows = component.findAll('li[draggable="true"]')
    expect(rows).toHaveLength(3)
  })

  it('把第三棒拖到第一棒，其餘依序遞補且棒次重新編號', async () => {
    const { component, latest } = await mountEditor()
    const rows = component.findAll('li[draggable="true"]')

    await rows[2]!.trigger('dragstart', { dataTransfer: { setData: () => {} } })
    await rows[0]!.trigger('dragover', { dataTransfer: {} })
    await rows[0]!.trigger('drop')

    expect(latest().map((entry) => entry.name)).toEqual(['王柏翔', '陳冠宇', '林建良'])
    expect(latest().map((entry) => entry.order)).toEqual([1, 2, 3])
  })

  it('拖回原位不會改動任何東西', async () => {
    const { component, latest } = await mountEditor()
    const rows = component.findAll('li[draggable="true"]')

    await rows[1]!.trigger('dragstart', { dataTransfer: { setData: () => {} } })
    await rows[1]!.trigger('drop')

    expect(latest().map((entry) => entry.name)).toEqual(['陳冠宇', '林建良', '王柏翔'])
  })

  it('上下箭頭仍然可用（手機與鍵盤沒有拖曳）', async () => {
    const { component, latest } = await mountEditor()

    const downButton = component
      .findAll('button')
      .find((button) => button.attributes('aria-label') === '下移')!
    await downButton.trigger('click')

    expect(latest().map((entry) => entry.name)).toEqual(['林建良', '陳冠宇', '王柏翔'])
  })
})
