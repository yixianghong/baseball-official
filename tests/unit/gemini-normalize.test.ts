import { describe, expect, it } from 'vitest'
import {
  normalizeDate,
  normalizeBatted,
  normalizeFielder,
  normalizeJerseyNumber,
  normalizePlayResult,
  normalizeTime,
  resolveMatchup,
  toParsedPlay,
} from '../../server/utils/gemini'

/**
 * Gemini 回傳值的正規化。
 *
 * ## 為什麼這一層必須存在
 * prompt 已經明確要求「日期輸出 YYYY-MM-DD」，模型多半也照做，但偶爾會回
 * `3/15`、`2026/3/15`、`2026.03.15`。與其在提示詞裡一再強調（不保證有效，
 * 而且每次都要重新驗證），不如在程式碼裡收斂 —— 格式問題用程式碼處理
 * 比用提示詞處理可靠得多。
 *
 * 這也是少數能離線測試 AI 功能的部分：不需要真的呼叫 API。
 */

describe('normalizeDate', () => {
  it('已經是標準格式就原樣返回', () => {
    expect(normalizeDate('2026-03-15', 2026)).toBe('2026-03-15')
  })

  it.each([
    ['2026/3/15', '2026-03-15'],
    ['2026.03.15', '2026-03-15'],
    ['2026年3月15日', '2026-03-15'],
  ])('補零與統一分隔符：%s → %s', (input, expected) => {
    expect(normalizeDate(input, 2026)).toBe(expected)
  })

  it.each([
    ['3/15', '2026-03-15'],
    ['3月15日', '2026-03-15'],
  ])('只有月日時用預設年份補齊：%s → %s', (input, expected) => {
    expect(normalizeDate(input, 2026)).toBe(expected)
  })

  it('讀不出日期時回空字串，不猜測', () => {
    expect(normalizeDate('待定', 2026)).toBe('')
    expect(normalizeDate('', 2026)).toBe('')
  })
})

describe('normalizeTime', () => {
  it('已經是標準格式就原樣返回', () => {
    expect(normalizeTime('14:30')).toBe('14:30')
  })

  it.each([
    ['9:00', '09:00'],
    ['9點', '09:00'],
    ['14時30', '14:30'],
  ])('補零與中文寫法：%s → %s', (input, expected) => {
    expect(normalizeTime(input)).toBe(expected)
  })

  it('超出範圍或讀不懂時回空字串', () => {
    expect(normalizeTime('25:00')).toBe('')
    expect(normalizeTime('待定')).toBe('')
  })
})

describe('normalizePlayResult（語音講的說法 → 列舉值）', () => {
  it.each([
    ['一壘安打', 'single'],
    ['一安', 'single'],
    ['二壘安打', 'double'],
    ['二安', 'double'],
    ['三壘安打', 'triple'],
    ['三安', 'triple'],
    ['三壘打', 'triple'],
    ['全壘打', 'homerun'],
    ['紅不讓', 'homerun'],
    ['四壞', 'walk'],
    ['保送', 'walk'],
    ['三振', 'strikeout'],
    ['被三振', 'strikeout'],
    ['滾地球出局', 'groundout'],
    ['滾地', 'groundout'],
    ['飛球出局', 'flyout'],
    // ⚠️ 標籤改成「外野飛球出局」之後，舊的講法要照樣聽得懂 ——
    // 場邊的人與模型都還是會講「飛球出局」
    ['外野飛球出局', 'flyout'],
    ['內野高飛', 'flyout'],
    ['高飛球出局', 'flyout'],
    // 而「平飛球出局」裡面也含有「飛球出局」，不能被它比中（長的別名優先）
    ['平飛球出局', 'lineout'],
    ['接殺', 'flyout'],
    ['雙殺打', 'doublePlay'],
    ['雙殺', 'doublePlay'],
    ['野選', 'fieldersChoice'],
    ['高飛犧牲打', 'sacrificeFly'],
    ['盜壘失敗', 'runnerOut'],
  ])('「%s」→ %s', (spoken, expected) => {
    expect(normalizePlayResult(spoken)).toBe(expected)
  })

  /**
   * ⚠️ 這一組是整個正規化存在的主要理由。
   *
   * 「三振」和「三壘安打」在中文語音辨識裡最容易混，而弄錯的後果是
   * 一個出局變成一支三壘安打 —— 出局數、得分、打擊率會一起錯掉，
   * 而畫面上完全看不出來。
   */
  it('「三振」不會被收斂成三壘安打', () => {
    expect(normalizePlayResult('三振')).toBe('strikeout')
    expect(normalizePlayResult('三振出局')).toBe('strikeout')
  })

  it('「三壘安打」不會被收斂成三振', () => {
    expect(normalizePlayResult('三壘安打')).toBe('triple')
  })

  /**
   * 長的別名要先比對：「三壘安打」裡面含有「安打」（single 的別名之一），
   * 照列舉順序比對的話，三壘安打會被當成一壘安打。
   */
  it('比對時長的說法優先', () => {
    expect(normalizePlayResult('三壘安打')).toBe('triple')
    expect(normalizePlayResult('二壘安打')).toBe('double')
    expect(normalizePlayResult('安打')).toBe('single')
  })

  it('句子裡夾著別的字也認得出來', () => {
    expect(normalizePlayResult('打了一支三壘安打')).toBe('triple')
    expect(normalizePlayResult('  三 振  ')).toBe('strikeout')
  })

  it('認不得的回 null，不猜（也不當成「其他」）', () => {
    // 猜一個結果填進去的話，出局數與打擊率都會跟著錯，而畫面上看起來正常。
    // null 讓暫存卡片把它標出來，確認前不能採用
    expect(normalizePlayResult('不知道在說什麼')).toBeNull()
    expect(normalizePlayResult('')).toBeNull()
    expect(normalizePlayResult(undefined)).toBeNull()
  })
})

