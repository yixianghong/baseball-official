import { describe, expect, it } from 'vitest'
import {
  deriveBench,
  deriveResult,
  emptyScoreboard,
  gameMapUrl,
  isGoogleMapsUrl,
  gameInputSchema,
  gamePatchSchema,
  gameQuerySchema,
  gameResult,
  hasScore,
  isFinished,
  isLive,
  isNotPlayed,
  MAX_GAME_QUERY_LIMIT,
  needsResultUpdate,
  sumInnings,
  tallyRecord,
  withSummedRuns,
  toDateKey,
} from '../../shared/schemas/game'
import {
  announcementQuerySchema,
  MAX_ANNOUNCEMENT_QUERY_LIMIT,
} from '../../shared/schemas/announcement'
import { isWithinForecastRange } from '../../shared/schemas/weather'

/**
 * 比賽資料的核心邏輯。
 *
 * 這些函式決定了前台看到的比數、勝敗與「待補登」提醒，且同時被 BFF
 * （寫入時推導結果）與前端（顯示時驗算）使用 —— 錯了會兩邊一起錯，
 * 所以值得單獨測。
 */

describe('sumInnings', () => {
  it('把 null 當作 0 加總', () => {
    const board = {
      innings: [
        { inning: 1, our: 2, opponent: 0 },
        { inning: 2, our: null, opponent: 3 },
        { inning: 3, our: 1, opponent: null },
      ],
      totals: { our: { r: 3, h: 0, e: 0 }, opponent: { r: 3, h: 0, e: 0 } },
    }

    expect(sumInnings(board)).toEqual({ our: 3, opponent: 3 })
  })

  it('空計分板加總為 0', () => {
    expect(sumInnings(emptyScoreboard(0))).toEqual({ our: 0, opponent: 0 })
  })
})

describe('deriveResult', () => {
  it.each([
    [6, 3, 'win'],
    [1, 4, 'loss'],
    [2, 2, 'tie'],
  ])('我方 %i 分、對手 %i 分 → %s', (our, opponent, expected) => {
    expect(
      deriveResult({ our: { r: our, h: 0, e: 0 }, opponent: { r: opponent, h: 0, e: 0 } }),
    ).toBe(expected)
  })
})

/**
 * R（總得分）一律等於逐局加總。
 *
 * 後台曾經有一顆「用逐局加總填入 R」的按鈕，等於把「保持一致」外包給使用者
 * 記得按。沒按的下場是計分板上逐局是 3:1、R 欄寫著 0:0 —— 而前台的比數、
 * 勝敗、戰績全部讀 R，錯的是整個網站而不只是那張表格。
 */
describe('withSummedRuns', () => {
  const board = (innings: Array<[number | null, number | null]>, r: [number, number]) => ({
    innings: innings.map(([our, opponent], i) => ({ inning: i + 1, our, opponent })),
    totals: { our: { r: r[0], h: 5, e: 1 }, opponent: { r: r[1], h: 7, e: 0 } },
  })

  it('把 R 改成逐局加總', () => {
    const result = withSummedRuns(
      board(
        [
          [0, 1],
          [2, 0],
          [1, 0],
        ],
        [0, 0],
      ),
    )

    expect(result.totals.our.r).toBe(3)
    expect(result.totals.opponent.r).toBe(1)
  })

  it('不動 H 與 E —— 它們沒有逐局欄位可以加總', () => {
    const result = withSummedRuns(board([[3, 1]], [0, 0]))

    expect(result.totals.our.h).toBe(5)
    expect(result.totals.our.e).toBe(1)
    expect(result.totals.opponent.h).toBe(7)
  })

  it('沒打的半局（null）當 0 計', () => {
    const result = withSummedRuns(
      board(
        [
          [1, 2],
          [2, null],
        ],
        [0, 0],
      ),
    )

    expect(result.totals.our.r).toBe(3)
    expect(result.totals.opponent.r).toBe(2)
  })

  it('本來就一致時回傳同一個物件', () => {
    // 自動儲存靠「內容有沒有變」判斷要不要寫入，每次都回新物件會讓光是
    // 打開頁面就送出一次 PATCH
    const input = board([[3, 1]], [3, 1])

    expect(withSummedRuns(input)).toBe(input)
  })

  it('空計分板是 0:0', () => {
    expect(withSummedRuns(emptyScoreboard(7)).totals.our.r).toBe(0)
  })
})

