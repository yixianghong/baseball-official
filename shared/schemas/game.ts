import { z } from 'zod'
import { patchSchemaOf } from './common'
import { citySchema } from './weather'
import { positionSchema } from './player'
import { gameHalfSchema, halfInningOrder, homeAwaySchema, type GameHalf } from './half-inning'
import { MAX_PLAYS_PER_GAME, playSchema } from './play'

/**
 * 半局的座標與推導（`battingSide()`、`scoreboardSides()`、`HALF_LABELS`…）
 * 住在 `half-inning.ts`，因為 `play.ts` 也要用而 `game.ts` 又要用 `play.ts`
 * —— 留在這個檔案裡就是一個循環 import。
 *
 * 這一行讓它們**照樣從 `#shared/schemas/game` 匯入得到**，全站既有的
 * import 路徑一個都不用改。搬家不該是一次跨越幾十個檔案的改動。
 */
export * from './half-inning'

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
 * ## 三個主要狀態走的是一條時間線
 * `scheduled` → `live` → `finished`，對應的是同一場比賽的賽前、進行中、賽後。
 * 前台完全依它決定要顯示什麼：尚未開始看出席與先發，比賽中看即時比數（LIVE），
 * 結束後看最終比數與勝敗（FINAL）。
 *
 * ## 延賽與取消是岔出去的兩條，彼此也不一樣
 * 延賽是「這天沒打成，之後會再排」，取消是「不打了」。對球隊來說是兩件事 ——
 * 延賽的場次還會回來，取消的不會，所以不能合併成一個「沒打成」。
 */
export const gameStatusSchema = z.enum(['scheduled', 'live', 'finished', 'postponed', 'canceled'])
export type GameStatus = z.infer<typeof gameStatusSchema>

export const GAME_STATUS_LABELS: Record<GameStatus, string> = {
  scheduled: '尚未開始',
  live: '比賽中',
  finished: '比賽結束',
  postponed: '延賽',
  canceled: '取消',
}

/**
 * 主要流程上的三個狀態，依時間先後排列。
 *
 * 後台的狀態切換器用它產生按鈕 —— 順序寫在這裡而不是在頁面上重排一次，
 * 因為「賽前 → 進行中 → 賽後」這個順序本身就是這個欄位的意義的一部分。
 */
export const GAME_FLOW_STATUSES = ['scheduled', 'live', 'finished'] as const

/** 岔出去的狀態：這一天沒有打成。 */
export const GAME_EXCEPTION_STATUSES = ['postponed', 'canceled'] as const

/** 出席狀態。`pending` 是「還沒回覆」，與明確回答「不出席」不同。 */
export const attendanceStatusSchema = z.enum(['yes', 'no', 'maybe', 'pending'])
export type AttendanceStatus = z.infer<typeof attendanceStatusSchema>

export const ATTENDANCE_LABELS: Record<AttendanceStatus, string> = {
  yes: '出席',
  no: '不出席',
  maybe: '待確認',
  pending: '未回覆',
}

/** 比賽結果。一律由計分板推導，見 `gameResult()`。 */
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

/**
 * 一段賽事錄影（見 `docs/game-recording-plan.md`）。
 *
 * 影片本體在 YouTube，這裡只存 11 碼的 videoId —— 不存網址：網址有
 * `watch?v=`、`youtu.be/`、`/live/` 好幾種寫法，存進去就得在每個用到的地方
 * 各解析一次。存 ID，要什麼形式就組什麼形式。
 */
export const clipPrivacySchema = z.enum(['private', 'unlisted', 'public'])
export type ClipPrivacy = z.infer<typeof clipPrivacySchema>

export const gameClipSchema = z.object({
  inning: z.number().int().min(1).max(20),
  half: gameHalfSchema,
  /** 會變成前台 iframe 的網址，所以驗格式而不是照單全收。 */
  videoId: z.string().regex(/^[\w-]{11}$/, '不是有效的 YouTube 影片 ID'),
  /**
   * YouTube 上的可見度。
   *
   * ⚠️ **透過 API 上傳的影片一律是 `private`**，而且和我們送什麼無關 ——
   * 未通過 YouTube 合規稽核的專案（2020/07/28 之後建立的都算）強制如此。
   * 管理者要到 YouTube Studio 手動改成公開，改完再按後台的「更新影片狀態」。
   *
   * 前台**只渲染非 private 的片段**：私人影片嵌進去只會顯示「無法播放」，
   * 而那是訪客看到的畫面。
   */
  privacy: clipPrivacySchema.default('private'),
  createdAt: z.string(),
})

