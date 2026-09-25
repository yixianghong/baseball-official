import { defineApiHandler } from '../../../../../utils/handler'
import { requireUser } from '../../../../../utils/session'
import { validateBody, validateParams } from '../../../../../utils/validate'
import { gameClipSchema } from '../../../../../../shared/schemas/game'
import { idParamSchema } from '../../../../../../shared/schemas/common'
import { addGameClip } from '../../../../../repositories/games'

/**
 * 登錄一段已經上傳完成的錄影（需登入）。
 *
 * 影片本體已經在 YouTube 上了（瀏覽器直傳），這支只把 `videoId` 記到比賽上。
 * 走 `addGameClip()` 而不是 `updateGame()`：只動 `clips` 一個欄位，
 * 不會把管理者同時在編輯頁改的內容蓋掉 —— 錄影頁和編輯頁很可能同時開著。
 *
 * 同一個半局重錄時會取代舊的那一筆，否則前台會出現兩段一樣的。
 */
export default defineApiHandler(async (event) => {
  await requireUser(event)
  const { id } = await validateParams(event, idParamSchema)

  // createdAt 由伺服器決定，不採信前端送來的時間
  const input = await validateBody(event, gameClipSchema.omit({ createdAt: true }))
  const clips = await addGameClip(id, { ...input, createdAt: new Date().toISOString() })

  event.context.logger.info({ gameId: id, videoId: input.videoId }, 'game clip added')
  return { clips }
})
