import { z } from 'zod'
import { citySchema } from './weather'
import { positionSchema } from './player'

/**
 * 賽程／比賽的共用契約。
 *
 * ## 為什麼打線、出席、計分板都內嵌在同一份文件裡
 * 一場比賽的打線約 9～15 人、計分板約 9～12 局，加起來遠小於 Firestore
 * 單一文件 1MB 的上限。內嵌的好處是「看一場比賽只要 1 次讀取」——
 * 拆成子集合的話，一個比賽詳情頁會變成 4 次往返。
 *
 * ## 上下半局的表示方式
 * 計分板刻意用 `our` / `opponent` 而不是 `top` / `bottom`。
 * 後台輸入時想的是「我隊這局得幾分」，不是「上半局得幾分」；
 * 誰在上半局由 `homeAway` 決定，顯示時再換算（見 `app/components/game/Scoreboard.vue`）。
 * 資料層不存這種可推導的資訊，就不會有兩邊不一致的問題。
 */

/**
 * 比賽狀態。
 *
 * 延賽與取消分開：延賽是「這天沒打成，之後會再排」，取消是「不打了」。
 * 對球隊來說是兩件事 —— 延賽的場次還會回來，取消的不會。
 */
export const gameStatusSchema = z.enum(['scheduled', 'finished', 'postponed', 'canceled'])
export type GameStatus = z.infer<typeof gameStatusSchema>

export const GAME_STATUS_LABELS: Record<GameStatus, string> = {
  scheduled: '未開打',
  finished: '已結束',
  postponed: '因雨延賽',
  canceled: '取消',
}

/** 主客場。 */
export const homeAwaySchema = z.enum(['home', 'away'])
export type HomeAway = z.infer<typeof homeAwaySchema>

/** 出席狀態。`pending` 是「還沒回覆」，與明確回答「不出席」不同。 */
export const attendanceStatusSchema = z.enum(['yes', 'no', 'maybe', 'pending'])
export type AttendanceStatus = z.infer<typeof attendanceStatusSchema>

export const ATTENDANCE_LABELS: Record<AttendanceStatus, string> = {
  yes: '出席',
  no: '不出席',
  maybe: '待確認',
  pending: '未回覆',
}

/** 比賽結果。由計分板推導，後台可覆寫（例如裁定比賽）。 */
export const gameResultSchema = z.enum(['win', 'loss', 'tie'])
export type GameResult = z.infer<typeof gameResultSchema>

export const GAME_RESULT_LABELS: Record<GameResult, string> = {
  win: '勝',
  loss: '敗',
  tie: '和',
}

/** 出席名單的一筆紀錄。`name` 是當下的姓名快照，球員改名不影響歷史紀錄。 */
export const attendanceEntrySchema = z.object({
  playerId: z.string(),
  name: z.string(),
  number: z.string().default(''),
  status: attendanceStatusSchema.default('pending'),
  note: z.string().max(100).default(''),
})

export type AttendanceEntry = z.infer<typeof attendanceEntrySchema>

/**
 * 打線的一筆紀錄。
 *
 * `playerId` 允許為空字串：臨時找來的支援球員不在名單裡，但打線上要寫得出他。
 */
export const lineupEntrySchema = z.object({
  order: z.number().int().min(1).max(15),
  playerId: z.string().default(''),
  name: z.string().min(1),
  number: z.string().default(''),
  position: positionSchema,
})

export type LineupEntry = z.infer<typeof lineupEntrySchema>

/** 投手紀錄。 */
export const pitcherEntrySchema = z.object({
  playerId: z.string().default(''),
  name: z.string().min(1),
  number: z.string().default(''),
  role: z.enum(['starter', 'relief', 'closer']).default('starter'),
  note: z.string().max(100).default(''),
})

export type PitcherEntry = z.infer<typeof pitcherEntrySchema>

/**
 * 單局得分。`null` 代表「沒打這半局」——例如主隊領先時九下不用打，
 * 那一格在計分板上是 `X` 而不是 `0`，兩者意義完全不同。
 */
export const inningScoreSchema = z.object({
  inning: z.number().int().min(1).max(20),
  our: z.number().int().min(0).max(99).nullable().default(null),
  opponent: z.number().int().min(0).max(99).nullable().default(null),
})

