import { z } from 'zod'
import { defineApiHandler } from '../../../../utils/handler'
import { requireUser } from '../../../../utils/session'
import { validateBody } from '../../../../utils/validate'
import { gameHalfSchema } from '../../../../../shared/schemas/half-inning'
import { saveHalfInningNarrative } from '../../../../repositories/games'

/**
 * 存下一個半局的賽況敘述（人按「產生敘述」確認之後才寫）。
 *
 * ## 為什麼是獨立端點
 * `narratives` 和 `clips`、`plays` 一樣**刻意不在 `gameInputSchema`** 裡 ——
 * 後台的編輯表單是自動儲存、整份送出的，放進去之後漏帶一次就是整場的敘述清空。
 *
 * **以「第幾局的哪半局」為鍵整格覆蓋**，所以重新產生就是蓋掉同一格，
 * 重送也安全（冪等）。空字串＝把那一格刪掉。
 *
 * ⚠️ AI 是在**另一支端點**（`/admin/ai/describe-half-inning`）產生文字的，
 * 那一支什麼都不寫。這一支只收字串、不碰 Gemini —— 所以手動改寫過的敘述
 * 也存得進來，而「產生」與「保存」是兩個可以各自失敗的動作。
 */
const bodySchema = z.object({
  inning: z.number().int().min(1).max(20),
  half: gameHalfSchema,
  text: z.string().trim().max(400),
})

export default defineApiHandler(async (event) => {
  await requireUser(event)

  const id = String(event.context.params?.id ?? '')
  const body = await validateBody(event, bodySchema)
  const narratives = await saveHalfInningNarrative(id, body.inning, body.half, body.text)

  return { narratives }
})