export type GameClip = z.infer<typeof gameClipSchema>

/**
 * 一個半局的賽況敘述（AI 產生、人確認後存下來的那一段話）。
 *
 * 以「第幾局的哪半局」為鍵，和 `clips`、`plays` 同一個身分概念 ——
 * 重新產生就覆蓋同一格，不會疊第二筆。
 *
 * ⚠️ **打席一變，這一格就會被刪掉**（`saveHalfInningPlays()`）。
 * 敘述是從打席寫出來的，改了打席之後那段話描述的就是別的事了，
 * 而前台看得到它 —— 留著就是對訪客說一件沒有發生過的事。
 * 「寧可空白，也不要一段看起來很專業但是錯的文字」和「少登三場的 .412
 * 比沒有數字糟糕得多」是同一條原則。要的話重新產生一次（約 US$0.003）。
 */
export const halfInningNarrativeSchema = z.object({
  inning: z.number().int().min(1).max(20),
  half: gameHalfSchema,
  text: z.string().trim().max(400),
  createdAt: z.string(),
})

export type HalfInningNarrative = z.infer<typeof halfInningNarrativeSchema>

/** 這個半局的敘述，沒有就回 `null`。 */
export function narrativeOf(
  narratives: HalfInningNarrative[],
  inning: number,
  half: GameHalf,
): HalfInningNarrative | null {
  return narratives.find((item) => item.inning === inning && item.half === half) ?? null
}

/** 依比賽順序排好（第 3 局上 → 第 3 局下 → 第 4 局上），空白的不列。 */
export function orderedNarratives(narratives: HalfInningNarrative[]): HalfInningNarrative[] {
  return narratives
    .filter((item) => item.text)
    .slice()
    .sort((a, b) => halfInningOrder(a.inning, a.half) - halfInningOrder(b.inning, b.half))
}

/** 前台看得到的片段：已經公開，而且依比賽順序排好。 */
export function visibleClips(clips: GameClip[]): GameClip[] {
  return clips
    .filter((clip) => clip.privacy !== 'private')
    .sort(
      (a, b) => a.inning - b.inning || (a.half === 'top' ? -1 : 1) - (b.half === 'top' ? -1 : 1),
    )
}

/**
 * YouTube 的嵌入網址。
 *
 * 用 nocookie 網域：訪客還沒點播放就不該被種追蹤 cookie。
 *
 * ## 參數
 * - `autoplay=1` —— iframe 是使用者點了縮圖**之後**才建立的，所以瀏覽器把那次
 *   點擊算成播放的使用者操作，影片會直接開始。這很重要：**沒有真的播起來的
 *   播放器會停在封面畫面，而且整片蓋著標題、頻道頭像、正中央的紅色播放鈕與
 *   「觀看平台：YouTube」**，正在播的時候那些反而會自己隱藏。
 * - `rel=0` —— 播完的結尾推薦只列本頻道的影片，不會跳出一整片別人的內容。
 * - `playsinline=1` —— iOS 維持在頁面裡播，不搶成系統的全螢幕播放器。
 *
 * ## ⚠️ 不要再加 `modestbranding=1`
 * 它在 2023/08/15 被 YouTube 停用了，加了也不會有任何效果 —— 現在**沒有任何
 * 參數**可以拿掉播放器上方的標題列與 YouTube 標誌。想讓畫面少被擋，
 * 唯一有效的做法是把播放器放大（見 `GameClips.vue`）。
 *
 * `controls=0` 可以拿掉下面那條控制列，但代價是**不能拖動進度、也沒有全螢幕鈕**
 * —— 一段是半局六到八分鐘，不能拖進度的影片很難看完，所以刻意不用。
 * 而且它只拿掉控制列：暫停時那一整片標題與品牌覆蓋照樣會出現（實測過）。
 */
export function clipEmbedUrl(videoId: string): string {
  return `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0&playsinline=1`
}