/**
 * 勝敗是推導的，不是一個存下來、可以手動覆寫的欄位。
 *
 * 這一組守的是兩件事：**只有結束的比賽才有結果**，而且**結果一定跟著比數**。
 * 舊版兩者都可能不成立 —— 空計分板的未開打場次會帶著一個「和」，
 * 而手動覆寫過的場次可能出現「1:4」配上「勝」。
 */
describe('gameResult', () => {
  const board = (our: number, opponent: number) => ({
    innings: [],
    totals: { our: { r: our, h: 0, e: 0 }, opponent: { r: opponent, h: 0, e: 0 } },
  })

  it.each([
    ['win', 6, 3],
    ['loss', 1, 4],
    ['tie', 2, 2],
  ] as const)('結束的比賽依總分判定為 %s', (expected, our, opponent) => {
    expect(gameResult({ status: 'finished', scoreboard: board(our, opponent) })).toBe(expected)
  })

  it.each(['scheduled', 'live', 'postponed', 'canceled'] as const)(
    '%s 沒有結果（領先不等於贏了）',
    (status) => {
      expect(gameResult({ status, scoreboard: board(6, 3) })).toBeNull()
    },
  )

  it('未開打的空計分板不會被判成「和」', () => {
    // 0:0 的「和」和「還沒打」在畫面上長得一模一樣
    expect(gameResult({ status: 'scheduled', scoreboard: emptyScoreboard(7) })).toBeNull()
  })
})

describe('比賽中', () => {
  it.each([
    ['live', true],
    ['scheduled', false],
    ['finished', false],
  ] as const)('%s → isLive = %s', (status, expected) => {
    expect(isLive({ status })).toBe(expected)
  })

  it.each([
    ['live', true],
    ['finished', true],
    ['scheduled', false],
    ['postponed', false],
    ['canceled', false],
  ] as const)('%s → hasScore = %s', (status, expected) => {
    // 沒打成的場次計分板是空的，顯示出來會是「0:0」，看起來像和局
    expect(hasScore({ status })).toBe(expected)
  })
})

describe('tallyRecord', () => {
  const played = (our: number, opponent: number, status = 'finished' as const) => ({
    status,
    scoreboard: {
      innings: [],
      totals: { our: { r: our, h: 0, e: 0 }, opponent: { r: opponent, h: 0, e: 0 } },
    },
  })

  it('只統計已結束的場次', () => {
    expect(
      tallyRecord([
        played(6, 3),
        played(1, 4),
        played(2, 2),
        played(0, 0, 'postponed'),
        played(9, 0, 'live'),
      ]),
    ).toEqual({ win: 1, loss: 1, tie: 1, total: 3 })
  })

  it('場次數不含延賽 —— 否則「近 3 戰 2 勝 0 敗」看起來像少算了一場', () => {
    expect(tallyRecord([played(6, 3), played(5, 1), played(0, 0, 'postponed')])).toEqual({
      win: 2,
      loss: 0,
      tie: 0,
      total: 2,
    })
  })

  it('沒有比賽時回傳全 0', () => {
    expect(tallyRecord([])).toEqual({ win: 0, loss: 0, tie: 0, total: 0 })
  })
})

