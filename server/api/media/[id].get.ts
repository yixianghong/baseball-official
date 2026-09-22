import { defineEventHandler, getRouterParam, setResponseHeader, setResponseStatus } from 'h3'
import { readMemoryImage } from '../../utils/media-storage'

/**
 * 開發模式暫存圖片的讀取端點。
 *
 * 設定了 Firebase Storage 之後，上傳回傳的是 storage.googleapis.com 的網址，
 * 根本不會走到這裡。這支只服務「還沒開通 Storage 就想看看畫面」的情境。
 *
 * ## 為什麼不用 defineApiHandler
 * 它會把回傳值包成 JSON 信封，但這裡要回的是二進位圖片本身。
 * 這是整個 `server/api/` 底下唯一的例外。
 */
export default defineEventHandler(async (event) => {
  // 網址帶了副檔名（/api/media/abc123.jpg）只是為了讓瀏覽器與下載行為正常，
  // 實際的 key 不含副檔名。
  const raw = getRouterParam(event, 'id') ?? ''
  const id = raw.replace(/\.[a-z0-9]+$/i, '')

  const image = await readMemoryImage(id)
  if (!image) {
    setResponseStatus(event, 404)
    return 'Not Found'
  }

  setResponseHeader(event, 'content-type', image.mimeType)
  setResponseHeader(event, 'cache-control', 'public, max-age=3600')
  return image.buffer
})