/**
 * 從使用者貼上的東西裡取出 YouTube 影片 ID。
 *
 * ## 為什麼需要它
 * 自動上傳失敗時（額度用完、網路斷了），人會自己把影片傳上 YouTube，
 * 再回後台補登。而他手上拿到的是一個網址 —— 而且是哪一種網址不一定：
 * 手機分享給的是 `youtu.be`、瀏覽器網址列是 `watch?v=`、
 * 從 Studio 複製的是 `studio.youtube.com/video/<id>/edit`。
 *
 * 認不出來時回空字串，由呼叫端決定要怎麼講 —— 這裡不丟例外，
 * 因為「貼錯東西」是使用者每天都會做的事，不是異常。
 *
 * ## 網域要驗
 * 取出來的 ID 會變成前台 iframe 的網址。只靠「像不像 11 碼」判斷的話，
 * 貼一個 Vimeo 連結也可能剛好湊出 11 個字元而被靜靜接受 ——
 * 那比直接說「認不出來」糟糕得多。
 */
const YOUTUBE_HOSTS = [
  'youtu.be',
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'studio.youtube.com',
  'www.youtube-nocookie.com',
]

const VIDEO_ID_PATTERN = /^[\w-]{11}$/

export function parseYouTubeVideoId(input: string): string {
  const value = input.trim()
  if (!value) return ''

  // 直接貼 ID 也要收 —— 從我們自己的後台複製出來的就是 ID
  if (VIDEO_ID_PATTERN.test(value)) return value

  let url: URL
  try {
    url = new URL(value)
  } catch {
    return ''
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return ''
  if (!YOUTUBE_HOSTS.includes(url.hostname)) return ''

  // `watch?v=` 與 `shorts` 之外，其餘形式的 ID 都在路徑的某一段上
  const fromQuery = url.searchParams.get('v')
  if (fromQuery && VIDEO_ID_PATTERN.test(fromQuery)) return fromQuery

  const segments = url.pathname.split('/').filter(Boolean)
  // `youtu.be/<id>`、`/live/<id>`、`/embed/<id>`、`/shorts/<id>`、
  // `studio.youtube.com/video/<id>/edit` —— 取第一段符合格式的
  const fromPath = segments.find((segment) => VIDEO_ID_PATTERN.test(segment))
  return fromPath ?? ''
}

/** 影片縮圖。前台預設只載縮圖，點了才換成 iframe。 */
export function clipThumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
}

/**
 * 先發投手。
 *
 * ## 為什麼只剩先發，而不是一份投手紀錄
 * 這裡原本是 `pitchers`（先發／中繼／終結 + 一句純文字成績）與 `batters`
 * （每個打者一句「4 打數 2 安打」）兩份賽後紀錄。逐打席紀錄上線之後，
 * 誰投了幾局、誰打了什麼都由打席推導（`box-score.ts`），那兩份純文字就成了
 * **第二個來源** —— 兩邊寫的不一樣時，前台沒有辦法知道該信哪一個。
 *
 * 先發投手留下來，因為它是**賽前**的資訊：出賽名單圖卡要印、DH 制下的候補
 * 名單要排除他（見 `deriveBench()`），而那時候還沒有任何打席可以推導。
 * 中繼與終結投手是比賽中才出現的，記在打席的 `pitcher` 上。
 *
 * 舊文件上的 `pitchers`／`batters` 在讀取時被 schema 丟掉（Firestore 上的鍵
 * 還在，只是沒有程式碼看它），先發投手由 `migrateLegacyGame()` 從舊的
 * `pitchers` 裡撈出來，所以舊比賽的出賽名單圖卡不受影響。
 */
export const startingPitcherSchema = z.object({
  playerId: z.string().default(''),
  name: z.string().min(1),
  number: z.string().default(''),
})

export type StartingPitcher = z.infer<typeof startingPitcherSchema>

/**
 * 把舊格式的比賽文件轉成現在的形狀。**在 schema 驗證之前**呼叫（repository）。
 *
 * 目前只處理一件事：舊文件沒有 `startingPitcher`，但 `pitchers` 裡有一筆
 * `role: 'starter'`。不轉的話，所有舊比賽的出賽名單圖卡都會少掉先發投手，
 * 而 DH 制的場次會把他重新列進候補（那正是 `deriveBench()` 修過的 bug）。
 *
 * 只在 `startingPitcher` **完全不存在**時才轉：存過一次之後它就是 `null` 或
 * 一個人，使用者清空的先發投手不能被舊資料偷偷補回來。
 */
