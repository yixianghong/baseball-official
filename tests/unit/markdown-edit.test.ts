import { describe, expect, it } from 'vitest'
import {
  insertBlock,
  insertLink,
  toggleLinePrefix,
  toggleWrap,
} from '../../app/utils/markdown-edit'

/**
 * 編輯器工具列的文字操作。
 *
 * 這些函式會出錯的地方幾乎都在邊界：沒有選取、只選了一半、已經套用過、
 * 選取範圍跨了好幾行。工具列按鈕一按下去就改了使用者的內容，
 * 錯了很難還原，所以每一種情況都列出來。
 */

const BULLET = { make: () => '- ', match: /^[-*+] / }
const ORDERED = { make: (i: number) => `${i + 1}. `, match: /^\d+\. / }
const QUOTE = { make: () => '> ', match: /^> / }
const HEADING = { make: () => '## ', match: /^#{1,6} / }

describe('toggleWrap', () => {
  it('把選取的文字包起來，並選住包起來的內容', () => {
    const result = toggleWrap('本週練習取消', 2, 4, '**', '粗體')
    expect(result.text).toBe('本週**練習**取消')
    expect(result.text.slice(result.start, result.end)).toBe('練習')
  })

  it('沒有選取時插入標記，游標落在佔位文字上', () => {
    const result = toggleWrap('', 0, 0, '**', '粗體')
    expect(result.text).toBe('**粗體**')
    expect(result.text.slice(result.start, result.end)).toBe('粗體')
  })

  it('連標記一起選起來時取消', () => {
    const result = toggleWrap('本週**練習**取消', 2, 8, '**', '粗體')
    expect(result.text).toBe('本週練習取消')
    expect(result.text.slice(result.start, result.end)).toBe('練習')
  })

  it('只選中間的字、標記在外面時一樣取消', () => {
    // 按了粗體之後游標就停在這個位置，再按一次要能還原
    const result = toggleWrap('本週**練習**取消', 4, 6, '**', '粗體')
    expect(result.text).toBe('本週練習取消')
    expect(result.text.slice(result.start, result.end)).toBe('練習')
  })
})

describe('toggleLinePrefix', () => {
  it('整行生效，即使只把游標放在行中間', () => {
    const result = toggleLinePrefix('帶手套', 1, 1, BULLET.make, BULLET.match)
    expect(result.text).toBe('- 帶手套')
  })

  it('跨行選取時每一行都加', () => {
    const result = toggleLinePrefix('帶手套\n帶水\n帶球棒', 1, 9, BULLET.make, BULLET.match)
    expect(result.text).toBe('- 帶手套\n- 帶水\n- 帶球棒')
  })

  it('全部都已經套用時再按一次就取消', () => {
    const text = '- 帶手套\n- 帶水'
    const result = toggleLinePrefix(text, 0, text.length, BULLET.make, BULLET.match)
    expect(result.text).toBe('帶手套\n帶水')
  })

  it('只有部分套用時補齊而不是取消', () => {
    const text = '- 帶手套\n帶水'
    const result = toggleLinePrefix(text, 0, text.length, BULLET.make, BULLET.match)
    expect(result.text).toBe('- 帶手套\n- 帶水')
  })

  it('編號清單會遞增', () => {
    const text = '第一\n第二\n第三'
    const result = toggleLinePrefix(text, 0, text.length, ORDERED.make, ORDERED.match)
    expect(result.text).toBe('1. 第一\n2. 第二\n3. 第三')
  })

  it('空行不加前綴，也不影響「是否全部套用」的判斷', () => {
    const text = '- 帶手套\n\n- 帶水'
    const result = toggleLinePrefix(text, 0, text.length, BULLET.make, BULLET.match)
    // 中間的空行不該讓整段被判定成「還沒套用」而又包一層
    expect(result.text).toBe('帶手套\n\n帶水')
  })

  it('引用與標題用同一套規則', () => {
    expect(toggleLinePrefix('注意', 0, 2, QUOTE.make, QUOTE.match).text).toBe('> 注意')
    expect(toggleLinePrefix('本週練習', 0, 4, HEADING.make, HEADING.match).text).toBe('## 本週練習')
    // 已經是其他級數的標題時，換成這一級而不是變成 `## ### x`
    expect(toggleLinePrefix('### 本週練習', 0, 8, HEADING.make, HEADING.match).text).toBe(
      '本週練習',
    )
  })

  it('選取範圍涵蓋整段處理過的文字', () => {
    const result = toggleLinePrefix('帶手套\n帶水', 0, 6, BULLET.make, BULLET.match)
    expect(result.text.slice(result.start, result.end)).toBe('- 帶手套\n- 帶水')
  })
})

describe('insertLink', () => {
  it('沒有選取時插入範本，游標停在連結文字上', () => {
    const result = insertLink('', 0, 0)
    expect(result.text).toBe('[連結文字](https://)')
    expect(result.text.slice(result.start, result.end)).toBe('連結文字')
  })

  it('選取的是文字時，游標跳到網址上等著貼上', () => {
    const result = insertLink('請看報名表', 2, 5)
    expect(result.text).toBe('請看[報名表](https://)')
    expect(result.text.slice(result.start, result.end)).toBe('https://')
  })

  it('選取的是網址時拿它當網址，游標回到文字上', () => {
    const text = 'https://example.com/form'
    const result = insertLink(text, 0, text.length)
    expect(result.text).toBe('[連結文字](https://example.com/form)')
    expect(result.text.slice(result.start, result.end)).toBe('連結文字')
  })
})

describe('insertBlock', () => {
  it('與前文之間留一個空行', () => {
    // 少了空行，`---` 會被解析成把上一行變成標題的底線
    expect(insertBlock('本週練習', 4, 4, '---').text).toBe('本週練習\n\n---\n')
  })

  it('空白內容時不多補空行', () => {
    expect(insertBlock('', 0, 0, '---').text).toBe('---\n')
  })
})
