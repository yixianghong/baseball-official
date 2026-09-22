import { describe, expect, it } from 'vitest'
import { markdownToText, renderMarkdown } from '../../app/utils/markdown'

/**
 * 公告的 Markdown 轉換。
 *
 * 產生的 HTML 會直接交給 `v-html`，所以這裡最重要的不是「語法有沒有支援」，
 * 而是**解析器在任何輸入下都不會吐出可執行的東西**。安全相關的期待寫得比
 * 功能還細：這類問題一旦漏掉，畫面上完全看不出來。
 */

describe('renderMarkdown', () => {
  it('轉換基本語法', () => {
    const html = renderMarkdown('**粗體** 與 *斜體*')
    expect(html).toContain('<strong>粗體</strong>')
    expect(html).toContain('<em>斜體</em>')
  })

  it('標題降兩級，避免打亂頁面大綱', () => {
    // 公告是卡片裡的片段，頁面已經有 h1、卡片標題是 h3
    expect(renderMarkdown('# 一級標題')).toContain('<h3>一級標題</h3>')
    expect(renderMarkdown('## 二級標題')).toContain('<h4>二級標題</h4>')
    // 降到底就停在 h6，不會產生 h7 這種不存在的標籤
    expect(renderMarkdown('###### 最小標題')).toContain('<h6>最小標題</h6>')
  })

  it('支援清單、引用與程式碼', () => {
    const html = renderMarkdown('- 第一項\n- 第二項\n\n> 引用\n\n`code`')
    expect(html).toContain('<ul>')
    expect(html).toContain('<li>第一項</li>')
    expect(html).toContain('<blockquote>')
    expect(html).toContain('<code>code</code>')
  })

  it('單一換行就換行（維持公告原本的純文字排版）', () => {
    // 舊公告是以 white-space: pre-wrap 呈現的，作者按的每個 Enter 都看得到。
    // CommonMark 預設會把這裡擠成一段，既有內容的排版就全毀了。
    expect(renderMarkdown('第一行\n第二行')).toContain('<br>')
  })

  it('原始 HTML 被跳脫成純文字', () => {
    const html = renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>')
    // 標籤整段變成可見的文字，瀏覽器不會把它當成元素解析
    expect(html).not.toContain('<script')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })

  it('擋掉 javascript: 連結', () => {
    // 連結被拒絕時 markdown-it 會把原始碼原樣留成文字，所以要斷言的是
    // 「沒有產生連結」而不是「字串裡看不到 javascript:」
    const html = renderMarkdown('[點我](javascript:alert(1))')
    expect(html).not.toContain('<a ')
    expect(html).not.toContain('href=')
  })

  it('擋掉 data: 連結', () => {
    // markdown-it 預設放行 data:image/*，當作連結的 href 沒有正當用途
    const html = renderMarkdown('[點我](data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=)')
    expect(html).not.toContain('<a ')
  })

  it('外部連結另開分頁並加上 rel', () => {
    const html = renderMarkdown('[球團](https://example.com)')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
  })

  it('站內連結不另開分頁', () => {
    const html = renderMarkdown('[賽程](/schedule)')
    expect(html).toContain('href="/schedule"')
    expect(html).not.toContain('target="_blank"')
  })

  it('裸網址會自動變成連結', () => {
    expect(renderMarkdown('報名表 https://example.com/form')).toContain(
      '<a href="https://example.com/form"',
    )
  })

  it('內文圖片延遲載入且保留 alt', () => {
    const html = renderMarkdown('![球隊合照](https://example.com/a.jpg)')
    expect(html).toContain('loading="lazy"')
    expect(html).toContain('alt="球隊合照"')
  })

  it('空內容回傳空字串', () => {
    expect(renderMarkdown('')).toBe('')
  })
})

describe('markdownToText', () => {
  it('去掉語法只留文字', () => {
    const text = markdownToText('## 本週練習\n\n**時間**：週六 9:00\n\n- 帶手套\n- 帶水')
    expect(text).toBe('本週練習 時間：週六 9:00 帶手套 帶水')
  })

  it('連結取文字、圖片取 alt', () => {
    expect(markdownToText('[報名表](https://example.com) 與 ![合照](/a.jpg)')).toBe(
      '報名表 與 合照',
    )
  })

  it('程式碼區塊的內容也算文字', () => {
    expect(markdownToText('```\n集合地點\n```')).toBe('集合地點')
  })

  it('不把不是語法的星號吃掉', () => {
    // 正規表示式的作法在這裡會出錯：單獨的 * 不是強調語法
    expect(markdownToText('特別注意 * 這個符號')).toBe('特別注意 * 這個符號')
  })

  it('空內容回傳空字串', () => {
    expect(markdownToText('')).toBe('')
  })
})