export function migrateLegacyGame(raw: Record<string, unknown>): Record<string, unknown> {
  if (raw.startingPitcher !== undefined || !Array.isArray(raw.pitchers)) return raw

  const starter = (raw.pitchers as Array<Record<string, unknown>>).find(
    (pitcher) => pitcher?.role === 'starter' && typeof pitcher.name === 'string' && pitcher.name,
  )
  return {
    ...raw,
    startingPitcher: starter
      ? {
          playerId: String(starter.playerId ?? ''),
          name: String(starter.name),
          number: String(starter.number ?? ''),
        }
      : null,
  }
}

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

/**
 * 把 R（總得分）對齊逐局加總。
 *
 * ## 為什麼 R 不是一個自己輸入的欄位
 * 它完全由逐局得分決定，多存一份就多一個會不同步的東西 —— 和勝敗
 * （`gameResult()`）、候補名單（`deriveBench()`）是同一個道理。
 *
 * 後台曾經有一顆「用逐局加總填入 R」的按鈕，等於把「保持一致」這件事
 * 外包給使用者記得按；沒按的下場是計分板上逐局是 3:1、R 欄寫著 0:0，
 * 而前台的比數、勝敗、戰績全部讀 R。
 *
 * H／E 沒有逐局欄位可以加總；它們在逐打席涵蓋整隊時由打席推導
 * （`applyPlayDerivedScores()`），否則人工輸入。
 */
export function withSummedRuns(scoreboard: Scoreboard): Scoreboard {
  const sums = sumInnings(scoreboard)
  if (sums.our === scoreboard.totals.our.r && sums.opponent === scoreboard.totals.opponent.r) {
    return scoreboard
  }
  return {
    ...scoreboard,
    totals: {
      our: { ...scoreboard.totals.our, r: sums.our },
      opponent: { ...scoreboard.totals.opponent, r: sums.opponent },
    },
  }
}

/** 由總分推導勝敗。 */
export function deriveResult(totals: Scoreboard['totals']): GameResult {
  if (totals.our.r > totals.opponent.r) return 'win'
  if (totals.our.r < totals.opponent.r) return 'loss'
  return 'tie'
}

/**
 * 這場比賽的勝敗。**只有「比賽結束」才有結果**，其餘一律是 `null`。
 *
 * ## 為什麼是推導的，而不是一個存起來的欄位
 * 勝敗完全由「狀態」與「計分板總分」兩份既有資料決定，和候補名單是同一個
 * 道理（見 `deriveBench()`）—— 多存一份就多一個會不同步的東西。曾經有一個
 * 「比賽結果」下拉選單可以手動覆寫，實際發生的事是：後台改了計分板、忘了
 * 回頭改那個選單，於是前台出現「6:3」配上一個「敗」。
 *
 * ## 為什麼要綁在 `finished` 上
 * 空的計分板總分是 0:0，推導出來會是「和」。不綁狀態的話，每一場還沒打的
 * 比賽都會帶著一個「和」的結果 —— 而 0:0 的「和」和「還沒打」在畫面上
 * 長得一模一樣。進行中的比賽同理：領先不等於贏了。
 */
export function gameResult(game: Pick<Game, 'status' | 'scoreboard'>): GameResult | null {
  if (game.status !== 'finished') return null
  return deriveResult(game.scoreboard.totals)
}

/** 一段期間的戰績。 */
export interface TeamRecord {
  win: number
  loss: number
  tie: number
  /** 實際打完的場次數 —— 延賽與取消不算。 */
  total: number
}

/**
 * 統計一批比賽的勝敗。
 *
 * **只算已經結束的場次。** 傳進來的列表通常直接就是「過去的比賽」，而那裡面
 * 混著延賽的場次（它們也列在結果頁上）。拿 `games.length` 當場次數的話，
 * 「近 3 戰 2 勝 0 敗」裡那消失的一場其實是延賽 —— 看起來像少算了一場。
 */
