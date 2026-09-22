/**
 * Markdown 編輯器工具列背後的文字操作。
 *
 * 全部是純函式：輸入「現在的文字 + 游標範圍」，輸出「新的文字 + 新的游標範圍」。
 * 不碰 DOM，因此每一種邊界情況（沒選取、選到一半、已經套用過了）都測得到 ——
 * 而這些邊界情況正是工具列會出錯的地方，肉眼很難逐一試完。
 *
 * 游標範圍要一起回傳，不能只回傳文字：按完「粗體」如果游標跳到最前面，
 * 連續操作就完全沒辦法做。
 */

export interface TextEdit {
  text: string
  /** 操作完成後應該選取的範圍。 */
  start: number
  end: number
}

/**
 * 切換成對的標記（`**粗體**`、`*斜體*`、`` `程式碼` ``）。
 *
 * 已經套用的話就取消 —— 兩種寫法都認得：標記在選取範圍**裡面**
 * （使用者連標記一起選起來），或在**外面**（只選了中間的字）。
 * 只認一種的話，看起來就是「按了沒反應，又多包了一層」。
 */
export function toggleWrap(
  text: string,
  start: number,
  end: number,
  marker: string,
  placeholder: string,
): TextEdit {
  const selected = text.slice(start, end)
  const width = marker.length

  // 標記在選取範圍裡：**粗體** 整段被選起來
  if (selected.length >= width * 2 && selected.startsWith(marker) && selected.endsWith(marker)) {
    const inner = selected.slice(width, -width)
    return {
      text: text.slice(0, start) + inner + text.slice(end),
      start,
      end: start + inner.length,
    }
  }

  // 標記在選取範圍外：只選了中間的「粗體」兩個字
  if (text.slice(start - width, start) === marker && text.slice(end, end + width) === marker) {
    return {
      text: text.slice(0, start - width) + selected + text.slice(end + width),
      start: start - width,
      end: end - width,
    }
  }

  const inner = selected || placeholder
  return {
    text: text.slice(0, start) + marker + inner + marker + text.slice(end),
    start: start + width,
    end: start + width + inner.length,
  }
}

/**
 * 切換整行開頭的標記（`- `、`1. `、`> `、`## `）。
 *
 * 以「行」為單位而不是以選取範圍為單位：選到一行的中間也該整行生效，
 * 這是所有編輯器的共同慣例。
 *
 * @param make  第 n 行（從 0 起算）要加的前綴。編號清單需要遞增，所以是函式。
 * @param match 判斷某一行是否已經套用過的樣式。
 */
export function toggleLinePrefix(
  text: string,
  start: number,
  end: number,
  make: (index: number) => string,
  match: RegExp,
): TextEdit {
  const from = lineStart(text, start)
  const to = lineEnd(text, end)
  const lines = text.slice(from, to).split('\n')

  // 只看有內容的行：中間夾了一行空行不該讓整段都被判定成「還沒套用」
  const meaningful = lines.filter((line) => line.trim().length > 0)
  const allMatched = meaningful.length > 0 && meaningful.every((line) => match.test(line))

  const next = lines
    .map((line, index) => {
      if (allMatched) return line.replace(match, '')
      if (!line.trim()) return line
      return make(index) + line.replace(match, '')
    })
    .join('\n')

  return { text: text.slice(0, from) + next + text.slice(to), start: from, end: from + next.length }
}

/**
 * 插入連結。
 *
 * 選取的是網址就拿它當網址、游標留在文字上；否則反過來。
 * 貼上網址再選起來按連結，是最常見的一種用法。
 */
export function insertLink(text: string, start: number, end: number): TextEdit {
  const selected = text.slice(start, end).trim()
  const isUrl = /^(https?:\/\/|mailto:|\/)\S+$/i.test(selected)

  const label = isUrl ? '連結文字' : selected || '連結文字'
  const href = isUrl ? selected : 'https://'
  const snippet = `[${label}](${href})`

  // 游標放在「等一下一定要改」的那一段上：網址已經有了就停在文字上，
  // 否則停在網址上。兩邊都是空的（沒有選取）時先讓人把文字打完。
  const focusLabel = isUrl || selected === ''
  const offset = focusLabel ? 1 : label.length + 3
  const length = focusLabel ? label.length : href.length

  return {
    text: text.slice(0, start) + snippet + text.slice(end),
    start: start + offset,
    end: start + offset + length,
  }
}

/** 在游標所在的段落後面插入一個獨立的區塊（目前只有分隔線用到）。 */
export function insertBlock(text: string, start: number, end: number, block: string): TextEdit {
  const to = lineEnd(text, end)
  const before = text.slice(0, to)
  // 前面沒有空行就補一個，否則 `---` 會被當成上一行的底線標題
  const prefix = before.endsWith('\n\n') || before === '' ? '' : '\n\n'
  const snippet = `${prefix}${block}\n`
  const at = to + snippet.length

  return { text: before + snippet + text.slice(to), start: at, end: at }
}

function lineStart(text: string, index: number): number {
  return text.lastIndexOf('\n', Math.max(0, index - 1)) + 1
}

function lineEnd(text: string, index: number): number {
  const found = text.indexOf('\n', index)
  return found === -1 ? text.length : found
}
