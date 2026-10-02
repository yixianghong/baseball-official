import { z } from 'zod'
import { attendanceStatusSchema, type AttendanceEntry } from './game'

/**
 * 隊員自己回報出席的契約（`PUT /api/games/[id]/attendance`）。
 *
 * ## ⚠️ 這是全站第三支不需要登入的寫入端點
 * 前兩支是推播訂閱與 `/api/cron/*`。這個網站沒有前台登入系統，而出席回報的
 * 對象就是沒有帳號的隊員 —— 要求登入才能說「我會到」說不通。
 *
 * 少了身分驗證，防線只能從**攻擊面本身**下手，所以這支端點刻意做得極窄：
 *
 * 1. **只能改「已經在這場出席名單裡的那個人的狀態」** —— 不能新增人、
 *    不能改姓名或背號、不能動任何其他欄位。最壞的情況是「某個現有隊員的
 *    狀態被改成另一個合法值」，而那是後台一眼看得到、也隨時改得回來的。
 * 2. **不收自由文字。** 原本的 `note`（「晚到 30 分鐘」）維持只有後台能填 ——
 *    純信任模式下，自由文字是唯一能被拿來亂寫、而且會**顯示在公開頁面上**
 *    的東西。「待確認」已經表達得了「不一定趕得上」。
 * 3. **只有還沒開打的場次收得進去**（端點判斷）。已開打、已結束、延賽、
 *    取消的場次再改出席沒有意義，而且那等於一個天然的鎖盤。
 * 4. 限流由 `server/middleware/30.rate-limit.ts` 擋。
 *
 * ## 為什麼不照 ws-bracket 直連 Realtime Database
 * 那個功能能那樣做，第二個理由是「資料要跟正式資料**完全分家**」——
 * 出席剛好相反：它內嵌在比賽文件裡，後台的出席統計、打線編輯器、候補推導
 * （`deriveBench()`）、出賽名單圖卡全部讀它。多一份就是兩份會對不上的資料。
 *
 * 照抄的是**互動模式**（點自己的名字、不用登入、兩段式確認），不是資料路徑。
 */

/**
 * 可以自己回報的狀態。
 *
 * ⚠️ **`pending` 不在裡面。** 它是「還沒回覆」—— 一個狀態的*缺席*，不是一個
 * 答案。做成可以選的話，名單上會出現「他按了未回覆」和「他還沒按」兩種
 * 長得一模一樣、意思卻不同的情況。按錯就改成另一個答案。
 */
export const selfReportStatusSchema = attendanceStatusSchema.exclude(['pending'])
export type SelfReportStatus = z.infer<typeof selfReportStatusSchema>

export const attendanceAnswerSchema = z.object({
  playerId: z.string().min(1).max(64),
  status: selfReportStatusSchema,
})

export type AttendanceAnswer = z.infer<typeof attendanceAnswerSchema>

/**
 * 把一個人的回答套進出席名單。
 *
 * **名單上沒有這個人就回 `null`** —— 呼叫端據此回 404。這是這支端點最重要的
 * 一條限制：它只能改既有的那幾筆，不能把新的人塞進名單裡。
 *
 * 回傳新陣列，順序不動 —— 後台的出席編輯器依名單順序呈現，回報一次就把自己
 * 排到最前面會讓那張表每次打開都長得不一樣。
 */
export function applyAttendanceAnswer(
  entries: readonly AttendanceEntry[],
  answer: AttendanceAnswer,
): AttendanceEntry[] | null {
  const index = entries.findIndex((entry) => entry.playerId === answer.playerId)
  if (index === -1) return null

  const next = [...entries]
  next[index] = { ...entries[index]!, status: answer.status }
  return next
}
