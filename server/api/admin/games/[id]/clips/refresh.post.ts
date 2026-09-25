import { defineApiHandler } from '../../../../../utils/handler'
import { requireUser } from '../../../../../utils/session'
import { validateParams } from '../../../../../utils/validate'
import { idParamSchema } from '../../../../../../shared/schemas/common'
import { getGame, setClipPrivacy } from '../../../../../repositories/games'
import { notFound } from '../../../../../repositories/_helpers'
import { fetchClipPrivacy, isYouTubeConfigured } from '../../../../../utils/youtube'

/**
 * 把 YouTube 上的可見度同步回來（需登入）。
 *
 * ## 為什麼需要這一步
 * 透過 API 上傳的影片一律是私人的（未通過 YouTube 合規稽核的專案強制如此），
 * 管理者要到 YouTube Studio 手動改成公開。改完之後我們並不知道 ——
 * 而前台只渲染非私人的片段，所以不同步就等於影片永遠不會出現。
 *
 * 一次問完整場（`videos.list` 的 `id` 可以帶多個），配額只花 1 單位。
 */
export default defineApiHandler(async (event) => {
  await requireUser(event)
  const { id } = await validateParams(event, idParamSchema)

  const game = await getGame(id)
  if (!game) throw notFound('比賽')

  /*
   * 沒片段就直接回傳。
   *
   * 注意這裡看的是**伺服器上**的 `game.clips` —— 後台畫面上那一份可能是
   * 上傳之前載入的、已經過期。所以端點本身不能因為「前端說沒有」就不做事，
   * 那正是第一次上傳後需要按這顆按鈕的情況。
   */
  if (!isYouTubeConfigured(event) || game.clips.length === 0) {
    return { clips: game.clips }
  }

  const privacy = await fetchClipPrivacy(
    event,
    game.clips.map((clip) => clip.videoId),
  )

  const clips = await setClipPrivacy(id, privacy)
  event.context.logger.info(
    { gameId: id, count: Object.keys(privacy).length },
    'clip privacy synced',
  )
  return { clips }
})
