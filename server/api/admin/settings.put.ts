import { defineApiHandler } from '../../utils/handler'
import { requireUser } from '../../utils/session'
import { validateBody } from '../../utils/validate'
import { siteSettingsInputSchema } from '../../../shared/schemas/settings'
import { updateSiteSettings } from '../../repositories/settings'

/**
 * 更新網站設定（需登入）。
 *
 * 用 PUT 而非 PATCH：設定只有一份，後台是整頁表單一起送出，
 * 整份取代的語義比部分更新更貼近實際操作。
 */
export default defineApiHandler(async (event) => {
  await requireUser(event)
  const input = await validateBody(event, siteSettingsInputSchema)
  const settings = await updateSiteSettings(input)

  event.context.logger.info('site settings updated')
  return settings
})