describe('needsResultUpdate', () => {
  const today = '2026-05-10'

  it('日期已過但仍標記未開打 → 需要補登', () => {
    expect(needsResultUpdate({ status: 'scheduled', date: '2026-05-09' }, today)).toBe(true)
  })

  it('今天的比賽還不算逾期', () => {
    expect(needsResultUpdate({ status: 'scheduled', date: today }, today)).toBe(false)
  })

  it('已登錄結果的比賽不需要補登', () => {
    expect(needsResultUpdate({ status: 'finished', date: '2026-01-01' }, today)).toBe(false)
  })

  it('日期已過卻還停在「比賽中」→ 需要補登', () => {
    // 忘了按「比賽結束」的場次會在前台一直掛著 LIVE，比忘了登錄結果更明顯地錯
    expect(needsResultUpdate({ status: 'live', date: '2026-05-09' }, today)).toBe(true)
  })

  it('今天正在打的比賽不算逾期', () => {
    expect(needsResultUpdate({ status: 'live', date: today }, today)).toBe(false)
  })

  it('取消的比賽不需要補登', () => {
    // 延期的比賽日期一定會過，但那不是「忘了登錄結果」
    expect(needsResultUpdate({ status: 'canceled', date: '2026-01-01' }, today)).toBe(false)
  })
})

describe('toDateKey', () => {
  it('輸出當地時區的 YYYY-MM-DD', () => {
    // 直接用 toISOString() 會轉成 UTC，在 UTC+8 會變成前一天
    expect(toDateKey(new Date(2026, 2, 5, 1, 30))).toBe('2026-03-05')
  })
})

describe('emptyScoreboard', () => {
  it('產生指定局數且每局皆為未進行', () => {
    const board = emptyScoreboard(7)
    expect(board.innings).toHaveLength(7)
    expect(board.innings[6]).toEqual({ inning: 7, our: null, opponent: null })
    expect(board.totals.our.r).toBe(0)
  })
})

/**
 * 迴歸測試：部分更新只能動送上來的欄位。
 *
 * 這裡曾經是 `gameInputSchema.partial()`，而 `.partial()` 只讓欄位變成選填 ——
 * 帶 `.default()` 的欄位在鍵不存在時**照樣會套用預設值**。結果是一個
 * 「只把狀態改成比賽結束」的 PATCH，會順手把場地、出席、打線、計分板
 * 全部清空，而 API 回應與畫面都看不出任何異常。
 *
 * `updateGame()` 的 `{ ...existing, ...patch }` 完全依賴「沒送的鍵不存在」。
 */
describe('gamePatchSchema', () => {
  it('只送一個欄位時，其他欄位不會被預設值填回來', () => {
    const patch = gamePatchSchema.parse({ status: 'finished' }) as Record<string, unknown>

    expect(Object.keys(patch)).toEqual(['status'])
    for (const field of ['lineup', 'attendance', 'pitchers', 'scoreboard', 'venue', 'time']) {
      expect(field in patch, `${field} 不該出現在 patch 裡`).toBe(false)
    }
  })

  it('送上來的欄位照樣要通過驗證', () => {
    expect(() => gamePatchSchema.parse({ date: '2026/03/05' })).toThrow()
  })

  it('合併之後保留原本的內容', () => {
    const existing = { status: 'scheduled', venue: '市立棒球場', lineup: [{ order: 1 }] }
    const merged = { ...existing, ...gamePatchSchema.parse({ status: 'live' }) }

    expect(merged).toEqual({ status: 'live', venue: '市立棒球場', lineup: [{ order: 1 }] })
  })
})

