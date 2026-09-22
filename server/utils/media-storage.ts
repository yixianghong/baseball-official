import { AppError, ERROR_CODE } from './errors'
import { getBucket, isFirebaseConfigured } from './firebase'
import { logger } from './logger'
import type { UploadRequest, UploadResponse } from '../../shared/schemas/ai'
import { attachmentType } from '../../shared/schemas/attachment'

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

/** 上傳一個檔案所需要知道的一切。圖片與公告附件共用同一條路。 */
export interface FileUpload {
  base64: string
  mimeType: string
  /** 原始檔名。只用來取得可讀的下載名稱，不參與路徑組成。 */
  filename: string
  folder: string
}

export function uploadImage(request: UploadRequest): Promise<UploadResponse> {
  return uploadFile({
    base64: request.imageBase64,
    mimeType: request.mimeType,
    filename: request.filename,
    folder: request.folder,
  })
}

export async function uploadFile(request: FileUpload): Promise<UploadResponse> {
  const buffer = Buffer.from(request.base64, 'base64')
  if (buffer.length === 0) {
    throw new AppError(ERROR_CODE.BAD_REQUEST, '檔案內容為空')
  }

  // 副檔名一律由 MIME 決定，不採信使用者傳來的檔名 —— 檔名裡的
  // `../`、`.html` 都不該有機會影響存到 Storage 上的物件路徑。
  const extension = attachmentType(request.mimeType).ext
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
      // `inline` 讓瀏覽器能開的就直接開（圖片、PDF），開不了的自動變成下載；
      // filename 則讓「另存新檔」拿到原本的檔名，而不是一串亂碼 ID。
      contentDisposition: contentDisposition(request.filename, extension),
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
  request: FileUpload,
  buffer: Buffer,
): Promise<UploadResponse> {
  const storage = useStorage('cache')
  await storage.setItem(`media:${id}`, {
    mimeType: request.mimeType,
    base64: buffer.toString('base64'),
    filename: request.filename,
  })

  logger.warn({ objectPath }, '未設定 Firebase Storage，檔案暫存於記憶體（重啟即失）')

  return { url: `/api/media/${id}.${extension}`, path: objectPath }
}

/** 讀取開發模式暫存的檔案。 */
export async function readMemoryFile(
  id: string,
): Promise<{ mimeType: string; buffer: Buffer; filename: string } | null> {
  const storage = useStorage('cache')
  const item = await storage.getItem<{ mimeType: string; base64: string; filename?: string }>(
    `media:${id}`,
  )
  if (!item) return null
  return {
    mimeType: item.mimeType,
    buffer: Buffer.from(item.base64, 'base64'),
    filename: item.filename ?? '',
  }
}

/**
 * 組出 `Content-Disposition`。
 *
 * 中文檔名不能直接塞進 `filename="…"` —— 這個標頭是 latin-1，非 ASCII 字元
 * 會被丟掉或變成亂碼。RFC 5987 的 `filename*=UTF-8''…` 才是正解，同時保留
 * 一個純 ASCII 的 `filename` 給看不懂 `filename*` 的舊用戶端。
 *
 * 抽成獨立的純函式是為了能測：這段邏輯錯了，症狀是「下載下來的檔案叫
 * `___.pdf`」，而那要真的上傳一個中文檔名的檔案才會發現。
 */
export function contentDisposition(filename: string, extension: string): string {
  const safe = filename.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '')
  const fallback = safe && safe !== `.${extension}` ? safe : `file.${extension}`
  return `inline; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}
