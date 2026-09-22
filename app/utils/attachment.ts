import {
  ATTACHMENT_TYPES,
  MAX_ATTACHMENT_BYTES,
  type AttachmentMime,
} from '#shared/schemas/attachment'
import { formatBytes, readFileAsBase64 } from './image'

/**
 * 上傳前的附件檢查。
 *
 * ## 為什麼不壓縮
 * 圖片欄位會壓（見 `image.ts`），附件刻意不壓：使用者附上一份報名表 PDF 或
 * 一張原始解析度的照片，**就是要那一份**。把它重新編碼成 JPEG 等於偷偷換掉
 * 使用者選的檔案。代價是超過上限時只能請他自己處理，所以錯誤訊息要講清楚。
 *
 * ## 在瀏覽器先擋一次
 * 伺服器當然也會擋（schema + body guard），但等整個檔案送完才收到 413，
 * 在行動網路上是幾十秒的白等。
 */

/** 送往 BFF 的附件。`base64` 不含 `data:` 前綴。 */
export interface PreparedAttachment {
  base64: string
  mimeType: AttachmentMime
  bytes: number
}

export async function prepareAttachment(file: File): Promise<PreparedAttachment> {
  // 有些系統給 .csv 的型別是空字串或 application/octet-stream，
  // 與其猜，不如直接說哪些格式可以。
  if (!(file.type in ATTACHMENT_TYPES)) {
    throw new Error(
      `不支援的檔案格式${file.type ? `（${file.type}）` : ''}，請改用圖片、PDF 或 Office 檔`,
    )
  }

  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(
      `檔案大小 ${formatBytes(file.size)} 超過上限 ${formatBytes(MAX_ATTACHMENT_BYTES)}，請先壓縮`,
    )
  }

  return {
    base64: await readFileAsBase64(file),
    mimeType: file.type as AttachmentMime,
    bytes: file.size,
  }
}
