import { defineApiHandler } from '../../../utils/handler'
import { requireUser } from '../../../utils/session'
import { validateBody } from '../../../utils/validate'
import { parsePlaysRequestSchema } from '../../../../shared/schemas/ai'
import { parsePlayAudio } from '../../../utils/gemini'

/**
 * 用語音辨識逐打席（需登入）。
 *
 * 和另外四支辨識端點同一套紀律：**這裡不寫入任何資料**。回傳的是「建議」，
 * 一律先回到逐局紀錄頁讓人確認、修改之後，才由使用者按下去寫進那個半局。
 * `confidence` 與 `warnings` 是給人判斷用的依據。
 *
 * 為什麼走 Gemini 而不是瀏覽器內建的語音辨識：iOS 加到主畫面的 PWA 沒有
 * `SpeechRecognition`（理由寫在 `parsePlayAudio()`），而那正是這個球隊的
 * 登錄裝置。
 */
export default defineApiHandler(async (event) => {
  await requireUser(event)
  const request = await validateBody(event, parsePlaysRequestSchema)
  const result = await parsePlayAudio(event, request)

  event.context.logger.info(
    { inning: request.inning, half: request.half, count: result.plays.length },
    'plays parsed from audio',
  )
  return result
})
