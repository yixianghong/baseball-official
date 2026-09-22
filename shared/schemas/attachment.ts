import { z } from 'zod'

/**
 * 公告附件的共用契約。
 *
 * ## 為什麼是白名單，而且刻意很短
 * 上傳的檔案**會被公開提供**（Storage 的公開網址，或開發模式下我們自己的
 * `/api/media/…`）。只要放行的型別裡有瀏覽器會「執行」的東西，這個功能就變成
 * 一條把任意內容掛在自家網域底下的路：
 *
 * - `text/html` —— 直接就是同源的頁面
 * - `image/svg+xml` —— SVG 可以內嵌 `<script>`，點開就執行
 *
 * 所以放行清單只列球隊真的會發的東西（圖片、PDF、Word／Excel、純文字）。
 * 壓縮檔也不收：`.zip` 裡面可以是任何東西，而收它只是為了省事。
 *
 * ## 型別對照表放在 shared
 * 伺服器要用它決定副檔名，前台要用它決定圖示與說明文字。
 * 兩邊各寫一份遲早會漏掉其中一邊。
 */

export interface AttachmentType {
  /** 存到 Storage 時用的副檔名。沒有它，下載下來會是一個無名檔。 */
  ext: string
  /** 顯示用的短名稱。 */
  label: string
  /** 非圖片檔在列表上的圖示。 */
  icon: string
}

export const ATTACHMENT_TYPES = {
  'image/jpeg': { ext: 'jpg', label: '圖片', icon: '🖼️' },
  'image/png': { ext: 'png', label: '圖片', icon: '🖼️' },
  'image/webp': { ext: 'webp', label: '圖片', icon: '🖼️' },
  'image/gif': { ext: 'gif', label: '圖片', icon: '🖼️' },
  'image/heic': { ext: 'heic', label: '圖片', icon: '🖼️' },
  'application/pdf': { ext: 'pdf', label: 'PDF', icon: '📄' },
  'application/msword': { ext: 'doc', label: 'Word', icon: '📝' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    ext: 'docx',
    label: 'Word',
    icon: '📝',
  },
  'application/vnd.ms-excel': { ext: 'xls', label: 'Excel', icon: '📊' },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
    ext: 'xlsx',
    label: 'Excel',
    icon: '📊',
  },
  'text/plain': { ext: 'txt', label: '文字檔', icon: '📃' },
  'text/csv': { ext: 'csv', label: 'CSV', icon: '📊' },
} as const satisfies Record<string, AttachmentType>

export type AttachmentMime = keyof typeof ATTACHMENT_TYPES

export const attachmentMimeSchema = z.enum(
  Object.keys(ATTACHMENT_TYPES) as [AttachmentMime, ...AttachmentMime[]],
)

/** 給 `<input accept>` 用的字串。 */
export const ATTACHMENT_ACCEPT = Object.keys(ATTACHMENT_TYPES).join(',')

/** 一則公告最多幾個附件。 */
export const MAX_ATTACHMENTS = 10

/**
 * 單一檔案的大小上限（6MB）。
 *
 * 和 `maxUploadBytes`（8MB）是同一件事的兩端：檔案以 base64 放進 JSON 會膨脹
 * 約 33%，6MB 的檔案送出去剛好接近 8MB。前端先擋是為了給一句看得懂的話，
 * 而不是讓使用者等上傳完才收到 413。
 */
export const MAX_ATTACHMENT_BYTES = 6 * 1024 * 1024

/**
 * 已經上傳完成、存進公告裡的附件。
 *
 * 存的是「上傳當下的快照」而不是只存路徑：檔名與大小要顯示在前台，
 * 每次列公告都回去問 Storage 是完全不必要的往返。
 */
export const attachmentSchema = z.object({
  /**
   * 檔案網址。
   *
   * 只收 https 與站內相對路徑 —— 這個值最後會變成 `<a href>`，
   * 放行 `javascript:` 等於在公告上開了一個執行任意程式的入口。
   * 值目前都由我們自己的上傳端點產生，但 schema 是**最後一道防線**，
   * 不能假設呼叫端一定乖。
   *
   * ⚠️ `//evil.test/a.pdf` 也是以 `/` 開頭的，但它是**協定相對網址**，
   * 瀏覽器會解析成外部站台。和推播通知的 `url` 踩過的是同一個坑
   * （見 `shared/schemas/push.ts`），所以要多擋一次 `//`。
   */
  url: z
    .string()
    .trim()
    .min(1, '缺少檔案網址')
    .max(2000)
    .refine(
      (value) => (value.startsWith('/') && !value.startsWith('//')) || value.startsWith('https://'),
      '不支援的檔案網址',
    ),
  /** 原始檔名，顯示給人看，也是另存新檔時的預設名稱。 */
  name: z.string().trim().min(1, '缺少檔案名稱').max(120),
  contentType: attachmentMimeSchema,
  /** 位元組數，用來顯示「2.3 MB」。 */
  size: z.number().int().min(0).default(0),
})

export type Attachment = z.infer<typeof attachmentSchema>

/** 上傳一個附件的請求。圖片走 base64 JSON 的理由見 `ai.ts`。 */
export const attachmentUploadSchema = z.object({
  /** 不含 `data:` 前綴的純 base64 字串。 */
  fileBase64: z.string().min(16, '缺少檔案內容'),
  mimeType: attachmentMimeSchema,
  filename: z.string().trim().min(1, '缺少檔案名稱').max(120),
})

export type AttachmentUpload = z.infer<typeof attachmentUploadSchema>

/** 圖片可以直接在瀏覽器裡開起來看，列表上因此改用縮圖而不是圖示。 */
export function isImageAttachment(contentType: string): boolean {
  return contentType.startsWith('image/')
}

export function attachmentType(contentType: string): AttachmentType {
  return (
    ATTACHMENT_TYPES[contentType as AttachmentMime] ?? { ext: 'bin', label: '檔案', icon: '📎' }
  )
}
