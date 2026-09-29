// @vitest-environment nuxt
import { describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import InningEditor from '../../app/components/admin/InningEditor.vue'
import { playSchema, type Play, type PlayResult } from '../../shared/schemas/play'
import type { GameHalf, HomeAway } from '../../shared/schemas/half-inning'
import type { LineupEntry } from '../../shared/schemas/game'

/**
 * 逐局紀錄編輯器。
 *
 * 這裡守的是三條「只要壞掉就沒人會用這個功能」的行為：打者自動帶下一棒、
 * 我隊防守的半局才問投手、以及一次點擊就登錄一個打席。
 */

const lineup: LineupEntry[] = [
  { order: 1, playerId: 'p4', name: '張志豪', number: '7', position: '2B' },
  { order: 2, playerId: 'p5', name: '李承翰', number: '9', position: 'SS' },
  { order: 3, playerId: 'p3', name: '王柏翔', number: '5', position: '1B' },
]

function makePlay(
  inning: number,
  half: GameHalf,
  number: string,
  result: PlayResult = 'groundout',
): Play {
  return playSchema.parse({ inning, half, batter: { number, name: `選手${number}` }, result })
}

function mount(overrides: Record<string, unknown> = {}) {
  return mountSuspended(InningEditor, {
    props: {
      plays: [] as Play[],
      homeAway: 'home' as HomeAway,
      lineup,
      startingPitcher: { playerId: 'p1', name: '陳冠宇', number: '1' },
      players: [],
      clips: [],
      scoreboard: {
        innings: [
          { inning: 1, our: null, opponent: null },
          { inning: 2, our: null, opponent: null },
        ],
        totals: { our: { r: 0, h: 0, e: 0 }, opponent: { r: 0, h: 0, e: 0 } },
      },
      ourName: '城市隊',
      opponentName: '藍鷹隊',
      ...overrides,
    },
  })
}

/** 打線列表上亮起來（輪到打擊）的那一棒。 */
function currentBatter(component: Awaited<ReturnType<typeof mount>>): string {
  return component.find('[aria-label="打線"] [aria-current="true"]').text()
}

/** 結果快捷鍵。按下去就等於登錄一個打席。 */
function resultButton(component: Awaited<ReturnType<typeof mount>>, label: string) {
  return component.findAll('button').find((button) => button.text() === label)
}

describe('AdminInningEditor', () => {
  it('把計分板的每一局展開成上下兩個半局', () => {
    // 至少七局 —— 和錄影頁的局數按鈕同一條規則，兩邊格子數對不上
    // 會讓人以為漏了幾段
    return mount().then((component) => {
      const cells = component.findAll('[aria-label="半局"] [role="tab"]')
      expect(cells).toHaveLength(14)
      expect(cells[0]?.text()).toContain('1上')
      expect(cells[13]?.text()).toContain('7下')
    })
  })

  it('還沒登錄的半局顯示「—」而不是 0', async () => {
    // 「沒登錄」和「登了但沒得分」是兩件事，顯示成同一個數字就分不出來
    const component = await mount()
    expect(component.findAll('[aria-label="半局"] [role="tab"]')[0]?.text()).toContain('—')
  })

  it('我隊進攻的半局預設帶下一棒', async () => {
    // 主場 → 1 下是我隊打擊；還沒有任何打席，所以輪到第一棒
    const component = await mount()
    await component.findAll('[aria-label="半局"] [role="tab"]')[1]?.trigger('click')
    expect(currentBatter(component)).toContain('#7 張志豪')
  })

  it('打者接著整場的打席數輪轉，不是每個半局從第一棒重來', async () => {
    // 每個半局都從第一棒開始的話，第四棒以後的人永遠不會出現
    const component = await mount({
      plays: [makePlay(1, 'bottom', '7'), makePlay(1, 'bottom', '9')],
    })
    // 1 下已經兩個打席 → 2 下輪到第三棒
    await component.findAll('[aria-label="半局"] [role="tab"]')[3]?.trigger('click')
    expect(currentBatter(component)).toContain('#5 王柏翔')
  })

  it('打線繞完一圈之後回到第一棒', async () => {
    const component = await mount({
      plays: [makePlay(1, 'bottom', '7'), makePlay(1, 'bottom', '9'), makePlay(1, 'bottom', '5')],
    })
    await component.findAll('[aria-label="半局"] [role="tab"]')[3]?.trigger('click')
    expect(currentBatter(component)).toContain('#7 張志豪')
  })

  it('我隊防守的半局問投手、不問打者選單', async () => {
    // 主場 → 1 上是對手打擊，我隊在守備
    const component = await mount()
    expect(component.text()).toContain('我隊投手')
    expect(component.text()).toContain('對手打者背號')
    expect(component.find('[aria-label="打線"]').exists()).toBe(false)
  })

  it('我隊進攻的半局不問投手（對手的投手我們沒有名冊）', async () => {
    const component = await mount()
    await component.findAll('[aria-label="半局"] [role="tab"]')[1]?.trigger('click')
    expect(component.text()).not.toContain('我隊投手')
  })

  it('客場時上下半局對調（走 battingSide，不是寫死我隊在下）', async () => {
    const component = await mount({ homeAway: 'away' })
    // 客隊先攻 → 客場時 1 上是我隊打擊
    expect(currentBatter(component)).toContain('#7 張志豪')
  })

  it('按一個結果鍵就登錄一個打席', async () => {
    // ⚠️ 這是整個功能能不能被實際使用的關鍵：多數打席只要按一下。
    // 要是變成「選打者 → 選結果 → 按新增」，一場十四個半局就沒人會登
    const component = await mount()
    await component.findAll('[aria-label="半局"] [role="tab"]')[1]?.trigger('click')
    await resultButton(component, '三壘安打')?.trigger('click')

    const saved = component.emitted('save')
    expect(saved).toHaveLength(1)
    expect(saved?.[0]?.[0]).toBe(1)
    expect(saved?.[0]?.[1]).toBe('bottom')
    expect(saved?.[0]?.[2]).toMatchObject([
      { result: 'triple', batter: { playerId: 'p4', number: '7' }, runs: 0 },
    ])
  })

  it('登錄時不問得分：全壘打預設 1 分，其他 0 分', async () => {
    // 得分與打點都在登錄之後的列表上調 —— 登錄前不必先想好，登錄後也改得回來
    const component = await mount()
    await component.findAll('[aria-label="半局"] [role="tab"]')[1]?.trigger('click')
    expect(component.find('[aria-label="這個打席得幾分"]').exists()).toBe(false)

    await resultButton(component, '全壘打')?.trigger('click')
    expect(component.emitted('save')?.[0]?.[2]).toMatchObject([{ runs: 1, rbi: 1 }])
  })

  it('列表上調得分，打點跟著動', async () => {
    const component = await mount({ plays: [makePlay(1, 'top', '11', 'double')] })
    await component.findAll('[aria-label="半局"] [role="tab"]')[0]?.trigger('click')

    await component.find('button[aria-label="得分加一"]').trigger('click')
    expect(component.emitted('save')?.[0]?.[2]).toMatchObject([{ runs: 1, rbi: 1 }])
  })

  it('列表上可以單獨調打點（失誤推進回來的分數不算打點）', async () => {
    const scored = playSchema.parse({
      inning: 1,
      half: 'top',
      batter: { number: '11' },
      result: 'single',
      runs: 2,
      rbi: 2,
    })
    const component = await mount({ plays: [scored] })
    await component.findAll('[aria-label="半局"] [role="tab"]')[0]?.trigger('click')

    await component.find('button[aria-label="打點減一"]').trigger('click')
    expect(component.emitted('save')?.[0]?.[2]).toMatchObject([{ runs: 2, rbi: 1 }])
  })

  it('打點不能加到超過得分', async () => {
    const component = await mount({ plays: [makePlay(1, 'top', '11', 'double')] })
    await component.findAll('[aria-label="半局"] [role="tab"]')[0]?.trigger('click')
    expect(component.find('button[aria-label="打點加一"]').attributes('disabled')).toBeDefined()
  })

  it('跑者出局沒有打點欄（不是打席）', async () => {
    const component = await mount({ plays: [makePlay(1, 'top', '11', 'runnerOut')] })
    await component.findAll('[aria-label="半局"] [role="tab"]')[0]?.trigger('click')
    expect(component.find('[aria-label="第 1 個打席的得分"]').exists()).toBe(true)
    expect(component.find('[aria-label="第 1 個打席的打點"]').exists()).toBe(false)
  })

  it('打線是空的時候不讓人登錄，而且說得出原因', async () => {
    const component = await mount({ lineup: [] })
    await component.findAll('[aria-label="半局"] [role="tab"]')[1]?.trigger('click')

    expect(component.text()).toContain('先到「打線」分頁排好先發陣容')
    expect(resultButton(component, '三壘安打')?.attributes('disabled')).toBeDefined()
  })

  it('對手半局還沒填背號時不讓人登錄', async () => {
    const component = await mount()
    expect(component.text()).toContain('請先填對手打者的背號')
    expect(resultButton(component, '三振')?.attributes('disabled')).toBeDefined()
  })

  it('已登錄的打席列得出來，而且刪得掉', async () => {
    const component = await mount({
      plays: [makePlay(1, 'top', '11', 'single'), makePlay(1, 'top', '12', 'strikeout')],
    })
    const rows = component.findAll('ol li')
    expect(rows).toHaveLength(2)
    expect(rows[0]?.text()).toContain('#11')
    expect(rows[0]?.text()).toContain('一壘安打')

    await component.find('button[aria-label="移除第 1 個打席"]').trigger('click')
    expect(component.emitted('save')?.[0]?.[2]).toHaveLength(1)
  })

  it('出局數是算出來的，不是一個輸入欄位', async () => {
    // 雙殺打一次吃掉兩個出局 —— 這是「這半局登完了沒」的唯一依據
    const component = await mount({
      plays: [makePlay(1, 'top', '11', 'strikeout'), makePlay(1, 'top', '12', 'doublePlay')],
    })
    await component.findAll('[aria-label="半局"] [role="tab"]')[0]?.trigger('click')
    expect(component.text()).toContain('3／3 出局')
  })

  it('打開時停在第一個還沒登完的半局', async () => {
    // 登錄是一次做一點的。每次回到這一頁都要重新捲到上次的位置，
    // 那是十幾次點擊 —— 和錄影頁的 resumePosition() 同一個道理
    const component = await mount({
      plays: [makePlay(1, 'top', '11', 'strikeout'), makePlay(1, 'top', '12', 'doublePlay')],
    })
    expect(component.find('[role="tabpanel"] h3, h3').text()).toContain('第 1 局下')
  })

  it('有沒有同步的提示講得出還剩幾個半局', async () => {
    const component = await mount({ pendingCount: 2 })
    expect(component.text()).toContain('2 個半局還沒同步')
  })
})

describe('AdminInningEditor 的球場拖曳登錄', () => {
  /**
   * 拖曳本身（Pointer Events 與 SVG 座標換算）在 happy-dom 裡沒有真的版面，
   * 那部分用無頭 Chrome 驗。這裡直接讓球場元件送出 `drop`，守的是
   * 「放開之後」的整條流程：跳出選單 → 點結果 → 帶著落點寫進去。
   */
  async function dropAt(component: Awaited<ReturnType<typeof mount>>, x: number, y: number) {
    const picker = component.findComponent({ name: 'AdminFieldPicker' })
    picker.vm.$emit('drop', { x, y })
    await nextTick()
  }

  it('放開之後才跳出選單，點結果就帶著落點登錄', async () => {
    const component = await mount()
    await component.findAll('[aria-label="半局"] [role="tab"]')[1]?.trigger('click') // 1 下，我隊

    expect(component.text()).not.toContain('處理的人')
    await dropAt(component, -0.13, 0.42) // 游擊手的站位

    expect(component.text()).toContain('處理的人')
    await resultButton(component, '滾地球出局')?.trigger('click')

    expect(component.emitted('save')?.[0]?.[2]).toMatchObject([
      {
        result: 'groundout',
        location: { x: -0.13, y: 0.42 },
        fielder: 'SS',
        // 出局的擊球類型從結果推導，不存
        batted: null,
      },
    ])
  })

  it('安打記擊球類型、不記處理的人（穿越的球沒有人處理）', async () => {
    const component = await mount()
    await component.findAll('[aria-label="半局"] [role="tab"]')[1]?.trigger('click')
    await dropAt(component, -0.25, 0.9) // 左中外野空檔

    await resultButton(component, '二壘安打')?.trigger('click')
    // 點了安打還沒登錄 —— 要再問一次是怎麼打出去的
    expect(component.emitted('save')).toBeUndefined()

    const types = component.find('[aria-label="安打類型"]')
    // 外野預選平飛
    expect(types.find('.bg-brand-600').text()).toBe('平飛')
    await types
      .findAll('button')
      .find((button) => button.text() === '高飛')
      ?.trigger('click')

    expect(component.emitted('save')?.[0]?.[2]).toMatchObject([
      { result: 'double', fielder: null, batted: 'fly' },
    ])
  })

  it('出局點一下就登錄，不問擊球類型（從結果就知道）', async () => {
    // 曾經把擊球類型放在結果上面、不論點什麼都先問：先選「高飛」再點
    // 「滾地球出局」，剛剛選的被默默忽略，看起來像同一件事要答兩次
    const component = await mount()
    await component.findAll('[aria-label="半局"] [role="tab"]')[1]?.trigger('click')
    await dropAt(component, 0, 0.86)

    expect(component.find('[aria-label="安打類型"]').exists()).toBe(false)
    await resultButton(component, '飛球出局')?.trigger('click')
    expect(component.emitted('save')?.[0]?.[2]).toMatchObject([{ result: 'flyout', batted: null }])
  })

  it('牆外的全壘打不必再問（一定是高飛）', async () => {
    const component = await mount()
    await component.findAll('[aria-label="半局"] [role="tab"]')[1]?.trigger('click')
    await dropAt(component, 0, 1.08)

    await resultButton(component, '全壘打')?.trigger('click')
    expect(component.emitted('save')?.[0]?.[2]).toMatchObject([
      { result: 'homerun', batted: 'fly' },
    ])
  })

  it('點了安打之後可以改選其他結果', async () => {
    const component = await mount()
    await component.findAll('[aria-label="半局"] [role="tab"]')[1]?.trigger('click')
    await dropAt(component, -0.25, 0.9)
    await resultButton(component, '二壘安打')?.trigger('click')

    await component
      .findAll('button')
      .find((button) => button.text() === '改選其他結果')
      ?.trigger('click')
    await resultButton(component, '飛球出局')?.trigger('click')
    expect(component.emitted('save')?.[0]?.[2]).toMatchObject([{ result: 'flyout' }])
  })

  it('外野空檔的選單把安打排在前面', async () => {
    const component = await mount()
    await component.findAll('[aria-label="半局"] [role="tab"]')[1]?.trigger('click')
    await dropAt(component, -0.25, 0.9)

    const sheet = component.find('[role="group"][aria-label$="的打席結果"]')
    const first = sheet.findAll('button').find((button) => button.text() === '一壘安打')
    expect(first).toBeDefined()
  })

  it('取消之後不會登錄任何東西', async () => {
    const component = await mount()
    await component.findAll('[aria-label="半局"] [role="tab"]')[1]?.trigger('click')
    await dropAt(component, 0, 0.86)

    await component
      .findAll('button')
      .find((button) => button.text() === '取消')
      ?.trigger('click')
    expect(component.text()).not.toContain('處理的人')
    expect(component.emitted('save')).toBeUndefined()
  })

  it('三振、保送在本壘旁點一下就登錄，沒有落點', async () => {
    const component = await mount()
    await component.findAll('[aria-label="半局"] [role="tab"]')[1]?.trigger('click')

    const row = component.find('[aria-label="沒有落點的結果"]')
    await row
      .findAll('button')
      .find((button) => button.text() === '保送')
      ?.trigger('click')

    expect(component.emitted('save')?.[0]?.[2]).toMatchObject([
      { result: 'walk', location: null, fielder: null, batted: null },
    ])
  })

  it('我隊的打席依名冊記左右打，對手不記', async () => {
    const component = await mount({
      players: [
        { id: 'p4', name: '張志豪', number: '7', bats: 'L' },
        { id: 'p5', name: '李承翰', number: '9', bats: 'S' },
      ],
    })
    await component.findAll('[aria-label="半局"] [role="tab"]')[1]?.trigger('click')
    const row = component.find('[aria-label="沒有落點的結果"]')
    await row
      .findAll('button')
      .find((button) => button.text() === '三振')
      ?.trigger('click')
    expect(component.emitted('save')?.[0]?.[2]).toMatchObject([{ bats: 'L' }])
  })

  it('左右開弓的打者才問站哪邊', async () => {
    const component = await mount({
      players: [{ id: 'p4', name: '張志豪', number: '7', bats: 'S' }],
    })
    await component.findAll('[aria-label="半局"] [role="tab"]')[1]?.trigger('click')
    expect(component.text()).toContain('這個打席站')
  })

  it('改落點：拖一次改的是那一筆，不是新增一筆', async () => {
    const existing = playSchema.parse({
      inning: 1,
      half: 'top',
      batter: { number: '11' },
      result: 'flyout',
      location: { x: 0, y: 0.86 },
      fielder: 'CF',
    })
    const component = await mount({ plays: [existing] })
    await component.findAll('[aria-label="半局"] [role="tab"]')[0]?.trigger('click')

    await component
      .findAll('button')
      .find((button) => button.text() === '改落點')
      ?.trigger('click')
    await dropAt(component, -0.43, 0.72)

    const saved = component.emitted('save')?.[0]?.[2] as Play[]
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ result: 'flyout', location: { x: -0.43, y: 0.72 } })
    // 原本選好的處理者保留（使用者可能是刻意選的）
    expect(saved[0]?.fielder).toBe('CF')
  })
})