describe('normalizeJerseyNumber', () => {
  it.each([
    ['24', '24'],
    ['24號', '24'],
    ['#24', '24'],
    [' 7 ', '7'],
    ['沒聽清楚', ''],
  ])('「%s」→ 「%s」', (input, expected) => {
    expect(normalizeJerseyNumber(input)).toBe(expected)
  })

  it('最多三碼（背號不會更長，多的是雜訊）', () => {
    expect(normalizeJerseyNumber('123456')).toBe('123')
  })
})

describe('normalizeFielder（語音講的守備位置）', () => {
  it.each([
    ['游擊', 'SS'],
    ['游擊方向', 'SS'],
    ['游擊手', 'SS'],
    ['中外野', 'CF'],
    ['左外', 'LF'],
    ['右外野手', 'RF'],
    ['投手前', 'P'],
    ['捕手', 'C'],
    ['一壘', '1B'],
    ['二壘手', '2B'],
    ['三壘方向', '3B'],
  ])('「%s」→ %s', (spoken, expected) => {
    expect(normalizeFielder(spoken)).toBe(expected)
  })

  it('沒講或認不得回 null（不猜）', () => {
    expect(normalizeFielder('')).toBeNull()
    expect(normalizeFielder('不知道')).toBeNull()
    expect(normalizeFielder(undefined)).toBeNull()
  })
})

describe('normalizeBatted（語音講的擊球類型）', () => {
  it.each([
    ['滾地', 'ground'],
    ['滾地球', 'ground'],
    ['平飛', 'line'],
    ['平飛球', 'line'],
    ['高飛', 'fly'],
    ['小飛球', 'fly'],
  ])('「%s」→ %s', (spoken, expected) => {
    expect(normalizeBatted(spoken)).toBe(expected)
  })

  it('沒講回 null', () => {
    expect(normalizeBatted('')).toBeNull()
  })
})

/**
 * 模型的一筆輸出 → 打席欄位。**語音沒講到的一律是 null**，不在這一層猜。
 *
 * 模型對「沒講」的約定是字串填空字串、數字填 -1（responseSchema 的 nullable
 * 不穩定），這裡把它們轉成 null；預設值是採用那一刻才補的。
 */
describe('toParsedPlay', () => {
  const roster = [{ id: 'p4', name: '張志豪', number: '24' }]
  const blank = { number: '', result: '', fielder: '', batted: '', runs: -1, rbi: -1 }

  it('只講「24 號三壘安打」時，其他欄位都是 null', () => {
    const play = toParsedPlay(
      { ...blank, number: '24', result: '三壘安打', confidence: 0.9 },
      { ourAtBat: true, roster },
    )
    expect(play).toMatchObject({
      batter: { playerId: 'p4', name: '張志豪', number: '24' },
      result: 'triple',
      runs: null,
      rbi: null,
      location: null,
      fielder: null,
      batted: null,
    })
  })

  it('講到的欄位都帶進來：守備位置、擊球類型、得分、打點', () => {
    const play = toParsedPlay(
      { number: '24', result: '一壘安打', fielder: '', batted: '平飛', runs: 1, rbi: 1 },
      { ourAtBat: true, roster },
    )
    expect(play).toMatchObject({ result: 'single', batted: 'line', runs: 1, rbi: 1 })
  })

  it('出局的處理者照講的記；擊球類型從結果推導，所以存 null', () => {
    const play = toParsedPlay(
      { ...blank, number: '24', result: '滾地球出局', fielder: '游擊', batted: '滾地' },
      { ourAtBat: true, roster },
    )
    expect(play).toMatchObject({ result: 'groundout', fielder: 'SS', batted: null })
  })

  it('安打不記處理的人（穿越的球沒有人處理）', () => {
    const play = toParsedPlay(
      { ...blank, number: '24', result: '二壘安打', fielder: '左外野', batted: '平飛' },
      { ourAtBat: true, roster },
    )
    expect(play).toMatchObject({ fielder: null, batted: 'line' })
  })

  it('「沒有得分」是 0，不是 null', () => {
    const play = toParsedPlay(
      { ...blank, number: '24', result: '一壘安打', runs: 0 },
      { ourAtBat: true, roster },
    )
    expect(play.runs).toBe(0)
  })

  it('落點永遠是 null（猜出來的座標混進落點圖會被當真）', () => {
    const play = toParsedPlay(
      { ...blank, number: '24', result: '飛球出局', fielder: '中外野' },
      { ourAtBat: true, roster },
    )
    expect(play.location).toBeNull()
  })

  it('對手打擊時不對我隊名冊（兩隊的背號會撞）', () => {
    const play = toParsedPlay(
      { ...blank, number: '24', result: '三振' },
      { ourAtBat: false, roster },
    )
    expect(play.batter).toEqual({ playerId: null, name: null, number: '24' })
  })

  it('聽不出結果時 result 是 null', () => {
    const play = toParsedPlay({ ...blank, number: '24', result: '嗯' }, { ourAtBat: true, roster })
    expect(play.result).toBeNull()
  })
})

