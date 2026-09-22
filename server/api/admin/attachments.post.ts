import { defineApiHandler } from '../../utils/handler'
import { requireUser } from '../../utils/session'
import { validateBody } from '../../utils/validate'
import { attachmentUploadSchema, type Attachment } from '../../../shared/schemas/attachment'
import { uploadFile } from '../../utils/media-storage'

/**
 * 公告附件上傳（需登入）。
 *
 * 和 `/api/admin/uploads` 分開的理由是**型別白名單不一樣**：圖片欄位只收得了
 * 圖片，附件還要收 PDF 與 Office 檔。合成一支端點就得用一個放到最寬的白名單，
 * 那等於讓「球員照片」欄位也能塞 PDF。
 *
 * 回傳的是可以直接存進公告的整筆附件資料（含檔名與大小），
 * 前端不必自己再拼一次 —— 拼錯了要等到前台才看得出來。
 */
export default defineApiHandler(async (event) => {
  const user = await requireUser(event)
  const request = await validateBody(event, attachmentUploadSchema)

  const result = await uploadFile({
    base64: request.fileBase64,
    mimeType: request.mimeType,
    filename: request.filename,
    folder: 'announcements',
  })

  const attachment: Attachment = {
    url: result.url,
    name: request.filename,
    contentType: request.mimeType,
    // base64 每 4 個字元代表 3 個位元組，末尾的 `=` 是補白不算內容
    size: Math.floor((request.fileBase64.replace(/=+$/, '').length * 3) / 4),
  }

  event.context.logger.info(
    { userId: user.id, path: result.path, contentType: attachment.contentType },
    'attachment uploaded',
  )

  return attachment
})
