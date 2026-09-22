import { defineApiHandler } from '../../../utils/handler'
import { requireUser } from '../../../utils/session'
import { validateBody, validateParams } from '../../../utils/validate'
import { announcementPatchSchema } from '../../../../shared/schemas/announcement'
import { idParamSchema } from '../../../../shared/schemas/common'
import { updateAnnouncement } from '../../../repositories/announcements'

/** 更新公告（需登入）。 */
export default defineApiHandler(async (event) => {
  await requireUser(event)
  const { id } = await validateParams(event, idParamSchema)
  const patch = await validateBody(event, announcementPatchSchema)
  const announcement = await updateAnnouncement(id, patch)

  event.context.logger.info({ announcementId: id }, 'announcement updated')
  return announcement
})
