import { taipeiDateKey } from '../../shared/schemas/game'
import {
  dueReminders,
  reminderPayload,
  type DueReminder,
  type ReminderRunResult,
} from '../../shared/schemas/reminder'
import { listGames, markReminderSent } from '../repositories/games'
import { countSubscriptions } from '../repositories/push-subscriptions'
import { isPushConfigured, sendPushToAll } from './push'
import { logger } from './logger'
import { AppError, ERROR_CODE } from './errors'

/**
 * 執行一次比賽提醒。
 *
 * ## 記號在送出**之後**才寫
 * 反過來做（先記號再發送）會在發送失敗時把提醒永久吞掉 —— 而「大家都沒收到
 * 通知」是不會有人來回報的那種問題。現在這個順序最壞的情況是重複送一次，
 * 那至少看得出來。
 *
 * 一場失敗不影響其他場：每一場各自 try，錯誤記下來繼續跑。
 */
export async function runGameReminders(): Promise<ReminderRunResult> {
  if (!isPushConfigured()) {
    throw new AppError(ERROR_CODE.SERVICE_UNAVAILABLE, '尚未設定推播金鑰（VAPID）')
  }

  const today = taipeiDateKey()
  const due = await pendingReminders(today)
  const subscribers = await countSubscriptions()

  const sent: ReminderRunResult['sent'] = []

  for (const reminder of due) {
    const payload = reminderPayload(reminder)
    try {
      const result = await sendPushToAll(payload)
      await markReminderSent(reminder.game.id, reminder.kind)
      sent.push({
        gameId: reminder.game.id,
        kind: reminder.kind,
        title: payload.title,
        subscribers: result.sent,
      })
    } catch (error) {
      // 沒有寫記號，所以明天會再試一次
      logger.error(
        { gameId: reminder.game.id, kind: reminder.kind, error: String(error) },
        '比賽提醒發送失敗，明天會重試',
      )
    }
  }

  logger.info({ today, due: due.length, sent: sent.length, subscribers }, '比賽提醒執行完成')
  return { today, sent, noSubscribers: subscribers === 0 }
}

/**
 * 今天待送的提醒。後台的預覽也用它 —— 「等一下會送什麼」和「實際送什麼」
 * 必須是同一段程式算出來的。
 */
export async function pendingReminders(today = taipeiDateKey()): Promise<DueReminder[]> {
  // 提醒只看未來一週內，取回的量很小
  const games = await listGames({ scope: 'upcoming', limit: 50 })
  return dueReminders(games, today)
}
