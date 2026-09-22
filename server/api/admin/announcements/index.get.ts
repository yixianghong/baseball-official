import { defineApiHandler } from '../../../utils/handler'
import { requireUser } from '../../../utils/session'
import { validateQuery } from '../../../utils/validate'
import { announcementQuerySchema } from '../../../../shared/schemas/announcement'
import { listAnnouncements } from '../../../repositories/announcements'

/**
 * 公告列表（需登入，含草稿）。
 *
 * 與公開的 `/api/announcements` 的唯一差別就是「看得到草稿」。
 * 分成兩支端點而不是用一個參數控制，是因為權限差異應該由路由本身表達 ——
 * 掃一眼 `server/api/admin/` 就知道哪些東西需要登入。
 */
export default defineApiHandler(async (event) => {
  await requireUser(event)
  const query = await validateQuery(event, announcementQuerySchema)
  return await listAnnouncements(query)
})
