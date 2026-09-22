import { describe, expect, it } from 'vitest'
import {
  deriveResult,
  emptyScoreboard,
  gameInputSchema,
  gameQuerySchema,
  isFinished,
  isNotPlayed,
  MAX_GAME_QUERY_LIMIT,
  needsResultUpdate,
  sumInnings,
  toDateKey,
} from '../../shared/schemas/game'
import {
  announcementQuerySchema,
  MAX_ANNOUNCEMENT_QUERY_LIMIT,
} from '../../shared/schemas/announcement'

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

describe('gameInputSchema', () => {
  const base = { date: '2026-03-05', opponent: '藍鷹棒球隊' }

  it('補齊所有選填欄位的預設值', () => {
    const parsed = gameInputSchema.parse(base)

    expect(parsed.time).toBe('09:00')
    expect(parsed.status).toBe('scheduled')
    expect(parsed.homeAway).toBe('home')
    expect(parsed.attendance).toEqual([])
    expect(parsed.result).toBeNull()
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
