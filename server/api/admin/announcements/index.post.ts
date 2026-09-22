import { defineApiHandler } from '../../../utils/handler'
import { requireUser } from '../../../utils/session'
import { validateBody } from '../../../utils/validate'
import { announcementInputSchema } from '../../../../shared/schemas/announcement'
import { createAnnouncement } from '../../../repositories/announcements'

/** 新增公告（需登入）。 */
export default defineApiHandler(async (event) => {
  await requireUser(event)
  const input = await validateBody(event, announcementInputSchema)
  const announcement = await createAnnouncement(input)

  event.context.logger.info({ announcementId: announcement.id }, 'announcement created')
  return announcement
})
