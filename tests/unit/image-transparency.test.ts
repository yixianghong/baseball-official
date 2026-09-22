import { describe, expect, it } from 'vitest'
import { containsTransparentPixel, formatBytes } from '../../app/utils/image'

/**
 * 上傳圖片時的透明度判斷。
 *
 * ## 這個測試存在的原因
 * 壓縮流程原本無條件把所有圖片輸出成 JPEG，理由是「處理的都是照片與截圖，
 * 沒有透明區域」。但隊徽正是這個上傳功能最主要的用途之一，而 JPEG 沒有
 * alpha 通道 —— 去背的隊徽上傳之後，原本透明的地方會變成黑色方塊。
 *
 * 判斷邏輯獨立成純函式就是為了能在這裡釘住：canvas 在測試環境跑不起來，
 * 但「哪些像素資料算有透明」是可以直接驗的。
 */

/** 產生 n 個像素的 RGBA 資料，`alphas` 指定每個像素的 alpha。 */
function pixels(alphas: number[]): number[] {
  return alphas.flatMap((alpha) => [0, 0, 0, alpha])
}

describe('containsTransparentPixel', () => {
  it('全不透明的照片判定為沒有透明', () => {
    expect(containsTransparentPixel(pixels(Array(64).fill(255)))).toBe(false)
  })

  it('第一個像素就透明時判定為有透明', () => {
    const data = pixels(Array(64).fill(255))
    data[3] = 0
    expect(containsTransparentPixel(data)).toBe(true)
  })

  it('成片的透明背景一定抓得到（抽樣不會漏掉去背圖）', () => {
    // 模擬去背圖：前半是透明背景，後半是圖案本體
    const alphas = [...Array(128).fill(0), ...Array(128).fill(255)]
    expect(containsTransparentPixel(pixels(alphas))).toBe(true)
  })

  it('半透明（抗鋸齒邊緣）也算透明', () => {
    const data = pixels(Array(64).fill(255))
    data[3] = 128
    expect(containsTransparentPixel(data)).toBe(true)
  })

  it('alpha 略低於 255 但仍接近不透明時不算（避免照片被誤判成去背圖）', () => {
    expect(containsTransparentPixel(pixels(Array(64).fill(252)))).toBe(false)
  })

  it('空資料不會爆掉', () => {
    expect(containsTransparentPixel([])).toBe(false)
  })
})

describe('formatBytes', () => {
  it.each([
    [512, '512 B'],
    [2048, '2 KB'],
    [3 * 1024 * 1024, '3.0 MB'],
  ])('%i → %s', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected)
  })
})
