import { defineApiHandler } from '../../utils/handler'
import { validateParams } from '../../utils/validate'
import { AppError, ERROR_CODE } from '../../utils/errors'
import { idParamSchema } from '../../../shared/schemas/common'
import { getAnnouncement } from '../../repositories/announcements'
import { getSessionUser } from '../../utils/session'

/**
 * 單則公告（公開）。
 *
 * 草稿只有登入後看得到，讓管理員能用同一個網址預覽尚未發布的內容；
 * 未登入的訪客拿到的是 404 而不是 403 —— 不確認「這則公告存在但你不能看」，
 * 避免洩漏尚未公開的資訊。
 */
export default defineApiHandler(async (event) => {
  const { id } = await validateParams(event, idParamSchema)
  const announcement = await getAnnouncement(id)
  if (!announcement) throw new AppError(ERROR_CODE.NOT_FOUND, '找不到這則公告')

  if (announcement.status === 'draft') {
    const user = await getSessionUser(event)
    if (!user) throw new AppError(ERROR_CODE.NOT_FOUND, '找不到這則公告')
  }

  return announcement
})