describe('gameInputSchema', () => {
  const base = { date: '2026-03-05', opponent: '藍鷹棒球隊' }

  it('補齊所有選填欄位的預設值', () => {
    const parsed = gameInputSchema.parse(base)

    expect(parsed.time).toBe('09:00')
    expect(parsed.status).toBe('scheduled')
    expect(parsed.homeAway).toBe('home')
    expect(parsed.attendance).toEqual([])
  })

  /**
   * 勝敗不是可以送進來的欄位。
   *
   * 後台的表單上沒有這個控制項了，但 schema 才是真正的防線 —— 只要它還收，
   * 任何一個舊的前端、一次手動的 PATCH，就能把一個和計分板矛盾的結果寫進去。
   */
  it('不接受手動指定的比賽結果', () => {
    const parsed = gameInputSchema.parse({ ...base, result: 'win' }) as Record<string, unknown>

    expect(parsed.result).toBeUndefined()
  })

  it('拒絕格式錯誤的日期', () => {
    expect(() => gameInputSchema.parse({ ...base, date: '2026/03/05' })).toThrow()
  })

  it('拒絕格式錯誤的時間', () => {
    expect(() => gameInputSchema.parse({ ...base, time: '9:00' })).toThrow()
    expect(() => gameInputSchema.parse({ ...base, time: '25:00' })).toThrow()
  })

  it('拒絕空白的對手隊名', () => {
    expect(() => gameInputSchema.parse({ ...base, opponent: '   ' })).toThrow()
  })

  it('保留「沒打這半局」與「打了沒得分」的差別', () => {
    const parsed = gameInputSchema.parse({
      ...base,
      scoreboard: {
        innings: [
          { inning: 1, our: 0, opponent: 1 },
          { inning: 2, our: null, opponent: 2 },
        ],
        totals: { our: { r: 0, h: 1, e: 0 }, opponent: { r: 3, h: 4, e: 1 } },
      },
    })

    expect(parsed.scoreboard.innings[0]?.our).toBe(0)
    expect(parsed.scoreboard.innings[1]?.our).toBeNull()
  })
})

/**
 * 迴歸測試：查詢上限的常數必須與 schema 一致。
 *
 * 後台列表要「全部」，所以它傳的是上限值。若那個數字超過 schema 允許的範圍，
 * 請求會被擋成 400，而列表頁通常只會顯示「沒有資料」—— 看起來就像資料真的
 * 不見了。這個錯誤真的發生過：後台傳 200、schema 上限是 100，使用者明明剛
 * 用 AI 匯入五場比賽，畫面卻說「還沒有比賽資料」。
 *
 * 現在兩邊引用同一個常數，這個測試確保常數本身在 schema 的允許範圍內。
 */
describe('查詢上限', () => {
  it('比賽列表接受 MAX_GAME_QUERY_LIMIT', () => {
    const parsed = gameQuerySchema.parse({ limit: MAX_GAME_QUERY_LIMIT })
    expect(parsed.limit).toBe(MAX_GAME_QUERY_LIMIT)
  })

  it('比賽列表拒絕超過上限的值', () => {
    expect(() => gameQuerySchema.parse({ limit: MAX_GAME_QUERY_LIMIT + 1 })).toThrow()
  })

  it('公告列表接受 MAX_ANNOUNCEMENT_QUERY_LIMIT', () => {
    const parsed = announcementQuerySchema.parse({ limit: MAX_ANNOUNCEMENT_QUERY_LIMIT })
    expect(parsed.limit).toBe(MAX_ANNOUNCEMENT_QUERY_LIMIT)
  })

  it('查詢參數是字串時也能正確轉型（query string 進來都是字串）', () => {
    const parsed = gameQuerySchema.parse({ limit: String(MAX_GAME_QUERY_LIMIT) })
    expect(parsed.limit).toBe(MAX_GAME_QUERY_LIMIT)
  })
})

/**
 * 延賽與取消。
 *
 * 延賽是「這天沒打成，之後會再排」，取消是「不打了」——對球隊來說是兩件事，
 * 所以不能混成同一個狀態。兩者的共同點是「沒有打成」：不顯示比數、不列入戰績。
 */
