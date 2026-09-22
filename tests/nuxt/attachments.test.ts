// @vitest-environment nuxt
import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import type { Attachment } from '../../shared/schemas/attachment'
import AttachmentList from '../../app/components/news/AttachmentList.vue'
import AttachmentField from '../../app/components/admin/AttachmentField.vue'

/**
 * 附件的呈現。
 *
 * 連結的屬性是這裡最值得守住的東西：少了 `rel="noopener"`，被開啟的頁面
 * 可以透過 `window.opener` 改掉我們這一頁的網址 —— 而畫面上完全看不出來。
 */

const pdf: Attachment = {
  url: 'https://storage.googleapis.com/bucket/announcements/1.pdf',
  name: '春季聯賽報名表.pdf',
  contentType: 'application/pdf',
  size: 245_760,
}

const photo: Attachment = {
  url: '/api/media/abc.jpg',
  name: '球隊合照.jpg',
  contentType: 'image/jpeg',
  size: 1_048_576,
}

describe('NewsAttachmentList', () => {
  it('每個附件都是連結，另開分頁且帶 rel', async () => {
    const component = await mountSuspended(AttachmentList, {
      props: { attachments: [pdf, photo] },
    })

    const links = component.findAll('a')
    expect(links).toHaveLength(2)
    expect(links[0]!.attributes('href')).toBe(pdf.url)
    expect(links[0]!.attributes('target')).toBe('_blank')
    expect(links[0]!.attributes('rel')).toBe('noopener noreferrer')
  })

  it('顯示檔名、類型與大小', async () => {
    const component = await mountSuspended(AttachmentList, { props: { attachments: [pdf] } })

    const text = component.text()
    expect(text).toContain('春季聯賽報名表.pdf')
    expect(text).toContain('PDF')
    expect(text).toContain('240 KB')
  })

  it('圖片用縮圖當圖示，其他檔案用型別圖示', async () => {
    const component = await mountSuspended(AttachmentList, {
      props: { attachments: [photo, pdf] },
    })

    const images = component.findAll('img')
    expect(images).toHaveLength(1)
    expect(images[0]!.attributes('src')).toBe(photo.url)
    // 縮圖是裝飾，檔名已經寫在旁邊了
    expect(images[0]!.attributes('alt')).toBe('')
    expect(component.text()).toContain('📄')
  })

  it('沒有附件時整塊不渲染', async () => {
    const component = await mountSuspended(AttachmentList, { props: { attachments: [] } })
    expect(component.text()).toBe('')
  })
})

describe('AdminAttachmentField', () => {
  it('列出已上傳的附件並可以移除', async () => {
    const component = await mountSuspended(AttachmentField, {
      props: { modelValue: [pdf, photo] },
    })

    expect(component.findAll('li')).toHaveLength(2)

    const remove = component
      .findAll('button')
      .find((button) => button.attributes('aria-label') === `移除 ${pdf.name}`)!
    await remove.trigger('click')

    // 移除的是陣列裡的那一筆，不是把整個陣列清掉
    expect(component.emitted('update:modelValue')?.at(-1)).toEqual([[photo]])
  })

  it('顯示已用掉幾個名額', async () => {
    const component = await mountSuspended(AttachmentField, { props: { modelValue: [pdf] } })
    expect(component.text()).toContain('1 / 10')
  })

  it('達到上限時停用選擇檔案', async () => {
    const full = Array.from({ length: 10 }, (_, i) => ({ ...pdf, url: `${pdf.url}?${i}` }))
    const component = await mountSuspended(AttachmentField, { props: { modelValue: full } })

    const choose = component.findAll('button').find((b) => b.text() === '選擇檔案')!
    expect(choose.attributes('disabled')).toBeDefined()
  })
})

/**
 * 首頁與公告牆共用同一張卡片。
 *
 * 曾經有一個「摘要模式」把附件收成「N 個附件」，但這個球隊的公告多半是
 * 「一句話 + 一個檔案」—— 收起來等於首頁那張卡什麼都沒說。
 */
describe('公告卡片在首頁與公告牆的呈現一致', () => {
  const announcement = {
    id: 'a1',
    title: '新莊聯盟 - 戰績表',
    content: '更新日期 - 2026/05/18',
    category: 'general' as const,
    pinned: false,
    status: 'published' as const,
    publishedAt: '2026-09-20T02:00:00.000Z',
    coverImageUrl: '',
    attachments: [pdf, photo],
    createdAt: '',
    updatedAt: '',
  }

  it('封面與附件縮圖用 object-contain，不裁掉聯盟標誌上的字', async () => {
    const { default: AnnouncementCard } =
      await import('../../app/components/news/AnnouncementCard.vue')
    const wrapper = await mountSuspended(AnnouncementCard, {
      props: {
        announcement: { ...announcement, coverImageUrl: 'https://example.com/league.png' },
      },
    })

    for (const image of wrapper.findAll('img')) {
      expect(image.classes()).toContain('object-contain')
      expect(image.classes()).not.toContain('object-cover')
    }
  })

  it('附件在卡片上就是可以點開的連結', async () => {
    const { default: AnnouncementCard } =
      await import('../../app/components/news/AnnouncementCard.vue')
    const wrapper = await mountSuspended(AnnouncementCard, { props: { announcement } })

    const link = wrapper.findAll('a').find((a) => a.attributes('href') === pdf.url)
    expect(link).toBeDefined()
    expect(link!.text()).toContain(pdf.name)
  })
})
