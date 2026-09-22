import { defineApiHandler } from '../../../utils/handler'
import { requireUser } from '../../../utils/session'
import { validateParams } from '../../../utils/validate'
import { idParamSchema } from '../../../../shared/schemas/common'
import { deleteAnnouncement } from '../../../repositories/announcements'

/** 刪除公告（需登入）。 */
export default defineApiHandler(async (event) => {
  await requireUser(event)
  const { id } = await validateParams(event, idParamSchema)
  await deleteAnnouncement(id)

  event.context.logger.info({ announcementId: id }, 'announcement deleted')
  return { deleted: true }
})