describe('沒有打成的場次', () => {
  it.each([
    ['postponed', true],
    ['canceled', true],
    ['finished', false],
    ['scheduled', false],
    ['live', false],
  ] as const)('%s → isNotPlayed = %s', (status, expected) => {
    expect(isNotPlayed({ status })).toBe(expected)
  })

  it('延賽不算已結束（前台不會顯示打線與計分板）', () => {
    expect(isFinished({ status: 'postponed' })).toBe(false)
  })

  it('延賽不會被標成「待補登結果」', () => {
    // 那是給「日期過了卻還沒登錄比分」的場次用的；延賽根本沒打，沒有比分可登
    expect(needsResultUpdate({ status: 'postponed', date: '2026-01-01' }, '2026-05-10')).toBe(false)
  })

  it('schema 接受延賽這個狀態', () => {
    const parsed = gameInputSchema.parse({
      date: '2026-03-05',
      opponent: '藍鷹棒球隊',
      status: 'postponed',
    })
    expect(parsed.status).toBe('postponed')
  })
})

/**
 * 候補名單是推導出來的（出席 − 先發），不是另外存的欄位。
 * 比對錯了的症狀是「同一個人同時出現在先發與候補」，或是有到的人整個消失 ——
 * 兩種在畫面上都很刺眼，但只要比對邏輯錯一個分支就會發生。
 */
describe('deriveBench', () => {
  const attend = (playerId: string, name: string, status = 'yes' as const, number = '') => ({
    playerId,
    name,
    number,
    status,
    note: '',
  })
  const bat = (order: number, playerId: string, name: string) => ({
    order,
    playerId,
    name,
    number: '',
    position: 'P' as const,
  })

  it('確定出席但不在打線上的人才是候補', () => {
    const bench = deriveBench({
      attendance: [attend('p1', '王小明'), attend('p2', '陳大文'), attend('p3', '林志豪')],
      lineup: [bat(1, 'p1', '王小明')],
    })

    expect(bench.map((entry) => entry.name)).toEqual(['陳大文', '林志豪'])
  })

  it('沒有確定出席的人不算候補（他們根本不會到）', () => {
    const bench = deriveBench({
      attendance: [
        attend('p1', '不出席', 'no'),
        attend('p2', '待確認', 'maybe'),
        attend('p3', '未回覆', 'pending'),
        attend('p4', '會到', 'yes'),
      ],
      lineup: [],
    })

    expect(bench.map((entry) => entry.name)).toEqual(['會到'])
  })

  /**
   * 打線允許 `playerId` 為空（臨時來支援的球友不在名單裡），而且後台可以
   * 直接手打名字而不從清單挑。少了姓名比對，已經上場的人會被誤判成還在板凳上。
   */
  it('打線上只有姓名、沒有 playerId 時也要認得出來', () => {
    const bench = deriveBench({
      attendance: [attend('p1', '王小明'), attend('p2', '陳大文')],
      lineup: [bat(1, '', '王小明')],
    })

    expect(bench.map((entry) => entry.name)).toEqual(['陳大文'])
  })

  it('姓名前後有空白也要對得起來', () => {
    const bench = deriveBench({
      attendance: [attend('', ' 王小明 ')],
      lineup: [bat(1, '', '王小明')],
    })

    expect(bench).toEqual([])
  })

  it('還沒排先發時，所有確定出席的人都是候補', () => {
    const bench = deriveBench({
      attendance: [attend('p1', '王小明'), attend('p2', '陳大文')],
      lineup: [],
    })

    expect(bench).toHaveLength(2)
  })

  it('沒有出席資料就沒有候補', () => {
    expect(deriveBench({ attendance: [], lineup: [bat(1, 'p1', '王小明')] })).toEqual([])
  })

  it('保留背號與備註，前台要顯示', () => {
    const bench = deriveBench({
      attendance: [attend('p9', '王小明', 'yes', '99')],
      lineup: [],
    })

    expect(bench[0]).toMatchObject({ number: '99', name: '王小明' })
  })
})

/**
 * 地圖連結會變成前台的一個對外連結。後台是信任的來源，但「信任」不等於
 * 「不會手滑」—— 貼錯的下場是球隊官網上掛著一個看起來像地圖的外部連結。
 */