export type InningScore = z.infer<typeof inningScoreSchema>

/** 一方的 R／H／E 總計。 */
export const sideTotalsSchema = z.object({
  r: z.number().int().min(0).max(999).default(0),
  h: z.number().int().min(0).max(999).default(0),
  e: z.number().int().min(0).max(999).default(0),
})

export const scoreboardSchema = z.object({
  innings: z.array(inningScoreSchema).max(20).default([]),
  totals: z
    .object({
      our: sideTotalsSchema,
      opponent: sideTotalsSchema,
    })
    .default({ our: { r: 0, h: 0, e: 0 }, opponent: { r: 0, h: 0, e: 0 } }),
})

export type Scoreboard = z.infer<typeof scoreboardSchema>

/** 空白計分板。局數預設 7 局（社會／業餘常見賽制），後台可增減。 */
export function emptyScoreboard(innings = 7): Scoreboard {
  return {
    innings: Array.from({ length: innings }, (_, i) => ({
      inning: i + 1,
      our: null,
      opponent: null,
    })),
    totals: { our: { r: 0, h: 0, e: 0 }, opponent: { r: 0, h: 0, e: 0 } },
  }
}

/** 加總逐局得分。`null` 當 0 計。 */
export function sumInnings(scoreboard: Scoreboard): { our: number; opponent: number } {
  return scoreboard.innings.reduce(
    (acc, inning) => ({
      our: acc.our + (inning.our ?? 0),
      opponent: acc.opponent + (inning.opponent ?? 0),
    }),
    { our: 0, opponent: 0 },
  )
}

/** 由總分推導勝敗。後台未手動覆寫時使用。 */
export function deriveResult(totals: Scoreboard['totals']): GameResult {
  if (totals.our.r > totals.opponent.r) return 'win'
  if (totals.our.r < totals.opponent.r) return 'loss'
  return 'tie'
}

/**
 * 新增／編輯比賽時後台送進來的資料。
 *
 * 日期用 `YYYY-MM-DD` 字串而非 Date：Firestore 的字串排序等同時間排序，
 * 查詢與顯示都不必處理時區，而球賽本來就是「當地時間的某一天」。
 */
/**
 * 是不是 Google 地圖的網址。
 *
 * 比對主機名稱而不是用 `includes`：`https://evil.example.com/?x=google.com/maps`
 * 也含有那段字串。分享出來的短網址（`maps.app.goo.gl`）也要認得，
 * 因為那才是手機版「分享」給出的格式。
 */
const GOOGLE_MAPS_HOSTS = [
  'maps.app.goo.gl',
  'goo.gl',
  'maps.google.com',
  'www.google.com',
  'google.com',
]

export function isGoogleMapsUrl(value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }

  if (url.protocol !== 'https:') return false
  if (!GOOGLE_MAPS_HOSTS.includes(url.hostname)) return false

  // google.com 底下只有 /maps 算數，否則整個 google.com 都會通過
  if (url.hostname.endsWith('google.com') && url.hostname !== 'maps.google.com') {
    return url.pathname.startsWith('/maps')
  }
  return true
}

/**
 * 這場比賽的地圖連結。
 *
 * 後台沒填時用場地名稱組一個 Google 地圖搜尋連結 —— 業餘球隊的場地多半是
 * 「新莊新月橋」這種搜尋得到的地標，與其讓連結消失，不如給一個八成會對的。
 * 連場地都沒填才回傳空字串。
 */
