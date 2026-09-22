import { defineApiHandler } from '../../utils/handler'
import { validateQuery } from '../../utils/validate'
import { announcementQuerySchema } from '../../../shared/schemas/announcement'
import { listAnnouncements } from '../../repositories/announcements'

/**
 * 公告列表（公開）。
 *
 * **強制只回傳已發布的公告** —— 即使呼叫端帶了 `?status=draft` 也一樣。
 * 草稿是給管理員預覽用的，要看全部請走 `/api/admin/announcements`（需登入）。
 * 把這個限制寫在端點而不是靠前端不要傳參數，才是真的擋得住。
 */
export default defineApiHandler(async (event) => {
  const query = await validateQuery(event, announcementQuerySchema)
  return await listAnnouncements({ ...query, status: 'published' })
})
