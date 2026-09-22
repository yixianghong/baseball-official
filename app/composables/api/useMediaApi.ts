import type { UploadResponse } from '#shared/schemas/ai'
import type { Attachment } from '#shared/schemas/attachment'
import { prepareImage } from '~/utils/image'
import { prepareAttachment } from '~/utils/attachment'

/**
 * 圖片上傳。
 *
 * 壓縮在這一層做（而不是留給每個表單各自處理），所以後台任何地方要加
 * 圖片欄位時，拿到的行為都一致：自動壓到長邊 1600px、自動轉 base64、
 * 自動帶 CSRF。
 */

const ENDPOINTS = {
  upload: '/admin/uploads',
  attachment: '/admin/attachments',
} as const

export type UploadFolder = 'players' | 'announcements' | 'games' | 'site'

export function useUploadActions() {
  const { post, loading, error, attempt } = useApi()

  return {
    loading,
    error,
    attempt,

    /**
     * 上傳一張圖片，回傳可直接放進 `img src` 的網址。
     *
     * @example
     * ```ts
     * const { url } = await uploadImage(file, 'players')
     * form.photoUrl = url
     * ```
     */
    async uploadImage(file: File, folder: UploadFolder): Promise<UploadResponse> {
      const image = await prepareImage(file)
      return await post<UploadResponse>(ENDPOINTS.upload, {
        imageBase64: image.base64,
        mimeType: image.mimeType,
        folder,
        filename: file.name,
      })
    },

    /**
     * 上傳一個公告附件，回傳可以直接存進公告的整筆資料。
     *
     * 與 `uploadImage` 分開：附件不壓縮、型別白名單不同，
     * 回傳的也不只是網址（前台要顯示檔名與大小）。
     */
    async uploadAttachment(file: File): Promise<Attachment> {
      const prepared = await prepareAttachment(file)
      return await post<Attachment>(ENDPOINTS.attachment, {
        fileBase64: prepared.base64,
        mimeType: prepared.mimeType,
        filename: file.name,
      })
    },
  }
}