export function gameMapUrl(game: Pick<Game, 'mapUrl' | 'venue'>): string {
  if (game.mapUrl) return game.mapUrl
  if (!game.venue) return ''
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(game.venue)}`
}

export const gameInputSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式須為 YYYY-MM-DD'),
  time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, '時間格式須為 HH:mm')
    .default('09:00'),
  opponent: z.string().trim().min(1, '請輸入對戰球隊').max(40),
  venue: z.string().trim().max(60).default(''),
  /**
   * Google 地圖連結。留空時前台會用場地名稱自動組一個搜尋連結。
   *
   * 限定只能是 Google 地圖的網域：這個值會變成前台的一個連結，
   * 貼錯（或被貼上別的東西）就是一個掛在球隊官網上、看起來像地圖的外部連結。
   * 後台是信任的來源，但「信任」不等於「不會手滑」。
   */
  mapUrl: z
    .string()
    .trim()
    .max(500)
    .default('')
    .refine((value) => value === '' || isGoogleMapsUrl(value), '請貼 Google 地圖的連結'),
  /**
   * 場地所在縣市。只為了查天氣預報而存在，前台不單獨顯示。
   *
   * 留空就不顯示天氣 —— 氣象署的預報要指定縣市，而場地欄位是自由輸入的
   * 文字，硬猜會顯示成別的縣市的天氣，比不顯示更糟。
   */
  city: citySchema.default(''),
  league: z.string().trim().max(40).default(''),
  homeAway: homeAwaySchema.default('home'),
  status: gameStatusSchema.default('scheduled'),
  note: z.string().trim().max(500).default(''),
  coverImageUrl: z.string().trim().default(''),
  /**
   * 對手隊徽。首頁的比分帶與近期賽事會顯示它。
   *
   * 存在比賽上而不是另開一張「球隊」資料表：業餘球隊的對手常常只碰過一兩次，
   * 為此維護一份對手名冊的成本遠大於直接在比賽上貼一張圖。沒有隊徽時
   * 畫面會退回顯示隊名首字，版面不會塌。
   */
  opponentLogoUrl: z.string().trim().default(''),

  // --- 未來場次用 ---
  attendance: z.array(attendanceEntrySchema).max(60).default([]),

  /**
   * 打線。
   *
   * 只有一份：比賽前排好的先發陣容，就是比賽後的出賽紀錄。業餘球隊不會為了
   * 「預計」與「實際」各維護一套，分成兩個欄位只會讓人不知道該填哪一個、
   * 前台也可能顯示到沒更新的那一份。
   *
   * 顯示時依比賽狀態調整語氣：未開打是「先發陣容（預計）」，
   * 已結束就是「當天打線」。同一份資料，兩種說法。
   */
  lineup: z.array(lineupEntrySchema).max(15).default([]),
  pitchers: z.array(pitcherEntrySchema).max(10).default([]),
  scoreboard: scoreboardSchema.default(emptyScoreboard()),
  /** 留空表示由計分板自動推導。 */
  result: gameResultSchema.nullable().default(null),
})

export type GameInput = z.input<typeof gameInputSchema>

export const gamePatchSchema = gameInputSchema.partial()
export type GamePatch = z.input<typeof gamePatchSchema>

/** 從 Firestore 讀出、回傳給前端的完整比賽資料。 */
export const gameSchema = gameInputSchema.extend({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /**
   * 已經送出過的自動提醒（見 `shared/schemas/reminder.ts`）。
   *
   * 刻意**不放進 `gameInputSchema`**：它不是人填的欄位，而是系統自己記的狀態。
   * 放進 input schema 的話，後台表單每次存檔都會把它一起送上來 ——
   * 漏帶一次就等於把記號清掉，然後所有人再收到一次同樣的提醒。
   *
   * 記在比賽文件上而不是另開 collection：排程器會重試，判斷「送過了沒」
   * 必須和比賽本身是同一次讀取，後台也才看得到哪一場已經提醒過。
   */
  remindersSent: z.array(z.string()).default([]),
})

export type Game = z.infer<typeof gameSchema>

/**
 * 一次最多取回幾場比賽。
 *
 * 定成常數而不是各自寫死：後台列表要「全部」，若它傳的數字超過這裡的上限，
 * 請求會被擋成 400，而頁面通常只會顯示「沒有資料」——看起來就像資料真的不見了，
 * 非常難查。前後端引用同一個值就不可能對不上。
 */
export const MAX_GAME_QUERY_LIMIT = 300

/** 比賽列表的查詢參數。 */
export const gameQuerySchema = z.object({
  status: gameStatusSchema.optional(),
  /** `upcoming` = 未開打且日期未過；`past` = 已結束。供前台兩個列表頁使用。 */
  scope: z.enum(['upcoming', 'past', 'all']).default('all'),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_GAME_QUERY_LIMIT).default(50),
})

/** 前端用（欄位可省略、數字可為字串）。 */
export type GameQuery = z.input<typeof gameQuerySchema>
/**
 * repository 用（已套用 default 與 coerce）。
 *
 * 用 `Partial` 是因為 repository 也接受完全不帶條件的呼叫，
 * 而 `z.output` 會把有 default 的欄位標成必填。
 */
export type GameQueryOptions = Partial<z.output<typeof gameQuerySchema>>

/**
 * 比賽是否已經打完（決定詳情頁要顯示打線＋計分板，還是出席＋預計先發）。
 *
 * 以 `status` 為準而不是日期：比賽可能因雨延賽，日期過了卻還沒打。
 */
export function isFinished(game: Pick<Game, 'status'>): boolean {
  return game.status === 'finished'
}

/**
 * 候補名單 —— 確定出席、但不在先發打線上的人。
 *
 * ## 為什麼是推導出來的，不另外存一份
 * 候補完全由「出席」與「打線」兩份既有資料決定，多存一份就多一份會不同步的
 * 東西：把人排進打線卻忘了從候補移除，畫面上就會出現同一個人既先發又候補。
 * 推導不可能對不上，也不需要任何資料遷移。
 *
 * ## 比對方式
 * 以 `playerId` 為主，姓名為輔。打線允許 `playerId` 為空（臨時來支援的球友
 * 不在名單裡，但打線上要寫得出他），而且後台可以直接手打名字而不從清單挑 ——
 * 少了姓名比對，這種情況下已經上場的人會被誤判成還坐在板凳上。
 *
 * 前台兩種狀態都用得到，只是意思不同：
 * - 未開打：這些人有空，是換人時的選項
 * - 已結束：這些人當天有到，但沒有排進先發
 */
export function deriveBench(game: Pick<Game, 'attendance' | 'lineup'>): AttendanceEntry[] {
  const startedIds = new Set(game.lineup.map((entry) => entry.playerId).filter(Boolean))
  const startedNames = new Set(
    game.lineup.map((entry) => entry.name.trim()).filter((name) => name.length > 0),
  )

  return game.attendance.filter((entry) => {
    if (entry.status !== 'yes') return false
    if (entry.playerId && startedIds.has(entry.playerId)) return false
    return !startedNames.has(entry.name.trim())
  })
}

/** 沒有打成的場次（延賽或取消）—— 不該顯示比數，也不列入戰績。 */
export function isNotPlayed(game: Pick<Game, 'status'>): boolean {
  return game.status === 'postponed' || game.status === 'canceled'
}

/**
 * 日期已過但仍標記為未開打 —— 後台列表據此提醒你補登結果。
 *
 * @param today `YYYY-MM-DD` 格式的今天，由呼叫端傳入而不在這裡取
 *              `new Date()`，SSR 與 client 才不會因為時區差異算出不同結果。
 */
export function needsResultUpdate(game: Pick<Game, 'status' | 'date'>, today: string): boolean {
  return game.status === 'scheduled' && game.date < today
}

/**
 * 取得**台北時間**的 `YYYY-MM-DD`。
 *
 * ## 為什麼不能用 `toDateKey(new Date())`
 * 正式環境跑在 Cloud Run 上，時區是 **UTC**（`apphosting.yaml` 沒有設 `TZ`，
 * 容器預設就是 UTC）。台北時間 00:00–07:59 這八個小時裡，伺服器還停在
 * **前一天** —— 「明天的比賽」會整整差一天，而在本機開發時完全重現不了，
 * 因為本機就是台北時間。
 *
 * 直接加八小時就夠，不必引入 `Intl` 的時區資料：台灣從 1979 年起就沒有
 * 日光節約時間，UTC+8 是全年固定的。
 */
export function taipeiDateKey(now: Date = new Date()): string {
  return new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

/**
 * 兩個 `YYYY-MM-DD` 之間差幾天（`to` 減 `from`）。格式不對時回 `null`。
 *
 * 用 UTC 午夜相減而不是本地時間：跨日光節約時間的邊界時，本地午夜之間
 * 可能只差 23 或 25 小時，除下來會多算或少算一天。
 */
export function daysBetweenDateKeys(from: string, to: string): number | null {
  const start = Date.parse(`${from}T00:00:00Z`)
  const end = Date.parse(`${to}T00:00:00Z`)
  if (Number.isNaN(start) || Number.isNaN(end)) return null
  return Math.round((end - start) / 86_400_000)
}

/** 取得 `YYYY-MM-DD` 格式的當地日期字串。 */
export function toDateKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
