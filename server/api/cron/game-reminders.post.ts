import { defineApiHandler } from '../../utils/handler'
import { requireCronOrUser } from '../../utils/cron'
import { runGameReminders } from '../../utils/reminders'

/**
 * 比賽提醒的排程入口（Cloud Scheduler 每天呼叫一次）。
 *
 * ## 為什麼是外部排程而不是程式裡的計時器
 * `apphosting.yaml` 設了 `minInstances: 0`，沒人瀏覽時容器整個關掉。
 * `setInterval` 只在「剛好有人正在看網站」時活著 —— 而需要發提醒的清晨
 * 正是最沒有人在看的時候。必須有外部的東西來敲門。
 *
 * ## 冪等
 * 排程器會重試（逾時、5xx）。重複呼叫不會重複發送：送出後會在比賽文件上
 * 記 `remindersSent`，下一次執行直接跳過。詳見 `server/utils/reminders.ts`。
 */
export default defineApiHandler(async (event) => {
  const caller = await requireCronOrUser(event)
  const result = await runGameReminders()

  event.context.logger.info({ caller, ...result }, 'game reminders run')
  return result
})
