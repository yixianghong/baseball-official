import type { z } from 'zod'
import { AppError, ERROR_CODE } from '../utils/errors'
import { logger } from '../utils/logger'

/**
 * repository 層共用的小工具。
 *
 * ## 這一層的紀律
 * `server/api/**` 只呼叫 repository，不直接碰 Firestore SDK。
 * 這和樣板「頁面只呼叫 composable，不寫 API 路徑」是同一個原則往下延伸一層：
 * 資料來源要換（Firestore → Postgres、或加一層快取）時，只改這個資料夾。
 *
 * 每個 repository 都會在兩種模式間切換：有 Firebase 憑證走 Firestore，
 * 沒有就走 `server/utils/memory-store.ts` 的記憶體資料。切換邏輯藏在
 * repository 內部，端點完全不需要知道。
 */

/** 現在時間的 ISO 字串。所有 `createdAt` / `updatedAt` 都用這個格式。 */
export function nowIso(): string {
  return new Date().toISOString()
}

/**
 * 用 zod 驗證「從資料庫讀出來的資料」。
 *
 * 這是常被忽略但很重要的一環 —— 相當於樣板的 `validateUpstream()`：
 * 欄位被手動改壞、schema 演進留下舊資料時，應該在這一層就發現並記錄，
 * 而不是讓壞資料流到前端才在畫面上炸開。
 *
 * schema 中定義了 default 的欄位會自動補上，所以新增欄位不需要回填舊文件。
 */
export function parseEntity<S extends z.ZodType>(
  schema: S,
  raw: unknown,
  label: string,
): z.output<S> {
  const result = schema.safeParse(raw)
  if (!result.success) {
    logger.error(
      { entity: label, issues: result.error.issues },
      'stored document failed schema validation',
    )
    throw new AppError(ERROR_CODE.INTERNAL_ERROR, undefined, { cause: result.error })
  }
  return result.data
}

/**
 * 同上，但驗證失敗時回傳 null 而不是拋錯。
 *
 * 用在列表查詢：一筆壞資料不該讓整個頁面掛掉，記錄下來然後跳過它。
 */
export function parseEntityOrNull<S extends z.ZodType>(
  schema: S,
  raw: unknown,
  label: string,
): z.output<S> | null {
  const result = schema.safeParse(raw)
  if (!result.success) {
    logger.warn({ entity: label, issues: result.error.issues }, 'skipping malformed document')
    return null
  }
  return result.data
}

/** 找不到資料時的統一錯誤。 */
export function notFound(what: string): AppError {
  return new AppError(ERROR_CODE.NOT_FOUND, `找不到指定的${what}`)
}
