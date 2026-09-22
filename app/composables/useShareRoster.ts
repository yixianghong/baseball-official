/**
 * 把畫面上的一塊區域存成 PNG —— 下載或分享，由呼叫端（也就是使用者）決定。
 *
 * ## 為什麼是兩個動作而不是一個「聰明」的按鈕
 * 早期版本只有一顆按鈕，自己判斷「能分享就分享、不能就下載」。問題是
 * 使用者按下去之前不知道會發生什麼 —— 想存檔的人被叫出分享選單，
 * 想貼到群組的人拿到一個檔案。兩個明確的動作比一個猜心思的按鈕好。
 *
 * ## 隊徽為什麼要繞道
 * canvas 只要畫進沒有 CORS 標頭的跨網域圖片就會被污染，`toBlob()` 會拋
 * SecurityError。`storage.googleapis.com` 上的隊徽實測沒有 CORS 標頭，
 * 所以交給 `fetchFn` 改從自己網域的 `/api/media/remote` 取回。
 *
 * ## 函式庫是點下去才載入的
 * `modern-screenshot` 有二十幾 KB，而多數訪客不會按。用動態 import
 * 讓它不進首屏的 bundle。
 */
export type RosterImageTarget = {
  node: HTMLElement | null
  filename: string
}

export type RosterShareText = {
  title: string
  text: string
}

/** 哪一個動作正在進行中。兩顆按鈕要能各自顯示自己的狀態。 */
export type RosterAction = 'download' | 'share' | null

export function useShareRoster() {
  const busy = ref<RosterAction>(null)
  const message = ref('')

  /** 下載 PNG。這條路不依賴任何瀏覽器 API，永遠有效。 */
  async function downloadImage(target: RosterImageTarget): Promise<boolean> {
    if (busy.value) return false
    busy.value = 'download'
    message.value = ''

    try {
      const blob = target.node ? await capture(target.node) : null
      if (!blob) {
        message.value = '圖片產生失敗，請稍後再試'
        return false
      }

      download(blob, target.filename)
      message.value = '已下載名單圖片'
      return true
    } finally {
      busy.value = null
    }
  }

  /**
   * 分享 PNG。
   *
   * 桌機瀏覽器多半沒有 `navigator.share`，或有但不收檔案 —— 那時退回
   * 分享／複製本頁網址，並且**明白告訴使用者發生了什麼**，不要讓他以為
   * 圖片已經傳出去了。
   */
  async function shareImage(target: RosterImageTarget & RosterShareText): Promise<boolean> {
    if (busy.value) return false
    busy.value = 'share'
    message.value = ''

    try {
      const blob = target.node ? await capture(target.node) : null

      if (blob) {
        const file = new File([blob], target.filename, { type: 'image/png' })

        // canShare 一定要帶 files 去問 —— 有些瀏覽器有 share 但不收檔案
        if (navigator.canShare?.({ files: [file] })) {
          try {
            await navigator.share({ files: [file], title: target.title, text: target.text })
            message.value = '已分享'
            return true
          } catch (error) {
            // 使用者在系統分享選單按取消，那不是錯誤，也不該再退回別的做法
            if (isAbort(error)) {
              message.value = ''
              return false
            }
            console.error('[share] 系統分享失敗', error)
          }
        }
      }

      return await shareLink(target)
    } finally {
      busy.value = null
    }
  }

  /** 退路：分享或複製本頁網址。這是最後一層，不再往外拋。 */
  async function shareLink(target: RosterShareText): Promise<boolean> {
    const url = location.href

    if (navigator.share) {
      try {
        await navigator.share({ title: target.title, text: target.text, url })
        message.value = '已分享本頁連結'
        return true
      } catch (error) {
        if (isAbort(error)) {
          message.value = ''
          return false
        }
        console.error('[share] 分享網址失敗', error)
      }
    }

    try {
      await navigator.clipboard.writeText(url)
      message.value = '這個瀏覽器不支援分享圖片，已複製本頁網址'
      return true
    } catch {
      message.value = '這個瀏覽器不支援分享，請改用「下載圖片」'
      return false
    }
  }

  return { busy, message, downloadImage, shareImage }
}

/** 使用者按取消時瀏覽器丟的是 AbortError，那不是錯誤。 */
function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

/** 把節點畫成 PNG。失敗回傳 null，由呼叫端決定要怎麼講。 */
async function capture(node: HTMLElement): Promise<Blob | null> {
  try {
    const { domToBlob } = await import('modern-screenshot')

    return await domToBlob(node, {
      // 2 倍解析度，轉貼到聊天室縮圖時才不會糊
      scale: 2,
      type: 'image/png',
      // 圖卡本身是深色的，但去背的 PNG 貼到淺色聊天室會看不清楚邊界
      backgroundColor: '#071221',
      fetchFn: async (url) => {
        // 同源或已經是 data URL 的交給函式庫自己處理
        if (url.startsWith('data:') || url.startsWith(location.origin)) return false
        return await toDataUrl(`/api/media/remote?src=${encodeURIComponent(url)}`)
      },
    })
  } catch (error) {
    console.error('[share] domToBlob 失敗', error)
    return null
  }
}

/** 透過自己的網域取回圖片並轉成 data URL（繞開來源網域缺少 CORS 的問題）。 */
async function toDataUrl(url: string): Promise<string | false> {
  try {
    const response = await fetch(url)
    if (!response.ok) return false

    const blob = await response.blob()
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(blob)
    })
  } catch {
    return false
  }
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  // 不撤銷的話這個 blob 會一直留在記憶體裡直到分頁關閉
  URL.revokeObjectURL(url)
}
