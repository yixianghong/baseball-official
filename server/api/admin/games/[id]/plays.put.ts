import { defineApiHandler } from '../../../../utils/handler'
import { requireUser } from '../../../../utils/session'
import { validateBody, validateParams } from '../../../../utils/validate'
import { idParamSchema } from '../../../../../shared/schemas/common'
import { saveHalfInningPlaysSchema } from '../../../../../shared/schemas/plays-request'
import { saveHalfInningPlays } from '../../../../repositories/games'

/**
 * 寫入一個半局的逐打席紀錄（需登入）。
 *
 * ## 為什麼是 PUT 而且一次一個半局
 * 送進來的陣列**取代**那個半局既有的全部打席（空陣列＝清空），所以這支
 * 是冪等的 —— 球場的行動網路上失敗是常態，而重送一次不會變成兩份紀錄。
 * 粒度與理由完整寫在 `saveHalfInningPlays()`。
 *
 * ## 為什麼不併進 `PATCH /admin/games/[id]`
 * 那一支是後台編輯表單的自動儲存入口，會**整份送出**。逐打席一場最多兩百筆，
 * 併進去等於改一個場地名稱就重送整場紀錄，而且漏帶一次就是整場清空 ——
 * 和 `clips` 不放進 `gameInputSchema` 是完全相同的理由。
 *
 * 回傳更新後的 `plays` 與 `scoreboard`：逐局得分是由打席推導的，
 * 前端拿回來才不必自己再算一次（算兩次就會有兩個答案）。
 */
export default defineApiHandler(async (event) => {
  await requireUser(event)
  const { id } = await validateParams(event, idParamSchema)
  const { inning, half, plays } = await validateBody(event, saveHalfInningPlaysSchema)

  const result = await saveHalfInningPlays(id, inning, half, plays)

  event.context.logger.info({ gameId: id, inning, half, count: plays.length }, 'game plays saved')
  return result
})