describe('AdminInningEditor 的打線與代打', () => {
  /** 主場 → 下半局我隊打擊；記上第幾棒，和實際登錄出來的一樣。 */
  function ours(
    inning: number,
    slot: number,
    result: PlayResult = 'groundout',
    batter?: Play['batter'],
  ) {
    const entry = lineup.find((item) => item.order === slot)!
    return playSchema.parse({
      inning,
      half: 'bottom',
      result,
      battingSlot: slot,
      batter: batter ?? { playerId: entry.playerId, name: entry.name, number: entry.number },
    })
  }

  async function openBottom(component: Awaited<ReturnType<typeof mount>>, inning = 1) {
    await component
      .findAll('[aria-label="半局"] [role="tab"]')
      [(inning - 1) * 2 + 1]?.trigger('click')
  }

  function noLanding(component: Awaited<ReturnType<typeof mount>>, label: string) {
    return component
      .find('[aria-label="沒有落點的結果"]')
      .findAll('button')
      .find((button) => button.text() === label)
  }

  it('整份打線列出來，輪到的那一棒亮起來', async () => {
    const component = await mount()
    await openBottom(component)
    expect(component.findAll('[aria-label="打線"] li')).toHaveLength(3)
    expect(component.findAll('[aria-label="打線"] [aria-current="true"]')).toHaveLength(1)
    expect(currentBatter(component)).toContain('#7 張志豪')
  })

  it('跑者出局之後還是同一個打者', async () => {
    // 盜壘失敗、牽制出局發生在打席之間 —— 打擊區上的人還沒打完
    const component = await mount({ plays: [ours(1, 1, 'single'), ours(1, 2, 'runnerOut')] })
    await openBottom(component)
    expect(currentBatter(component)).toContain('#9 李承翰')
  })

  it('登錄的打席記上第幾棒', async () => {
    const component = await mount()
    await openBottom(component)
    await noLanding(component, '三振')?.trigger('click')
    expect(component.emitted('save')?.[0]?.[2]).toMatchObject([{ battingSlot: 1 }])
  })

  it('點別的棒次就改由那一棒打，並且講出照打線應該是誰', async () => {
    const component = await mount()
    await openBottom(component)
    await component
      .findAll('[aria-label="打線"] li button')
      .find((button) => button.text().includes('王柏翔'))
      ?.trigger('click')

    expect(currentBatter(component)).toContain('#5 王柏翔')
    expect(component.text()).toContain('照打線應該輪到第 1 棒')

    await noLanding(component, '保送')?.trigger('click')
    expect(component.emitted('save')?.[0]?.[2]).toMatchObject([
      { battingSlot: 3, batter: { playerId: 'p3' } },
    ])
  })

  it('代打：在亮起來的那一棒按代打，從板凳挑人，登錄的是代打的人', async () => {
    const component = await mount({
      players: [
        { id: 'p4', name: '張志豪', number: '7', status: 'active' },
        { id: 'p9', name: '許書豪', number: '31', status: 'active' },
      ],
    })
    await openBottom(component)

    // 板凳上只有不在打線上的人
    await component
      .findAll('button')
      .find((button) => button.text() === '代打')
      ?.trigger('click')
    const chips = component
      .findAll('button')
      .filter((button) => button.text().includes('#31 許書豪'))
    expect(chips).toHaveLength(1)
    expect(component.findAll('button').some((button) => button.text() === '#7 張志豪')).toBe(false)

    await chips[0]!.trigger('click')
    expect(currentBatter(component)).toContain('#31 許書豪')
    expect(currentBatter(component)).toContain('代打（原 #7 張志豪）')

    await noLanding(component, '三振')?.trigger('click')
    expect(component.emitted('save')?.[0]?.[2]).toMatchObject([
      { battingSlot: 1, batter: { playerId: 'p9', number: '31' } },
    ])
  })

  it('臨時球員也能代打', async () => {
    const component = await mount()
    await openBottom(component)
    await component
      .findAll('button')
      .find((button) => button.text() === '代打')
      ?.trigger('click')
    await component.find('input[aria-label="臨時球員背號"]').setValue('88')
    await component.find('input[aria-label="臨時球員姓名"]').setValue('阿明')
    await component.find('form:has(input[aria-label="臨時球員姓名"])').trigger('submit')

    expect(currentBatter(component)).toContain('#88 阿明')
  })

  it('代打過的那一棒，下一輪輪到時就是代打的人', async () => {
    const pinchHitter = { playerId: 'p9', name: '許書豪', number: '31' }
    const component = await mount({
      plays: [ours(1, 1, 'single', pinchHitter), ours(1, 2), ours(1, 3)],
    })
    await openBottom(component, 2)
    expect(currentBatter(component)).toContain('#31 許書豪')
    expect(currentBatter(component)).toContain('代')
  })
})

