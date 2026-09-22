/**
 * 上傳前的圖片處理。
 *
 * ## 為什麼要在瀏覽器先壓縮
 * 手機拍的計分板照片動輒 4～8MB。直接送出去有三個代價：使用者在外面用行動
 * 網路等很久、BFF 的 body 上限被逼著開大、Gemini 依圖片大小計費。
 *
 * 壓到長邊 1600px 之後通常只剩兩三百 KB，而計分板上的數字仍然清晰可辨 ——
 * 辨識準確度不會因此下降。
 *
 * ## 失敗時的退路
 * HEIC 之類的格式瀏覽器不一定解得開。解不開時直接讀原檔，並在超過上限時
 * 明確報錯，而不是靜靜地送出一個會被伺服器擋掉的請求。
 */

/** 送往 BFF 的圖片。`base64` 不含 `data:` 前綴。 */
export interface PreparedImage {
  base64: string
  mimeType: string
  /** 處理後的位元組數，供畫面顯示。 */
  bytes: number
}

/** 與後端 `maxUploadBytes` 一致的上限（8MB），扣掉 base64 膨脹後的保守值。 */
const MAX_BYTES = 6 * 1024 * 1024

export async function prepareImage(
  file: File,
  options: { maxEdge?: number; quality?: number } = {},
): Promise<PreparedImage> {
  const { maxEdge = 1600, quality = 0.8 } = options

  if (!file.type.startsWith('image/')) {
    throw new Error('請選擇圖片檔案')
  }

  try {
    const compressed = await compress(file, maxEdge, quality)
    // 保留透明度的圖走 PNG，壓縮率比 JPEG 差很多，仍有可能超過上限
    if (compressed && compressed.bytes <= MAX_BYTES) return compressed

    if (compressed) {
      // 再縮一次邊長。去背圖多半是圖形而非照片，縮小後 PNG 會小很多，
      // 也比「為了容量把透明弄丟」好。
      const smaller = await compress(file, Math.round(maxEdge / 2), quality)
      if (smaller && smaller.bytes <= MAX_BYTES) return smaller
      throw new Error('圖片檔案過大，請先縮小尺寸或減少色彩後再上傳')
    }
  } catch (err) {
    // 壓縮後仍過大是明確的使用者錯誤，直接往上拋讓表單顯示
    if (err instanceof Error && err.message.includes('過大')) throw err
    // 其餘多半是解碼失敗（例如 HEIC），退回讀原檔，下面會再檢查大小
  }

  const base64 = await readFileAsBase64(file)
  const bytes = Math.floor((base64.length * 3) / 4)
  if (bytes > MAX_BYTES) {
    throw new Error('圖片太大且無法在瀏覽器中壓縮，請先轉成 JPEG 或 PNG 再上傳')
  }

  return { base64, mimeType: file.type, bytes }
}

async function compress(
  file: File,
  maxEdge: number,
  quality: number,
): Promise<PreparedImage | null> {
  if (typeof createImageBitmap !== 'function') return null

  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const context = canvas.getContext('2d')
  if (!context) return null

  context.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  /**
   * 有透明像素就必須輸出 PNG。
   *
   * JPEG 沒有 alpha 通道，去背的隊徽轉成 JPEG 之後，原本透明的區域會被編碼成
   * 黑色 —— 看起來就是隊徽被裝在一個黑色方塊裡。隊徽正是這個上傳功能最主要的
   * 用途之一，所以不能無條件轉 JPEG。
   *
   * 照片與截圖（球員照、計分板、賽程圖）沒有透明像素，仍然走 JPEG，
   * 那是它們該走的路 —— 同樣的內容 PNG 會大上好幾倍。
   */
  const format = hasTransparency(context, width, height)
    ? { mime: 'image/png' as const, quality: undefined }
    : { mime: 'image/jpeg' as const, quality }

  const dataUrl = canvas.toDataURL(format.mime, format.quality)
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)

  return {
    base64,
    mimeType: format.mime,
    bytes: Math.floor((base64.length * 3) / 4),
  }
}

/**
 * RGBA 像素資料中是否有透明（或半透明）像素。
 *
 * alpha 是每個像素 4 bytes 中的第 4 個。為了不讓大圖卡住主執行緒，
 * 每 8 個像素抽驗一次 —— 去背圖的透明區塊都是成片的背景，不會小到
 * 只佔零星幾個像素而被抽樣漏掉。
 *
 * 抽出來成為獨立的純函式是為了能測試：這段邏輯決定了上傳的隊徽會不會
 * 失去透明度，而 canvas 本身在測試環境裡跑不起來。
 *
 * @param data `ImageData.data`，格式為 [r, g, b, a, r, g, b, a, …]
 * @param threshold alpha 低於這個值就算透明。留一點餘裕給邊緣的抗鋸齒像素。
 */
export function containsTransparentPixel(
  data: Uint8ClampedArray | number[],
  threshold = 250,
): boolean {
  for (let i = 3; i < data.length; i += 32) {
    if ((data[i] ?? 255) < threshold) return true
  }
  return false
}

/**
 * 畫布上是否有透明像素。
 *
 * 讀取 canvas 像素在某些瀏覽器受同源限制，這裡的圖片來自使用者本機選檔，
 * 不會觸發；真的拋錯時保守地回傳 true（寧可輸出較大的 PNG，也不要把透明弄丟）。
 */
function hasTransparency(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
): boolean {
  try {
    return containsTransparentPixel(context.getImageData(0, 0, width, height).data)
  } catch {
    return true
  }
}

/** 把檔案讀成不含 `data:` 前綴的 base64。圖片與公告附件共用。 */
export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result)
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.onerror = () => reject(new Error('讀取檔案失敗'))
    reader.readAsDataURL(file)
  })
}

/** 把位元組數格式化成人看得懂的大小。 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
