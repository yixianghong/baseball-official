import { defineEventHandler, getRouterParam, setResponseHeader, setResponseStatus } from 'h3'
import { contentDisposition, readMemoryFile } from '../../utils/media-storage'
import { attachmentType } from '../../../shared/schemas/attachment'

/**
 * 開發模式暫存檔案的讀取端點（圖片與公告附件共用）。
 *
 * 設定了 Firebase Storage 之後，上傳回傳的是 storage.googleapis.com 的網址，
 * 根本不會走到這裡。這支只服務「還沒開通 Storage 就想看看畫面」的情境。
 *
 * ## 為什麼不用 defineApiHandler
 * 它會把回傳值包成 JSON 信封，但這裡要回的是二進位檔案本身。
 * 這是整個 `server/api/` 底下唯一的例外。
 *
 * ## `nosniff` 不是可有可無的
 * 這條路徑是**和網站同源**的。少了它，瀏覽器會去猜內容型別 —— 一個宣稱是
 * `text/plain` 但內容長得像 HTML 的檔案就可能被當成網頁執行，變成同源的 XSS。
 * 上傳端的型別白名單（`shared/schemas/attachment.ts`）是第一道，這是第二道。
 */
export default defineEventHandler(async (event) => {
  // 網址帶了副檔名（/api/media/abc123.jpg）只是為了讓瀏覽器與下載行為正常，
  // 實際的 key 不含副檔名。
  const raw = getRouterParam(event, 'id') ?? ''
  const id = raw.replace(/\.[a-z0-9]+$/i, '')

  const file = await readMemoryFile(id)
  if (!file) {
    setResponseStatus(event, 404)
    return 'Not Found'
  }

  setResponseHeader(event, 'content-type', file.mimeType)
  setResponseHeader(event, 'x-content-type-options', 'nosniff')
  setResponseHeader(event, 'cache-control', 'public, max-age=3600')
  if (file.filename) {
    setResponseHeader(
      event,
      'content-disposition',
      contentDisposition(file.filename, attachmentType(file.mimeType).ext),
    )
  }
  return file.buffer
})
