import { describe, expect, it } from 'vitest'
import { encodeWav, mixToMono, SPEECH_SAMPLE_RATE } from '../../app/utils/wav'

/**
 * 語音送去辨識之前的轉檔。
 *
 * 編碼器是純函式，所以整段轉檔邏輯測得到 —— 不需要真的錄一段音。
 * 有狀態的那一半（`AudioContext`、`decodeAudioData`）留在 `blobToWav()`，
 * 那部分只能靠實機驗證。
 */

/** 把 Blob 讀成一個好讀的 DataView。 */
async function view(blob: Blob): Promise<DataView> {
  return new DataView(await blob.arrayBuffer())
}

function text(data: DataView, offset: number, length: number): string {
  let out = ''
  for (let i = 0; i < length; i++) out += String.fromCharCode(data.getUint8(offset + i))
  return out
}

describe('encodeWav', () => {
  it('寫出合法的 RIFF/WAVE header', async () => {
    const data = await view(encodeWav(new Float32Array(4), SPEECH_SAMPLE_RATE))
    expect(text(data, 0, 4)).toBe('RIFF')
    expect(text(data, 8, 4)).toBe('WAVE')
    expect(text(data, 12, 4)).toBe('fmt ')
    expect(text(data, 36, 4)).toBe('data')
  })

  it('宣告成 16 位元單聲道 PCM', async () => {
    const data = await view(encodeWav(new Float32Array(4), SPEECH_SAMPLE_RATE))
    expect(data.getUint16(20, true)).toBe(1) // PCM
    expect(data.getUint16(22, true)).toBe(1) // 單聲道
    expect(data.getUint32(24, true)).toBe(SPEECH_SAMPLE_RATE)
    expect(data.getUint16(34, true)).toBe(16) // 位元深度
  })

  it('長度欄位和實際的資料量對得起來', async () => {
    // 這兩個數字錯了的話，播放器會把檔案讀到一半就停，
    // 而辨識服務收到的是一段被截斷的語音
    const samples = new Float32Array(100)
    const blob = encodeWav(samples, SPEECH_SAMPLE_RATE)
    const data = await view(blob)

    expect(blob.size).toBe(44 + 200)
    expect(data.getUint32(4, true)).toBe(36 + 200) // RIFF chunk
    expect(data.getUint32(40, true)).toBe(200) // data chunk
  })

  it('每秒位元組數 = 取樣率 × 2', async () => {
    const data = await view(encodeWav(new Float32Array(2), SPEECH_SAMPLE_RATE))
    expect(data.getUint32(28, true)).toBe(SPEECH_SAMPLE_RATE * 2)
    expect(data.getUint16(32, true)).toBe(2)
  })

  it('把 -1～1 的樣本轉成 16 位元整數', async () => {
    const data = await view(encodeWav(new Float32Array([0, 1, -1, 0.5]), SPEECH_SAMPLE_RATE))
    expect(data.getInt16(44, true)).toBe(0)
    expect(data.getInt16(46, true)).toBe(0x7fff)
    expect(data.getInt16(48, true)).toBe(-0x8000)
    // `setInt16` 是無條件捨去，所以是 16383 而不是 16384 ——
    // 差一個最低有效位，對語音辨識沒有任何影響
    expect(data.getInt16(50, true)).toBe(16383)
  })

  it('超出範圍的樣本被夾住，不會繞回去', async () => {
    // 不夾的話，2.0 會繞成一個負數 —— 聽起來是一陣爆音，
    // 而辨識服務會把那一段當成雜訊
    const data = await view(encodeWav(new Float32Array([2, -2]), SPEECH_SAMPLE_RATE))
    expect(data.getInt16(44, true)).toBe(0x7fff)
    expect(data.getInt16(46, true)).toBe(-0x8000)
  })

  it('空的樣本也產得出一個合法的檔案', async () => {
    const blob = encodeWav(new Float32Array(0), SPEECH_SAMPLE_RATE)
    expect(blob.size).toBe(44)
    expect(blob.type).toBe('audio/wav')
  })
})

describe('mixToMono', () => {
  it('單聲道原樣返回', () => {
    const channel = new Float32Array([0.1, 0.2])
    expect(mixToMono([channel])).toBe(channel)
  })

  it('多聲道取平均，不是只拿第一軌', () => {
    // 外接麥克風可能把人聲放在右聲道，只拿左邊會得到一段幾乎無聲的檔案
    const mixed = mixToMono([new Float32Array([0, 0]), new Float32Array([1, 0.5])])
    expect([...mixed]).toEqual([0.5, 0.25])
  })

  it('沒有聲道時回空陣列（而不是爆掉）', () => {
    expect(mixToMono([])).toHaveLength(0)
  })
})
