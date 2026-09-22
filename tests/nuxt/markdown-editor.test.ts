// @vitest-environment nuxt
import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import MarkdownEditor from '../../app/components/admin/MarkdownEditor.vue'
import AnnouncementCard from '../../app/components/news/AnnouncementCard.vue'

/**
 * 公告的 Markdown 編輯與呈現。
 *
 * 語法轉換本身在 `tests/unit/markdown.test.ts` 測過了，這裡只驗證
 * 「元件有沒有把它接起來」—— 尤其是工具列改的是不是 v-model 的值、
 * 預覽和前台是不是真的同一份輸出。
 */

const announcement = {
  id: 'a1',
  title: '本週練習',
  content: '## 集合時間\n\n**週六 09:00**\n\n- 帶手套\n- 帶水',
  category: 'training' as const,
  pinned: false,
  status: 'published' as const,
  publishedAt: '2026-09-20T02:00:00.000Z',
  coverImageUrl: '',
  createdAt: '',
  updatedAt: '',
}

describe('NewsAnnouncementCard', () => {
  it('完整模式把 Markdown 渲染成 HTML', async () => {
    const wrapper = await mountSuspended(AnnouncementCard, { props: { announcement } })

    expect(wrapper.find('.markdown').exists()).toBe(true)
    // 標題降兩級，不會在卡片裡冒出 h1
    expect(wrapper.find('.markdown h4').text()).toBe('集合時間')
    expect(wrapper.find('.markdown strong').text()).toBe('週六 09:00')
    expect(wrapper.findAll('.markdown li')).toHaveLength(2)
    expect(wrapper.find('h1').exists()).toBe(false)
  })

  it('摘要模式（首頁）渲染同一份 Markdown，只是限制高度', async () => {
    const wrapper = await mountSuspended(AnnouncementCard, {
      props: { announcement, compact: true },
    })

    const markdown = wrapper.find('.markdown')
    expect(markdown.exists()).toBe(true)
    expect(markdown.classes()).toContain('markdown-clamp')
    // 語法記號不該露出來 —— 露出來就代表根本沒渲染
    expect(markdown.text()).not.toContain('**')
    expect(markdown.find('strong').text()).toBe('週六 09:00')
  })

  it('完整模式不套高度限制', async () => {
    const wrapper = await mountSuspended(AnnouncementCard, { props: { announcement } })
    expect(wrapper.find('.markdown').classes()).not.toContain('markdown-clamp')
  })
})

describe('AdminMarkdownEditor', () => {
  const mount = (modelValue = '') =>
    mountSuspended(MarkdownEditor, { props: { label: '內容', modelValue } })

  it('工具列改的是 v-model 的值', async () => {
    const wrapper = await mount('本週練習取消')
    const textarea = wrapper.find('textarea').element as HTMLTextAreaElement
    textarea.setSelectionRange(2, 4)

    const bold = wrapper.findAll('button').find((b) => b.text() === '粗體')!
    await bold.trigger('click')

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['本週**練習**取消'])
  })

  it('清單按鈕以行為單位生效', async () => {
    const wrapper = await mount('帶手套')
    const textarea = wrapper.find('textarea').element as HTMLTextAreaElement
    textarea.setSelectionRange(1, 1)

    await wrapper
      .findAll('button')
      .find((b) => b.text() === '清單')!
      .trigger('click')

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['- 帶手套'])
  })

  it('⌘B 等快捷鍵和按鈕做一樣的事', async () => {
    const wrapper = await mount('本週練習取消')
    const textarea = wrapper.find('textarea')
    ;(textarea.element as HTMLTextAreaElement).setSelectionRange(2, 4)

    await textarea.trigger('keydown', { key: 'b', metaKey: true })

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['本週**練習**取消'])
  })

  it('預覽用的是前台那個元件，所以兩邊長得一樣', async () => {
    const wrapper = await mount('## 集合時間')
    expect(wrapper.find('.markdown').exists()).toBe(false)

    await wrapper
      .findAll('button')
      .find((b) => b.text() === '預覽')!
      .trigger('click')

    expect(wrapper.find('.markdown h4').text()).toBe('集合時間')
    // 預覽時不該還能按插入按鈕 —— 改的是看不到的東西
    expect(
      wrapper
        .findAll('button')
        .find((b) => b.text() === '粗體')!
        .attributes('disabled'),
    ).toBeDefined()
  })

  it('切到預覽再切回來，textarea 沒有被卸載', async () => {
    // 用 v-if 的話捲動位置與游標都會消失，寫長公告時非常惱人
    const wrapper = await mount('內容')
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '預覽')!
      .trigger('click')

    expect(wrapper.find('textarea').exists()).toBe(true)
    expect(wrapper.find('textarea').attributes('style')).toContain('display: none')
  })
})
