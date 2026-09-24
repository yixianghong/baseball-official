import { z } from 'zod'
import { patchSchemaOf } from './common'
import { attachmentSchema, MAX_ATTACHMENTS } from './attachment'

/**
 * 公告的共用契約。
 *
 * 公告牆只負責呈現內容，沒有留言或按讚 —— 所以這裡不需要任何互動相關欄位。
 */

export const announcementCategorySchema = z.enum([
  'general',
  'game',
  'training',
  'event',
  'recruit',
])

export type AnnouncementCategory = z.infer<typeof announcementCategorySchema>

export const CATEGORY_LABELS: Record<AnnouncementCategory, string> = {
  general: '一般公告',
  game: '賽事',
  training: '練習',
  event: '活動',
  recruit: '徵召',
}

/** 分類對應的色調 token，供卡片標籤使用。 */
export const CATEGORY_TONES: Record<AnnouncementCategory, string> = {
  general: 'slate',
  game: 'brand',
  training: 'success',
  event: 'accent',
  recruit: 'warning',
}

export const announcementStatusSchema = z.enum(['draft', 'published'])
export type AnnouncementStatus = z.infer<typeof announcementStatusSchema>

export const announcementInputSchema = z.object({
  title: z.string().trim().min(1, '請輸入標題').max(80, '標題最多 80 字'),
  /**
   * Markdown 內容，換行以 \n 保存。
   *
   * 存的一律是原始碼，不是 HTML —— 渲染在前台做（`app/utils/markdown.ts`）。
   * 存 HTML 的話，日後想換渲染方式、想抽純文字做摘要都得回頭清一次資料，
   * 而且資料庫裡就躺著一堆可執行的標記。
   *
   * 上限用「字元數」而不是渲染後的長度：作者在編輯器裡看到的就是這個數字。
   */
  content: z.string().trim().min(1, '請輸入公告內容').max(5000, '內容最多 5000 字'),
  category: announcementCategorySchema.default('general'),
  /** 置頂的公告永遠排在最前面。 */
  pinned: z.boolean().default(false),
  status: announcementStatusSchema.default('published'),
  /** 發布時間（ISO 8601）。留空時由後端填入當下時間。 */
  publishedAt: z.string().default(''),
  coverImageUrl: z.string().trim().default(''),
  /**
   * 附件（報名表、賽程 PDF、活動照片…）。
   *
   * 與 `coverImageUrl` 分開：封面是版面的一部分，附件是**內容**。
   * 把封面也塞進這個陣列會讓「第一張圖到底是不是封面」變成一條隱性規則。
   */
  attachments: z.array(attachmentSchema).max(MAX_ATTACHMENTS).default([]),
})

export type AnnouncementInput = z.input<typeof announcementInputSchema>
/** 表單狀態用（所有欄位都已套用預設值）。理由見 `settings.ts` 的 `SiteSettingsForm`。 */
export type AnnouncementForm = z.output<typeof announcementInputSchema>

export const announcementPatchSchema = patchSchemaOf(announcementInputSchema)
export type AnnouncementPatch = z.input<typeof announcementPatchSchema>

export const announcementSchema = announcementInputSchema.extend({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type Announcement = z.infer<typeof announcementSchema>

/** 一次最多取回幾則公告。理由同 `MAX_GAME_QUERY_LIMIT`。 */
export const MAX_ANNOUNCEMENT_QUERY_LIMIT = 300

export const announcementQuerySchema = z.object({
  status: announcementStatusSchema.optional(),
  category: announcementCategorySchema.optional(),
  limit: z.coerce.number().int().min(1).max(MAX_ANNOUNCEMENT_QUERY_LIMIT).default(50),
})

export type AnnouncementQuery = z.input<typeof announcementQuerySchema>
/** repository 用（已套用 default 與 coerce）。 */
export type AnnouncementQueryOptions = Partial<z.output<typeof announcementQuerySchema>>

/** 公告排序：置頂優先，其次依發布時間新到舊。 */
export function compareAnnouncements(a: Announcement, b: Announcement): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
  return (b.publishedAt || b.createdAt).localeCompare(a.publishedAt || a.createdAt)
}