describe('isGoogleMapsUrl', () => {
  it('接受 Google 地圖的各種形式', () => {
    expect(isGoogleMapsUrl('https://maps.app.goo.gl/abc123')).toBe(true)
    expect(isGoogleMapsUrl('https://www.google.com/maps/place/xxx')).toBe(true)
    expect(isGoogleMapsUrl('https://maps.google.com/?q=台北')).toBe(true)
    expect(isGoogleMapsUrl('https://goo.gl/maps/abc')).toBe(true)
  })

  it('拒絕 google.com 上不是地圖的路徑', () => {
    expect(isGoogleMapsUrl('https://www.google.com/search?q=xxx')).toBe(false)
    expect(isGoogleMapsUrl('https://www.google.com/')).toBe(false)
  })

  it('拒絕把 google.com 藏在別的位置的偽造網址', () => {
    // 用字串 includes 判斷就會中招
    expect(isGoogleMapsUrl('https://evil.example.com/?x=google.com/maps')).toBe(false)
    expect(isGoogleMapsUrl('https://google.com.evil.example.com/maps')).toBe(false)
    expect(isGoogleMapsUrl('https://www.google.com@evil.example.com/maps')).toBe(false)
  })

  it('拒絕非 https 與不是網址的東西', () => {
    expect(isGoogleMapsUrl('http://maps.google.com/x')).toBe(false)
    expect(isGoogleMapsUrl('javascript:alert(1)')).toBe(false)
    expect(isGoogleMapsUrl('隨便打的字')).toBe(false)
    expect(isGoogleMapsUrl('')).toBe(false)
  })
})

describe('gameMapUrl', () => {
  it('有填連結就直接用', () => {
    expect(gameMapUrl({ mapUrl: 'https://maps.app.goo.gl/abc', venue: '新莊新月橋' })).toBe(
      'https://maps.app.goo.gl/abc',
    )
  })

  it('沒填連結就用場地名稱組搜尋連結', () => {
    const url = gameMapUrl({ mapUrl: '', venue: '新莊新月橋' })

    expect(url).toContain('google.com/maps/search/')
    // 中文與空白都要編碼，不能直接串進網址
    expect(url).toContain(encodeURIComponent('新莊新月橋'))
    expect(isGoogleMapsUrl(url)).toBe(true)
  })

  it('連場地都沒有就沒有連結（不要給一個搜尋空字串的連結）', () => {
    expect(gameMapUrl({ mapUrl: '', venue: '' })).toBe('')
  })
})

/**
 * 預報範圍判斷。氣象署的一週預報是硬限制，超出範圍的日期連請求都不該發出。
 */
describe('isWithinForecastRange', () => {
  const today = '2026-09-22'

  it('今天與未來一週內都算範圍內', () => {
    expect(isWithinForecastRange('2026-09-22', today)).toBe(true)
    expect(isWithinForecastRange('2026-09-25', today)).toBe(true)
    expect(isWithinForecastRange('2026-09-29', today)).toBe(true) // 第 7 天
  })

  it('超過一週就不在範圍內（賽程常常幾個月前就排好）', () => {
    expect(isWithinForecastRange('2026-09-30', today)).toBe(false)
    expect(isWithinForecastRange('2026-12-01', today)).toBe(false)
  })

  it('過去的日期沒有預報可言', () => {
    expect(isWithinForecastRange('2026-09-21', today)).toBe(false)
  })

  it('跨月與跨年都要算對，不能只比字串或日數', () => {
    expect(isWithinForecastRange('2026-10-01', '2026-09-28')).toBe(true)
    expect(isWithinForecastRange('2027-01-02', '2026-12-31')).toBe(true)
    expect(isWithinForecastRange('2027-01-08', '2026-12-31')).toBe(false)
  })

  it('日期格式壞掉時回 false，不要讓它變成一個必然失敗的請求', () => {
    expect(isWithinForecastRange('不是日期', today)).toBe(false)
    expect(isWithinForecastRange('2026-09-25', '壞掉的今天')).toBe(false)
  })
})
