import { z } from 'zod'
import { attendanceStatusSchema, homeAwaySchema, inningScoreSchema, sideTotalsSchema } from './game'
import { handSchema, positionSchema } from './player'
import { battedTypeSchema, playResultSchema } from './play'

/**
 * Gemini 圖片辨識的共用契約。
 *
 * ## 為什麼圖片走 base64 JSON 而不是 multipart
 * 樣板的 `40.body-guard.ts` 只放行 JSON 這類可預期的內容型別，而辨識用的圖片
 * 經前端壓縮後通常只有兩三百 KB。用 JSON 帶 base64 可以完全沿用既有的驗證、
 * CSRF 與錯誤處理管線，不必為了一個欄位引入 multipart 解析器。
 * 代價是 base64 會膨脹約 33%，已反映在 `maxUploadBytes` 的設定上。
 *
 * ## 辨識結果永遠不直接寫進資料庫
 * 這些 schema 描述的是「AI 的建議」，一律先回到後台表單讓人確認、修改後
 * 才送出正式的建立／更新請求。`confidence` 與 `warnings` 就是給人判斷用的。
 */

/** 可接受的圖片格式。 */
export const imageMimeSchema = z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/heic'])

/** 帶圖片的請求主體。 */
export const imagePayloadSchema = z.object({
  /** 不含 `data:` 前綴的純 base64 字串。 */
  imageBase64: z.string().min(32, '缺少圖片內容'),
  mimeType: imageMimeSchema,
})

/** 辨識賽程圖的請求。 */
export const parseScheduleRequestSchema = imagePayloadSchema.extend({
  /**
   * 我方隊名（可多個寫法）。Gemini 會用它從整張公告中挑出我隊的場次，
   * 其餘隊伍的對戰一律忽略。
   */
  teamNames: z.array(z.string().trim().min(1)).min(1, '請至少提供一個隊名').max(8),
  /** 公告上若只寫月／日沒有年份，用這個年份補齊。 */
  defaultYear: z.number().int().min(2000).max(2100).optional(),
})

export type ParseScheduleRequest = z.infer<typeof parseScheduleRequestSchema>

/** 辨識出的單一場次。所有欄位都可能為空 —— 公告圖不一定寫了全部資訊。 */
export const parsedMatchSchema = z.object({
  date: z.string().default(''),
  time: z.string().default(''),
  opponent: z.string().default(''),
  venue: z.string().default(''),
  league: z.string().default(''),
  homeAway: homeAwaySchema.nullable().default(null),
  /** 0～1，模型對這一列的把握程度。低於 0.6 的在後台會標示提醒。 */
  confidence: z.number().min(0).max(1).default(0),
  /** 這一列在原圖上的文字，方便人工核對。 */
  sourceText: z.string().default(''),
})

export type ParsedMatch = z.infer<typeof parsedMatchSchema>

export const parseScheduleResponseSchema = z.object({
  matches: z.array(parsedMatchSchema).default([]),
  /** 模型或後端驗算發現的問題，直接顯示在後台。 */
  warnings: z.array(z.string()).default([]),
})

export type ParseScheduleResponse = z.infer<typeof parseScheduleResponseSchema>

/** 辨識計分板的請求。 */
export const parseScoreboardRequestSchema = imagePayloadSchema.extend({
  /**
   * 我方隊名。計分板上有兩列，模型需要知道哪一列是我隊。
   * 判斷不出來時會在 `warnings` 說明，並以第一列當我隊。
   */
  teamNames: z.array(z.string().trim().min(1)).min(1).max(8),
})

export type ParseScoreboardRequest = z.infer<typeof parseScoreboardRequestSchema>

export const parseScoreboardResponseSchema = z.object({
  innings: z.array(inningScoreSchema).default([]),
  totals: z.object({ our: sideTotalsSchema, opponent: sideTotalsSchema }),
  /** 模型辨識到的對手隊名，可用來核對是不是抓錯場次。 */
  opponentName: z.string().default(''),
  confidence: z.number().min(0).max(1).default(0),
  warnings: z.array(z.string()).default([]),
})

export type ParseScoreboardResponse = z.infer<typeof parseScoreboardResponseSchema>

/** 辨識球員名冊的請求。 */
export const parseRosterRequestSchema = imagePayloadSchema

export type ParseRosterRequest = z.infer<typeof parseRosterRequestSchema>

