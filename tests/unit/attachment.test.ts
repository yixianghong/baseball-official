import { describe, expect, it } from 'vitest'
import {
  ATTACHMENT_TYPES,
  attachmentSchema,
  attachmentType,
  attachmentUploadSchema,
  isImageAttachment,
  MAX_ATTACHMENTS,
} from '../../shared/schemas/attachment'
import { announcementInputSchema } from '../../shared/schemas/announcement'
import { contentDisposition } from '../../server/utils/media-storage'

/**
 * 公告附件。
 *
 * 上傳的檔案會被公開提供，所以這裡最要緊的是**放行清單有沒有破口**：
 * 型別白名單擋的是「瀏覽器會執行的東西」，網址白名單擋的是
 * 「點下去會執行程式的連結」。這兩道漏了都不會有任何畫面上的徵兆。
 */

const valid = {
  url: 'https://storage.googleapis.com/bucket/announcements/123.pdf',
  name: '報名表.pdf',
  contentType: 'application/pdf',
  size: 12345,
}

describe('attachmentSchema', () => {
  it('接受上傳端回傳的資料', () => {
    expect(attachmentSchema.parse(valid)).toMatchObject(valid)
  })

  it('站內相對路徑也可以（開發模式的 /api/media/…）', () => {
    expect(attachmentSchema.parse({ ...valid, url: '/api/media/abc.pdf' }).url).toBe(
      '/api/media/abc.pdf',
    )
  })

  it.each([
    'javascript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD4=',
    'http://example.com/a.pdf',
    '//evil.test/a.pdf',
  ])('擋掉 %s 這種網址', (url) => {
    expect(attachmentSchema.safeParse({ ...valid, url }).success).toBe(false)
  })

  it('size 沒給時預設為 0，不會變成 undefined', () => {
    const { size, ...withoutSize } = valid
    expect(size).toBe(12345)
    expect(attachmentSchema.parse(withoutSize).size).toBe(0)
  })
})

describe('型別白名單', () => {
  it.each(['image/svg+xml', 'text/html', 'application/zip', 'application/x-msdownload'])(
    '不收 %s',
    (mimeType) => {
      expect(
        attachmentUploadSchema.safeParse({ fileBase64: 'x'.repeat(20), mimeType, filename: 'a' })
          .success,
      ).toBe(false)
    },
  )

  it('SVG 不在清單裡 —— 它可以內嵌 script，點開就執行', () => {
    expect(Object.keys(ATTACHMENT_TYPES)).not.toContain('image/svg+xml')
  })

  it('每個型別都有副檔名，否則下載下來會是無名檔', () => {
    for (const [mime, type] of Object.entries(ATTACHMENT_TYPES)) {
      expect(type.ext, mime).toMatch(/^[a-z0-9]+$/)
    }
  })

  it('未知型別退回泛用的「檔案」而不是炸掉', () => {
    expect(attachmentType('application/unknown')).toEqual({ ext: 'bin', label: '檔案', icon: '📎' })
  })

  it('分得出圖片與其他檔案', () => {
    expect(isImageAttachment('image/png')).toBe(true)
    expect(isImageAttachment('application/pdf')).toBe(false)
  })
})

describe('公告的附件欄位', () => {
  it('沒有附件的舊公告解析後是空陣列，不是 undefined', () => {
    // Firestore 裡既有的文件沒有這個欄位，少了 default 前台就會在
    // `announcement.attachments.length` 這一行炸掉
    const parsed = announcementInputSchema.parse({ title: '標題', content: '內容' })
    expect(parsed.attachments).toEqual([])
  })

  it('超過上限就拒絕', () => {
    const many = Array.from({ length: MAX_ATTACHMENTS + 1 }, (_, i) => ({
      ...valid,
      url: `${valid.url}?${i}`,
    }))
    expect(
      announcementInputSchema.safeParse({ title: '標題', content: '內容', attachments: many })
        .success,
    ).toBe(false)
  })
})

describe('contentDisposition', () => {
  it('中文檔名走 RFC 5987，另外留一個 ASCII 的退路', () => {
    const header = contentDisposition('本週練習.pdf', 'pdf')
    expect(header).toContain("filename*=UTF-8''")
    expect(header).toContain(encodeURIComponent('本週練習.pdf'))
    // 退路必須是純 ASCII，否則這個標頭本身就是壞的
    // eslint-disable-next-line no-control-regex
    expect(header.slice(0, header.indexOf('filename*'))).toMatch(/^[\x00-\x7F]*$/)
  })

  it('檔名整個是非 ASCII 時退路仍然有名字', () => {
    // 清掉之後只剩副檔名，那等於 `filename=""`，有些瀏覽器會存成無名檔。
    // 退回一個通用但完整的名字，真正的檔名由 filename* 帶。
    const header = contentDisposition('報名表.pdf', 'pdf')
    expect(header).toContain('filename="file.pdf"')
    expect(header).toContain(encodeURIComponent('報名表.pdf'))
  })

  it('用 inline 讓瀏覽器能開的就開，開不了的自動下載', () => {
    expect(contentDisposition('a.pdf', 'pdf').startsWith('inline;')).toBe(true)
  })
})