describe('resolveMatchup', () => {
  const teamNames = ['後港傭兵', '後港']

  /** 省略那兩個「配不出來才用」的退路參數。 */
  const resolve = (firstTeam: string, secondTeam: string, fallback = {}) =>
    resolveMatchup({
      firstTeam,
      secondTeam,
      teamNames,
      fallbackHomeAway: null,
      fallbackOpponent: '',
      ...fallback,
    })

  /**
   * ⚠️ 規則只有一句話：**寫在前面的先攻**。
   *
   * 這是這支球隊的慣例，不是常識 —— MLB 的「A vs B」剛好相反（A 是主隊）。
   * 搞反的結果是整張賽程的主客場全部顛倒，而計分板的上下半局、前台的排列
   * 全部跟著錯，畫面上卻只是「看起來怪怪的」。
   */
  it('我隊寫在前面＝先攻＝客場', () => {
    expect(resolve('後港傭兵', '兄弟象')).toMatchObject({
      homeAway: 'away',
      opponent: '兄弟象',
      fromOrder: true,
    })
  })

  it('我隊寫在後面＝後攻＝主場', () => {
    expect(resolve('兄弟象', '後港傭兵')).toMatchObject({
      homeAway: 'home',
      opponent: '兄弟象',
      fromOrder: true,
    })
  })

  it('對手隊名從另一邊取，不用模型自己判斷的那一個', () => {
    expect(resolve('統一獅', '後港', { fallbackOpponent: '讀錯的隊名' }).opponent).toBe('統一獅')
  })

  it('全半形、空格、括號、簡稱都算同一支隊伍', () => {
    for (const written of ['後 港 傭 兵', '（後港傭兵）', '後港', '後港傭兵・A隊']) {
      expect(resolve(written, '兄弟象').homeAway, written).toBe('away')
    }
  })

  it('⚠️ 兩邊都不像我隊時不猜，退回模型從圖上讀到的標示', () => {
    const result = resolve('統一獅', '兄弟象', {
      fallbackHomeAway: 'home',
      fallbackOpponent: '兄弟象',
    })

    expect(result).toMatchObject({ homeAway: 'home', opponent: '兄弟象', fromOrder: false })
  })

  it('⚠️ 兩邊都像我隊時也不猜（隊內對抗賽、對手隊名含我隊的字）', () => {
    const result = resolveMatchup({
      firstTeam: '後港傭兵 A',
      secondTeam: '後港傭兵 B',
      teamNames,
      fallbackHomeAway: null,
      fallbackOpponent: '後港傭兵 B',
    })

    expect(result.fromOrder).toBe(false)
    expect(result.homeAway).toBeNull()
  })

  it('⚠️ 一個字的隊名不做包含比對 —— 它會把對手也比中', () => {
    // 設定裡若填了「港」，「南港紅襪」也會被當成我隊，先攻後攻就顛倒了
    const result = resolveMatchup({
      firstTeam: '南港紅襪',
      secondTeam: '兄弟象',
      teamNames: ['港'],
      fallbackHomeAway: null,
      fallbackOpponent: '兄弟象',
    })

    expect(result.fromOrder).toBe(false)
  })

  it('某一邊讀不到隊名時不猜', () => {
    expect(resolve('', '後港傭兵').fromOrder).toBe(true)
    expect(resolve('後港傭兵', '').fromOrder).toBe(true)
    expect(resolve('', '').fromOrder).toBe(false)
  })
})