/**
 * 辨識出的一位球員。
 *
 * 守備位置與慣用手已由後端正規化成 schema 的列舉值 —— 名冊上寫「投手」「P」
 * 「右投右打」的都有，那種對照不該留給前端每個表單各做一次。
 */
export const parsedPlayerSchema = z.object({
  number: z.string().default(''),
  name: z.string().default(''),
  positions: z.array(positionSchema).default([]),
  bats: handSchema.default('R'),
  throws: handSchema.default('R'),
  joinedYear: z.number().int().nullable().default(null),
  confidence: z.number().min(0).max(1).default(0),
  /** 這一列在原圖上的文字，方便人工核對。 */
  sourceText: z.string().default(''),
})

export type ParsedPlayer = z.infer<typeof parsedPlayerSchema>

export const parseRosterResponseSchema = z.object({
  players: z.array(parsedPlayerSchema).default([]),
  warnings: z.array(z.string()).default([]),
})

export type ParseRosterResponse = z.infer<typeof parseRosterResponseSchema>

/**
 * 辨識出席投票截圖的請求。
 *
 * `roster` 是現有的球員名單，會一起送給模型做名字對應 —— LINE 上的暱稱
 * 常常不是本名（「阿豪」可能是「張志豪」），這種判斷交給模型比在後端寫
 * 字串比對規則可靠得多。
 */
export const parseAttendanceRequestSchema = imagePayloadSchema.extend({
  roster: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        number: z.string().default(''),
      }),
    )
    .max(80),
})

export type ParseAttendanceRequest = z.infer<typeof parseAttendanceRequestSchema>

/** 辨識出的一筆出席回覆。 */
export const parsedAttendanceSchema = z.object({
  /** 對應到的球員 id。對不上名單時為空字串，由後台手動指定。 */
  playerId: z.string().default(''),
  /** 截圖上顯示的名字（可能是暱稱），供人工核對用。 */
  displayName: z.string().default(''),
  status: attendanceStatusSchema.default('pending'),
  confidence: z.number().min(0).max(1).default(0),
})

export type ParsedAttendance = z.infer<typeof parsedAttendanceSchema>

export const parseAttendanceResponseSchema = z.object({
  entries: z.array(parsedAttendanceSchema).default([]),
  warnings: z.array(z.string()).default([]),
})

export type ParseAttendanceResponse = z.infer<typeof parseAttendanceResponseSchema>

/**
 * 可接受的音訊格式（逐打席的語音登錄）。
 *
 * ## ⚠️ 這份清單是實測出來的，不是照文件抄的
 * Gemini 的文件只列 wav／mp3／aiff／aac／ogg／flac —— 不含 `audio/webm`
 * （Chrome 產出）與 `audio/mp4`（iOS Safari 產出），也就是 `MediaRecorder`
 * 實際會吐出來的那兩種。實測結果：**`audio/mp4` 其實收得下**（同一段語音
 * 標成 `audio/mp4` 或 `audio/aac` 都正確轉出文字）。
 *
 * 不過前端**預設還是會先轉成 16kHz 單聲道 WAV** 再送（見 `app/utils/wav.ts`），
 * 理由是一條路比兩條路好：`audio/webm` 到現在都沒有實測過，而 Android 的
 * Chrome 只錄得出它。真的轉不成功時才退回送原始格式，所以這裡兩種都收。
 */
export const audioMimeSchema = z.enum([
  'audio/wav',
  'audio/mp4',
  'audio/aac',
  'audio/webm',
  'audio/ogg',
])

/**
 * 用語音登錄逐打席的請求。
 *
 * 把名冊與「已經登錄了什麼」一起送給模型，理由和出席截圖辨識
 * （`parseAttendanceRequestSchema`）相同：這種對應交給模型比在後端寫字串
 * 比對規則可靠得多。講的人會說「24 號三壘安打」，而 24 號是誰、現在輪到
 * 第幾棒、還剩幾個出局，都是判斷的依據。
 */
