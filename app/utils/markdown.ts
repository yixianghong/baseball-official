import MarkdownIt from 'markdown-it'

/**
 * 公告內容的 Markdown 轉換。
 *
 * ## 為什麼敢把產生的 HTML 交給 `v-html`
 * 唯一的防線是**解析器本身不產生危險的 HTML**，而不是事後清洗：
 *
 * - `html: false` —— 原始碼裡的 `<script>`、`<img onerror=…>` 一律被跳脫成
 *   純文字，解析器**永遠不會**輸出它們。這比「先產生再用 DOMPurify 洗掉」
 *   安全得多，也不需要在伺服器端模擬一個 DOM。
 * - `validateLink` 收緊成白名單（http / https / mailto / tel / 相對路徑），
 *   擋掉 `javascript:` 這類會在點擊時執行程式的協定。markdown-it 預設就擋
 *   `javascript:`，但它也放行 `data:image/*`，這裡一併收掉。
 *
 * 公告只有登入後台的人寫得了，所以威脅模型不是「防惡意作者」，而是
 * 「貼上來的內容裡夾帶了什麼」—— 從別處複製一段文字進來是日常操作。
 *
 * ## `breaks: true` 不是偏好，是相容性
 * 公告本來是純文字、以 `white-space: pre-wrap` 呈現，作者按的每一個 Enter
 * 都看得到。CommonMark 預設單一換行只是空白，既有的公告會整篇擠成一段。
 * 開著它，舊內容的排版維持原樣，作者也不必學「空兩行才是分段」。
 */

/**
 * 標題降兩級：`#` 會變成 `<h3>`。
 *
 * 公告是放在卡片裡的片段，頁面本身已經有 `<h1>`、卡片標題是 `<h3>`。
 * 讓內文直接產生 `<h1>` 會把整頁的大綱打亂 —— 這件事在畫面上完全看不出來，
 * 只有螢幕閱讀器和 SEO 會受影響。
 */
const HEADING_OFFSET = 2

/** 可以出現在連結上的協定。相對路徑（`/news`、`#section`）不在此列，另外放行。 */
const SAFE_PROTOCOLS = ['http:', 'https:', 'mailto:', 'tel:']

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  // typographer 會把引號換成彎引號、`...` 換成 `…`，中文標點下的結果很難預料
  typographer: false,
})

md.validateLink = (url) => {
  const trimmed = url.trim()
  // 相對路徑與錨點沒有協定，交給瀏覽器解析即可
  if (/^[/#?]/.test(trimmed)) return true
  try {
    return SAFE_PROTOCOLS.includes(new URL(trimmed, 'https://example.invalid').protocol)
  } catch {
    return false
  }
}

md.renderer.rules.heading_open = (tokens, index) => {
  const level = Number(tokens[index]!.tag.slice(1)) + HEADING_OFFSET
  return `<h${Math.min(level, 6)}>`
}

md.renderer.rules.heading_close = (tokens, index) => {
  const level = Number(tokens[index]!.tag.slice(1)) + HEADING_OFFSET
  return `</h${Math.min(level, 6)}>`
}

/*
 * 外部連結一律另開分頁並加上 `rel`。
 *
 * `noopener` 是安全需求（沒有它，開啟的頁面可以透過 `window.opener` 反過來
 * 改我們這一頁的網址）。站內連結不套用 —— 在自己的網站裡跳頁還另開分頁，
 * 只會留下一堆分頁。
 */
md.renderer.rules.link_open = (tokens, index, options, _env, self) => {
  const token = tokens[index]!
  const href = String(token.attrGet('href') ?? '')
  if (/^https?:/i.test(href)) {
    token.attrSet('target', '_blank')
    token.attrSet('rel', 'noopener noreferrer')
  }
  return self.renderToken(tokens, index, options)
}

/** 內文圖片一律延遲載入：公告牆一次可能列出幾十則。 */
md.renderer.rules.image = (tokens, index, options, env, self) => {
  const token = tokens[index]!
  token.attrSet('loading', 'lazy')
  // 預設的 image 規則會把子節點攤平成 alt 文字，覆寫掉就得自己補，
  // 否則所有內文圖片的 alt 都會是空的
  token.attrSet('alt', self.renderInlineAsText(token.children ?? [], options, env))
  return self.renderToken(tokens, index, options)
}

/** Markdown → HTML。輸出可以安全地交給 `v-html`，理由見檔案開頭。 */
export function renderMarkdown(source: string): string {
  if (!source) return ''
  return md.render(source)
}

/**
 * Markdown → 純文字，給摘要、推播內容這些只能放一行字的地方用。
 *
 * 走的是同一個解析器的 token 樹而不是正規表示式：`**` 何時是粗體、何時只是
 * 兩個星號，這件事沒辦法用 regex 正確判斷，而摘要跟內文對不上會很奇怪。
 */
export function markdownToText(source: string): string {
  if (!source) return ''

  const parts: string[] = []
  for (const token of md.parse(source, {})) {
    if (token.type === 'inline') parts.push(collectText(token.children ?? []))
    // 程式碼區塊沒有 inline 子節點，內容直接掛在 token 上
    else if (token.type === 'fence' || token.type === 'code_block') parts.push(token.content)
  }

  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

type InlineToken = { type: string; content: string }

function collectText(children: InlineToken[]): string {
  return children
    .map((child) => {
      // 圖片取 alt 文字；它的 content 就是 alt，不必再往下走子節點
      if (child.type === 'image') return child.content
      if (child.type === 'text' || child.type === 'code_inline') return child.content
      if (child.type === 'softbreak' || child.type === 'hardbreak') return ' '
      return ''
    })
    .join('')
}
