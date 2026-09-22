import { AppError, ERROR_CODE } from './errors'
import { getBucket, isFirebaseConfigured } from './firebase'
import { logger } from './logger'
import type { UploadRequest, UploadResponse } from '../../shared/schemas/ai'

/**
 * 圖片上傳 —— 球員照片、公告封面、比賽照片。
 *
 * ## 命名刻意避開 `storage.ts`
 * 樣板已經有一支 `server/utils/storage.ts`，那是 Nitro 的 KV（rate limit 與
 * 快取用的）。兩者混在一起會讓人找錯檔案，所以這支叫 `media-storage`。
 *
 * ## 兩種模式
 * - **有 Firebase Storage**：上傳到 bucket，設為公開讀取，回傳永久網址
 * - **沒有**（開發／測試）：存進 Nitro 的 memory KV，回傳 `/api/media/{id}`
 *   由 `server/api/media/[id].get.ts` 提供
 *
 * 兩種模式回傳的都是「一個可以直接放進 img src 的網址」，前端與資料庫
 * 因此完全不需要知道圖片實際存在哪裡。開發模式的圖片重啟即失 —— 這是
 * 刻意的取捨，換來不必為了看畫面就得先開通 Firebase Storage。
 */

/** 副檔名對照。Storage 上的檔名帶正確副檔名，瀏覽器才不會下載成無名檔。 */
const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
}

export async function uploadImage(request: UploadRequest): Promise<UploadResponse> {
  const buffer = Buffer.from(request.imageBase64, 'base64')
  if (buffer.length === 0) {
    throw new AppError(ERROR_CODE.BAD_REQUEST, '圖片內容為空')
  }

  const extension = EXTENSIONS[request.mimeType] ?? 'bin'
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  const objectPath = `${request.folder}/${id}.${extension}`

  if (!isFirebaseConfigured()) {
    return saveToMemory(objectPath, id, extension, request, buffer)
  }

  const bucket = await getBucket()
  if (!bucket) {
    // 同 gemini.ts：這是給管理者的操作指引，必須實際顯示出來
    throw new AppError(
      ERROR_CODE.SERVICE_UNAVAILABLE,
      '尚未設定 Firebase Storage，請改用外部圖片網址。',
      { expose: true },
    )
  }

  const file = bucket.file(objectPath)
  await file.save(buffer, {
    contentType: request.mimeType,
    metadata: {
      cacheControl: 'public, max-age=31536000, immutable',
      metadata: { originalName: request.filename },
    },
  })

  // 官網圖片本來就是要公開的，設成公開讀取才能直接放進 img src。
  // 若你的 bucket 啟用了 uniform bucket-level access，makePublic 會失敗 ——
  // 那種情況請在 Console 把 bucket 設為公開讀取，或改用簽章網址。
  try {
    await file.makePublic()
  } catch (err) {
    logger.warn({ err, objectPath }, 'failed to make uploaded file public')
  }

  return {
    url: `https://storage.googleapis.com/${bucket.name}/${encodeURI(objectPath)}`,
    path: objectPath,
  }
}

/** 開發／測試模式：存進 Nitro memory KV。 */
async function saveToMemory(
  objectPath: string,
  id: string,
  extension: string,
  request: UploadRequest,
  buffer: Buffer,
): Promise<UploadResponse> {
  const storage = useStorage('cache')
  await storage.setItem(`media:${id}`, {
    mimeType: request.mimeType,
    base64: buffer.toString('base64'),
    filename: request.filename,
  })

  logger.warn({ objectPath }, '未設定 Firebase Storage，圖片暫存於記憶體（重啟即失）')

  return { url: `/api/media/${id}.${extension}`, path: objectPath }
}

/** 讀取開發模式暫存的圖片。 */
export async function readMemoryImage(
  id: string,
): Promise<{ mimeType: string; buffer: Buffer } | null> {
  const storage = useStorage('cache')
  const item = await storage.getItem<{ mimeType: string; base64: string }>(`media:${id}`)
  if (!item) return null
  return { mimeType: item.mimeType, buffer: Buffer.from(item.base64, 'base64') }
}
