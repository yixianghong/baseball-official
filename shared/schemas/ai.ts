import { z } from 'zod'
import { attendanceStatusSchema, homeAwaySchema, inningScoreSchema, sideTotalsSchema } from './game'
import { handSchema, positionSchema } from './player'

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
