import { describe, expect, it } from 'vitest'
import {
  CHUNK_ALIGNMENT,
  describeUploadFailure,
  nextChunk,
  parseCommittedOffset,
} from '../../app/utils/youtube-upload'

/**
 * 分塊上傳的邊界判斷。
 *
 * 這三個純函式全部寫錯過的話，症狀都是「上傳看起來在跑，然後失敗／卡住」
 * ——而要重現得先有一個幾 GB 的檔案跟一個真的 YouTube 工作階段。
 * 所以邊界在這裡測，剩下的（XHR 的事件順序）只能靠實際上傳。
 */

describe('nextChunk', () => {
  it('第一塊從 0 開始，end 是含的', () => {
    expect(nextChunk(0, 10 * CHUNK_ALIGNMENT, CHUNK_ALIGNMENT)).toEqual({
      start: 0,
      end: CHUNK_ALIGNMENT - 1,
    })
  })

  it('最後一塊不滿也要送完', () => {
    expect(nextChunk(CHUNK_ALIGNMENT, CHUNK_ALIGNMENT + 10, CHUNK_ALIGNMENT)).toEqual({
      start: CHUNK_ALIGNMENT,
      end: CHUNK_ALIGNMENT + 9,
    })
  })

  it('比一塊還小的檔案只有一塊', () => {
    expect(nextChunk(0, 100)).toEqual({ start: 0, end: 99 })
  })

  it('送完了就回 null', () => {
    expect(nextChunk(100, 100)).toBeNull()
    expect(nextChunk(0, 0)).toBeNull()
  })

  it('塊大小一律對齊 256 KiB —— 不是倍數時 Google 會回 400', () => {
    const chunk = nextChunk(0, 10 * CHUNK_ALIGNMENT, CHUNK_ALIGNMENT + 1)
    expect(chunk!.end - chunk!.start + 1).toBe(CHUNK_ALIGNMENT)
  })

  it('要求的塊比對齊單位還小時，也不會退化成 0 長度', () => {
    // 回 { start: 0, end: -1 } 的話，slice 出來是空的，迴圈就永遠不會前進
    const chunk = nextChunk(0, 10 * CHUNK_ALIGNMENT, 1)
    expect(chunk).toEqual({ start: 0, end: CHUNK_ALIGNMENT - 1 })
  })
})

describe('parseCommittedOffset', () => {
  it('讀得到 Range 標頭時以伺服器說的為準', () => {
    expect(parseCommittedOffset('bytes=0-262143', 999)).toBe(262144)
  })

  it('讀不到標頭時假設整塊都送達了', () => {
    // 跨網域讀不讀得到 Range 取決於 Access-Control-Expose-Headers。
    // 回 308 本來就代表伺服器收下了我們送的範圍，所以這個假設是安全的。
    expect(parseCommittedOffset(null, 999)).toBe(1000)
    expect(parseCommittedOffset('', 999)).toBe(1000)
    expect(parseCommittedOffset('bytes=100-200', 999)).toBe(1000)
  })
})

describe('describeUploadFailure', () => {
  it('分出機器判讀的 reason 與給人看的 message', () => {
    const body = JSON.stringify({
      error: { errors: [{ reason: 'uploadLimitExceeded' }], message: 'The user has exceeded…' },
    })
    expect(describeUploadFailure(body)).toEqual({
      reason: 'uploadLimitExceeded',
      message: 'The user has exceeded…',
    })
  })

  it('不是 JSON 時至少把原文帶出來，不要吞掉', () => {
    expect(describeUploadFailure('<html>502</html>')).toEqual({
      reason: '',
      message: '<html>502</html>',
    })
  })

  it('連原文都是空的時候給一句話，不要顯示成空白', () => {
    expect(describeUploadFailure('').message).toBe('沒有說明')
  })
})