export const parsePlaysRequestSchema = z.object({
  /** 不含 `data:` 前綴的純 base64 字串。 */
  audioBase64: z.string().min(32, '缺少語音內容'),
  mimeType: audioMimeSchema,
  inning: z.number().int().min(1).max(20),
  half: z.enum(['top', 'bottom']),
  /** 現在是我隊還是對手在打擊 —— 決定要不要把背號對到我隊名冊上。 */
  batting: z.enum(['our', 'opponent']),
  /** 我隊名冊（背號 → 姓名）。對手打擊時只會用到背號。 */
  roster: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        number: z.string().default(''),
      }),
    )
    .max(80)
    .default([]),
  /** 這個半局已經登錄的打席，讓模型知道接下來輪到誰、還剩幾個出局。 */
  existing: z
    .array(z.object({ number: z.string().default(''), result: z.string().default('') }))
    .max(30)
    .default([]),
})

export type ParsePlaysRequest = z.infer<typeof parsePlaysRequestSchema>

/**
 * 辨識出的一個打席 —— **形狀對應 `playSchema` 的欄位**，語音裡沒講到的一律是 `null`。
 *
 * ## 為什麼是 `null` 而不是預設值
 * 「沒講」和「講了 0」是兩件事：沒講得分時，採用的那一刻才依結果帶預設值
 * （全壘打 1 分、其餘 0，見 `defaultRuns()`）；講了「沒有得分」就是 0。
 * 在這一層就填上預設值的話，後面分不出哪些是聽到的、哪些是猜的 ——
 * 而暫存卡片正是要讓人看清楚「系統聽到了什麼」。
 *
 * ## 各欄位的來源
 * | 欄位 | 來源 |
 * | --- | --- |
 * | `batter` | 語音講的背號，我隊打擊時對到名冊（對不上就只有背號） |
 * | `result` | 語音講的結果，由 `normalizePlayResult()` **用程式碼**收斂成列舉值；收不進去是 `null` |
 * | `runs`／`rbi` | 講了才有值 |
 * | `fielder` | 講了「游擊方向」「中外野」才有值，而且只在結果需要處理的人時保留（安打是 `null`） |
 * | `batted` | 講了「滾地」「平飛」「高飛」才有值，而且只在安打／失誤時保留（出局從結果推導） |
 * | `location` | **永遠是 `null`** —— 「游擊方向」猜出來的座標混進落點圖就會被當真；要落點就到列表上「補落點」 |
 *
 * 投手、左右打、第幾棒不在這裡：它們由登錄當下的狀態決定（現在誰在投、名冊、
 * 打線），和手動登錄走同一條路。
 */
export const parsedPlaySchema = z.object({
  batter: z.object({
    /** 對應到的我隊球員 id。對不上或是對手打者時為 `null`。 */
    playerId: z.string().nullable().default(null),
    name: z.string().nullable().default(null),
    number: z.string().nullable().default(null),
  }),
  result: playResultSchema.nullable().default(null),
  runs: z.number().int().min(0).max(4).nullable().default(null),
  rbi: z.number().int().min(0).max(4).nullable().default(null),
  location: z.null().default(null),
  fielder: positionSchema.nullable().default(null),
  batted: battedTypeSchema.nullable().default(null),
  confidence: z.number().min(0).max(1).default(0),
  /** 這一筆對應到語音裡的哪一句，供人工核對（採用後存進打席的 `transcript`）。 */
  sourceText: z.string().default(''),
})

export type ParsedPlay = z.infer<typeof parsedPlaySchema>

export const parsePlaysResponseSchema = z.object({
  plays: z.array(parsedPlaySchema).default([]),
  /** 整段語音的逐字稿。辨識錯的時候，看得到當初講了什麼才知道該改成什麼。 */
  transcript: z.string().default(''),
  warnings: z.array(z.string()).default([]),
})

export type ParsePlaysResponse = z.infer<typeof parsePlaysResponseSchema>

/** 上傳圖片的請求。 */
export const uploadRequestSchema = imagePayloadSchema.extend({
  /** 存放的用途分類，決定 Storage 上的資料夾。 */
  folder: z.enum(['players', 'announcements', 'games', 'site']).default('site'),
  /** 原始檔名，只用來取副檔名與方便日後辨認。 */
  filename: z.string().trim().max(120).default(''),
})

export type UploadRequest = z.infer<typeof uploadRequestSchema>

export const uploadResponseSchema = z.object({
  url: z.url(),
  path: z.string(),
})

export type UploadResponse = z.infer<typeof uploadResponseSchema>

/** 低於這個信心值就在後台標示「請人工確認」。 */
export const LOW_CONFIDENCE_THRESHOLD = 0.6
