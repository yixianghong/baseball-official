import { defineApiHandler } from '../../utils/handler'
import { requireUser } from '../../utils/session'
import { validateBody } from '../../utils/validate'
import { uploadRequestSchema } from '../../../shared/schemas/ai'
import { uploadImage } from '../../utils/media-storage'

/**
 * 圖片上傳（需登入）。
 *
 * 圖片以 base64 放在 JSON 裡，理由見 `shared/schemas/ai.ts` 的說明。
 * 這條路由的 body 上限由 `40.body-guard.ts` 放寬到 `maxUploadBytes`（8MB），
 * 前端則會先把圖片壓到長邊 1600px 再送。
 */
export default defineApiHandler(async (event) => {
  const user = await requireUser(event)
  const request = await validateBody(event, uploadRequestSchema)
  const result = await uploadImage(request)

  event.context.logger.info(
    { userId: user.id, path: result.path, folder: request.folder },
    'image uploaded',
  )
  return result
})