export function tallyRecord(games: Pick<Game, 'status' | 'scoreboard'>[]): TeamRecord {
  const record: TeamRecord = { win: 0, loss: 0, tie: 0, total: 0 }
  for (const game of games) {
    const result = gameResult(game)
    if (!result) continue
    record[result] += 1
    record.total += 1
  }
  return record
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
   * 出席回報的截止時間（台北時間，`YYYY-MM-DDTHH:mm`）。空字串＝不另外設。
   *
   * 隊員是在前台自己回報的，所以要有一條線告訴大家「過了這個時間就以名單為準」
   * —— 教練要照它排打線、訂便當。設不設都可以：**比賽開打本來就會鎖**
   * （`attendanceLocked()`），這個欄位只是把那條線往前挪。
   *
   * ⚠️ **存台北時間的牆上時鐘，不存 UTC 也不存時間戳。** 和同一份文件上的
   * `date`／`time` 同一個慣例，而且它和 `<input type="datetime-local">` 的值
   * 一模一樣 —— 中間不經過任何換算，就沒有「Cloud Run 跑在 UTC、本機重現不了」
   * 的那一類時區錯誤（見 `taipeiDateTimeKey()`）。格式固定寬度又補零，
   * 所以比大小直接比字串。
   */
  attendanceLockAt: z
    .string()
    .trim()
    .regex(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})?$/, '格式需為 YYYY-MM-DDTHH:mm')
    .default(''),

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
  /** 先發投手。為什麼只剩它，見 `startingPitcherSchema`。 */
  startingPitcher: startingPitcherSchema.nullable().default(null),
  scoreboard: scoreboardSchema.default(emptyScoreboard()),
})

export type GameInput = z.input<typeof gameInputSchema>

export const gamePatchSchema = patchSchemaOf(gameInputSchema)
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
  /**
   * 賽事錄影的片段。
   *
   * 和 `remindersSent` 一樣**刻意不放進 `gameInputSchema`** —— 它是系統寫的
   * 狀態，不是人填的欄位。放進去的話後台編輯表單每次存檔都會連帶送出，
   * 漏帶一次就等於把整場的影片清空。
   */
  clips: z.array(gameClipSchema).max(40).default([]),
  /**
   * 逐打席紀錄（見 `shared/schemas/play.ts`）。
   *
   * **和 `clips`、`remindersSent` 一樣刻意不放進 `gameInputSchema`**，而且
   * 這一份的後果最嚴重：後台的編輯表單是自動儲存的，放進 input schema
   * 之後，光是改一個場地名稱就會把整場兩百筆打席重送一次，漏帶一次就是
   * 整場的紀錄清空。它走自己的端點（`PUT /admin/games/[id]/plays`），
   * 以「第幾局的哪半局」為鍵覆蓋，和影片完全同一套。
   *
   * 內嵌在比賽文件裡而不是另開子集合：一場約 100 筆、36KB，遠小於
   * Firestore 單文件 1MB 的上限，而「看一場比賽只要一次讀取」這件事
   * 對前台的比賽頁與 box score 都成立。
   */
  plays: z.array(playSchema).max(MAX_PLAYS_PER_GAME).default([]),
  /**
   * 每個半局的賽況敘述。
   *
   * **和 `clips`、`plays`、`remindersSent` 一樣刻意不放進 `gameInputSchema`**
   * —— 同樣的理由：後台表單是自動儲存、整份送出的，放進去之後漏帶一次就是
   * 整場的敘述清空。它走自己的端點（`PUT /admin/games/[id]/narrative`）。
   */
  narratives: z.array(halfInningNarrativeSchema).max(40).default([]),
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
 * 比賽正在進行中 —— 前台顯示 LIVE 與即時比數。
 *
 * 同樣以 `status` 為準而不是「日期是今天、時間已過」：一場比賽打多久沒有定數，
 * 而用時間推算的話，忘了按結束的場次會自己「打完」，真正還在打的場次卻
 * 可能因為超過某個時數而被判定結束。這是一個人按下去的狀態。
 */
export function isLive(game: Pick<Game, 'status'>): boolean {
  return game.status === 'live'
}

/**
 * 有沒有比數可以顯示（進行中的即時比數、或結束後的最終比數）。
 *
 * 延賽與取消的場次計分板是空的，總分兩邊都是 0 —— 直接顯示就變成「0:0」，
 * 看起來像打完了而且是和局。
 */
