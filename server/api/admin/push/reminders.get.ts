import { defineApiHandler } from '../../../utils/handler'
import { requireUser } from '../../../utils/session'
import { pendingReminders } from '../../../utils/reminders'
import { reminderPayload } from '../../../../shared/schemas/reminder'
import { taipeiDateKey } from '../../../../shared/schemas/game'

/**
 * 今天會自動送出哪些比賽提醒（需登入）。
 *
 * 走的是和實際發送**同一支** `pendingReminders()`，所以後台看到的預覽
 * 就是等一下真的會送出去的東西。推播送出去收不回來，先看得到才敢放手讓它自動跑。
 */
export default defineApiHandler(async (event) => {
  await requireUser(event)

  const today = taipeiDateKey()
  const due = await pendingReminders(today)

  return {
    today,
    pending: due.map((reminder) => {
      const payload = reminderPayload(reminder)
      return {
        gameId: reminder.game.id,
        kind: reminder.kind,
        date: reminder.game.date,
        days: reminder.days,
        title: payload.title,
        body: payload.body,
      }
    }),
  }
})