describe('AdminInningEditor 三出局後鎖住', () => {
  const threeOuts = () => [
    makePlay(1, 'top', '11', 'strikeout'),
    makePlay(1, 'top', '12', 'groundout'),
    makePlay(1, 'top', '13', 'flyout'),
  ]

  async function openTop(component: Awaited<ReturnType<typeof mount>>) {
    await component.findAll('[aria-label="半局"] [role="tab"]')[0]?.trigger('click')
  }

  it('三出局的半局不能再新增，也不能改或刪', async () => {
    const component = await mount({ plays: threeOuts() })
    await openTop(component)

    expect(component.text()).toContain('這個半局已經三出局，登錄已鎖住')
    expect(component.find('[aria-label="沒有落點的結果"]').exists()).toBe(false)
    expect(component.findComponent({ name: 'AdminFieldPicker' }).exists()).toBe(false)
    expect(component.find('button[aria-label="移除第 1 個打席"]').exists()).toBe(false)
    // 得分與打點還看得到，但 ＋／－ 不見了
    expect(component.find('[aria-label="第 1 個打席的得分"]').exists()).toBe(true)
    expect(component.find('button[aria-label="得分加一"]').exists()).toBe(false)
  })

  it('解鎖之後可以改或刪，但還是不能新增', async () => {
    const component = await mount({ plays: threeOuts() })
    await openTop(component)
    await component
      .findAll('button')
      .find((button) => button.text() === '解鎖修改')
      ?.trigger('click')

    expect(component.find('button[aria-label="移除第 1 個打席"]').exists()).toBe(true)
    expect(component.find('[aria-label="沒有落點的結果"]').exists()).toBe(false)
  })

  it('換到別的半局再回來，會重新鎖上', async () => {
    const component = await mount({ plays: threeOuts() })
    await openTop(component)
    await component
      .findAll('button')
      .find((button) => button.text() === '解鎖修改')
      ?.trigger('click')
    await component.findAll('[aria-label="半局"] [role="tab"]')[1]?.trigger('click')
    await openTop(component)

    expect(component.text()).toContain('登錄已鎖住')
  })

  it('登錄第三個出局之後自動跳到下一個半局', async () => {
    const component = await mount({
      plays: [makePlay(1, 'top', '11', 'strikeout'), makePlay(1, 'top', '12', 'groundout')],
    })
    await openTop(component)
    await component.find('input[placeholder="例如 24"]').setValue('13')
    await component
      .find('[aria-label="沒有落點的結果"]')
      .findAll('button')
      .find((button) => button.text() === '三振')
      ?.trigger('click')
    await nextTick()
    await nextTick()

    expect(component.find('h3').text()).toContain('第 1 局下')
  })

  it('兩出局時雙殺打按不下去（出局數不能超過三）', async () => {
    const component = await mount({
      plays: [makePlay(1, 'top', '11', 'strikeout'), makePlay(1, 'top', '12', 'groundout')],
    })
    await openTop(component)
    await component.find('input[placeholder="例如 24"]').setValue('13')
    component.findComponent({ name: 'AdminFieldPicker' }).vm.$emit('drop', { x: -0.13, y: 0.42 })
    await nextTick()

    const sheet = component.find('[aria-label$="的打席結果"]')
    const dp = sheet.findAll('button').find((button) => button.text() === '雙殺打')
    const go = sheet.findAll('button').find((button) => button.text() === '滾地球出局')
    expect(dp?.attributes('disabled')).toBeDefined()
    expect(go?.attributes('disabled')).toBeUndefined()
  })
})
