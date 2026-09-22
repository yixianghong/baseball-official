import { timingSafeEqual } from 'node:crypto'
import type { H3Event } from 'h3'
import { getRequestHeader } from 'h3'
import { AppError, ERROR_CODE } from './errors'
import { getSessionUser } from './session'

/**
 * 排程端點的驗證。
 *
 * ## 為什麼不用 session
 * Cloud Scheduler 沒有身分可登入，它只能帶固定的標頭。所以這是全站第二支
 * 「沒有 session 也能呼叫的寫入端點」（第一支是推播訂閱），閘門換成一把
 * 存在 Secret Manager 的共用密鑰。
 *
 * 後台登入的人也放行 —— 不然要驗證提醒有沒有寫對，只能等到隔天早上九點。
 */

/**
 * 比對密鑰。
 *
 * 用 `timingSafeEqual` 而不是 `===`：字串比較會在第一個不同的字元就回傳，
 * 從回應時間可以一個字元一個字元把密鑰試出來。這條路在網路上很難實際利用，
 * 但正確的寫法並不更麻煩。
 *
 * 長度不同時直接回 false —— `timingSafeEqual` 遇到長度不同會**拋例外**，
 * 而那個例外本身就洩漏了長度資訊。
 */
export function secretMatches(provided: string, expected: string): boolean {
  if (!expected || !provided) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/** 標頭名稱。Cloud Scheduler 的工作設定裡填同一個。 */
export const CRON_SECRET_HEADER = 'x-cron-secret'

/**
 * 放行排程器或已登入的管理者，否則擋下。
 *
 * 沒設定密鑰時一律擋 —— 空字串不該等於「不用驗證」，
 * 那會讓一個忘了設定的部署變成任何人都能觸發推播。
 */
export async function requireCronOrUser(event: H3Event): Promise<'cron' | 'user'> {
  const expected = useRuntimeConfig(event).cronSecret
  const provided = getRequestHeader(event, CRON_SECRET_HEADER) ?? ''
  if (secretMatches(provided, expected)) return 'cron'

  const user = await getSessionUser(event)
  if (user) return 'user'

  throw new AppError(ERROR_CODE.UNAUTHORIZED, '需要授權才能執行')
}