export function hasScore(game: Pick<Game, 'status'>): boolean {
  return game.status === 'live' || game.status === 'finished'
}

/**
 * 候補名單 —— 確定出席、但**今天沒有上場**的人。
 *
 * ## 為什麼是推導出來的，不另外存一份
 * 候補完全由「出席」「打線」「先發投手」「打席」幾份既有資料決定，多存一份就多一份會
 * 不同步的東西：把人排進打線卻忘了從候補移除，畫面上就會出現同一個人既先發
 * 又候補。推導不可能對不上，也不需要任何資料遷移。
 *
 * ## ⚠️ 「沒上場」不等於「不在打線上」
 * **DH 制下先發投手不打擊，所以他根本不會出現在打線裡** —— 只看打線的話，
 * 出賽名單圖卡上就會同時出現「先發投手 #28」和「候補 #28」，同一個人被說成
 * 今天最先發的和坐板凳的。實際發生過，見這個函式的測試。
 *
 * 所以要排除的是**打線 ∪ 先發投手 ∪ 打席上出現過的人**。最後一項是比賽中
 * 才有的：代打的人（打席的 `batter`）與中繼、終結投手（打席的 `pitcher`）。
 * 賽前沒有打席，不影響；賽後把他們排除也是對的 —— 他們上場了，不是板凳上的人。
 *
 * ## 比對方式
 * 以 `playerId` 為主，姓名為輔。打線、先發投手、打席都允許 `playerId` 為空
 * （臨時來支援的球友不在名單裡，但名單上要寫得出他），而且後台可以直接
 * 手打名字而不從清單挑 —— 少了姓名比對，這種情況下已經上場的人會被誤判成
 * 還坐在板凳上。
 *
 * 前台兩種狀態都用得到，只是意思不同：
 * - 未開打：這些人有空，是換人時的選項
 * - 已結束：這些人當天有到，但沒有上場
 */
export function deriveBench(
  game: Pick<Game, 'attendance' | 'lineup' | 'startingPitcher'> & { plays?: Game['plays'] },
): AttendanceEntry[] {
  const playing = [
    ...game.lineup,
    ...(game.startingPitcher ? [game.startingPitcher] : []),
    ...(game.plays ?? []).flatMap((play) => [play.batter, play.pitcher]),
  ]
  const playingIds = new Set(playing.map((entry) => entry.playerId).filter(Boolean))
  const playingNames = new Set(
    playing.map((entry) => entry.name.trim()).filter((name) => name.length > 0),
  )

  return game.attendance.filter((entry) => {
    if (entry.status !== 'yes') return false
    if (entry.playerId && playingIds.has(entry.playerId)) return false
    return !playingNames.has(entry.name.trim())
  })
}

/** 沒有打成的場次（延賽或取消）—— 不該顯示比數，也不列入戰績。 */
export function isNotPlayed(game: Pick<Game, 'status'>): boolean {
  return game.status === 'postponed' || game.status === 'canceled'
}

/**
 * 日期已過、卻還停在「尚未開始」或「比賽中」—— 後台列表據此提醒你補登結果。
 *
 * @param today `YYYY-MM-DD` 格式的今天，由呼叫端傳入而不在這裡取
 *              `new Date()`，SSR 與 client 才不會因為時區差異算出不同結果。
 */
export function needsResultUpdate(game: Pick<Game, 'status' | 'date'>, today: string): boolean {
  if (game.date >= today) return false
  // 進行中也算：那代表當天按了「比賽中」卻沒有按「比賽結束」，
  // 而這種場次會在前台一直掛著 LIVE，比忘了登錄結果更明顯地錯
  return game.status === 'scheduled' || game.status === 'live'
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
 * 台北時間的「現在」，`YYYY-MM-DDTHH:mm`。
 *
 * 和 `taipeiDateKey()` 同一個理由（Cloud Run 跑在 UTC，本機重現不了），
 * 只是多到分鐘。這個格式**和 `<input type="datetime-local">` 吐出來的
 * 一模一樣**，而且是固定寬度、補零的 —— 所以「現在過了截止時間沒有」
 * 直接用字串比大小就對，不必換算成 Date（換算才是會出錯的那一步）。
 */
export function taipeiDateTimeKey(now: Date = new Date()): string {
  return new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 16)
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
