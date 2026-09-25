import { z } from 'zod'
import { defineApiHandler } from '../../../../../utils/handler'
import { requireUser } from '../../../../../utils/session'
import { validateParams } from '../../../../../utils/validate'
import { removeGameClip } from '../../../../../repositories/games'

/**
 * 從比賽上移除一段錄影（需登入）。
 *
 * **只移除本站的紀錄，不刪 YouTube 上的影片。** 誤按這顆按鈕的代價因此是
 * 「前台少一段、回後台重新登錄」，而不是「一段拍到就沒有第二次的影片消失了」。
 * 真要刪影片請到 YouTube Studio。
 */
export default defineApiHandler(async (event) => {
  await requireUser(event)
  const { id, videoId } = await validateParams(
    event,
    z.object({ id: z.string().min(1), videoId: z.string().regex(/^[\w-]{11}$/) }),
  )

  const clips = await removeGameClip(id, videoId)
  event.context.logger.info({ gameId: id, videoId }, 'game clip removed')
  return { clips }
})
