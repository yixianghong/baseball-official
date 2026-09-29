import { defineApiHandler } from '../../../utils/handler'
import { requireUser } from '../../../utils/session'
import { validateBody } from '../../../utils/validate'
import { setWsBracketLock } from '../../../utils/ws-bracket-lock'
import { wsLockInputSchema } from '../../../../shared/schemas/ws-bracket'

/**
 * 設定「預測世界大賽冠軍」的鎖盤時間（限期活動，見 `docs/ws-bracket.md`）。
 *
 * 這是整個活動裡**唯一一支寫入端點** —— 下注與移除都由瀏覽器直接打
 * Realtime Database，只有「還能不能下注」這件事不能讓前台自己決定。
 *
 * `lockAt` 是毫秒時間戳，`null` 代表解除鎖盤。傳一個**過去**的時間就等於
 * 立即鎖盤（後台的「立即鎖盤」按鈕送的就是 `Date.now()`）。
 */
export default defineApiHandler(async (event) => {
  await requireUser(event)

  const { lockAt } = await validateBody(event, wsLockInputSchema)
  await setWsBracketLock(event, lockAt)

  return { lockAt }
})
