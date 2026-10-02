import { defineApiHandler } from '../../../utils/handler'
import { validateBody } from '../../../utils/validate'
import { attendanceAnswerSchema } from '../../../../shared/schemas/attendance-request'
import { answerAttendance, getGame } from '../../../repositories/games'
import { attendanceLocked, formatLockAt } from '../../../../shared/schemas/attendance'
import { AppError, ERROR_CODE } from '../../../utils/errors'

/**
 * 隊員自己回報出席。
 *
 * ## 這支端點**沒有** `requireUser()`，是刻意的
 * 全站第三支（前兩支是推播訂閱與 `/api/cron/*`）。這個網站沒有前台登入系統，
 * 而回報出席的對象就是沒有帳號的隊員 —— 要求登入才能說「我會到」說不通，
 * 而且真的加一層 BFF 驗證也只能無條件放行，等於多寫一層什麼都沒擋住的東西。
 *
 * 所以防線不在身分，而在**把能做的事壓到最小**（完整理由見
 * `shared/schemas/attendance-request.ts`）：
 *
 * 1. 只能改**已經在名單上**的那個人的 `status`（`applyAttendanceAnswer()`）
 * 2. 只收三個列舉值，**不收自由文字**
 * 3. 只有**沒鎖盤**的場次收得進去：開打就鎖，後台還可以另外設一個更早的
 *    截止時間（`attendanceLocked()`，前後台共用同一支）
 * 4. 限流由 `30.rate-limit.ts` 擋
 *
 * 最壞的情況是「某個現有隊員的狀態被改成另一個合法值」——
 * 後台一眼看得到，也隨時改得回來。
 *
 * ## 回傳整份名單，不是只回「成功」
 * 按下去的人要立刻看到正確的畫面，而這一頁走 CDN 快取（最多 60 秒的舊資料）
 * —— 只回 `{ ok: true }` 的話，前端只能拿自己剛送的那一筆去猜，
 * 別人在這 60 秒內回報的就看不到。回整份是這個頁面唯一能拿到最新狀態的機會。
 */
export default defineApiHandler(async (event) => {
  const id = String(event.context.params?.id ?? '')
  const answer = await validateBody(event, attendanceAnswerSchema)

  const game = await getGame(id)
  if (!game) throw new AppError(ERROR_CODE.NOT_FOUND, '找不到這場比賽')

  /*
   * ⚠️ 鎖盤。兩條線取先到的那一條（`attendanceLocked()`，前後台共用）：
   * 開打就鎖（關不掉），以及後台設的截止時間。
   *
   * **真正擋得住的是這一次** —— 前台只是不畫出按不下去的按鈕。
   */
  if (attendanceLocked(game)) {
    throw new AppError(
      ERROR_CODE.CONFLICT,
      game.status === 'scheduled'
        ? `出席回報已於 ${formatLockAt(game.attendanceLockAt)} 截止，請直接聯絡隊長`
        : '這場比賽已經開始或結束，出席不能再修改',
    )
  }

  const attendance = await answerAttendance(id, answer)
  if (!attendance) {
    // 不在名單上的人不能靠這支端點把自己加進去
    throw new AppError(ERROR_CODE.NOT_FOUND, '這場比賽的名單上沒有這位隊員')
  }

  event.context.logger.info({ gameId: id, ...answer }, 'attendance self-reported')

  return { attendance }
})
