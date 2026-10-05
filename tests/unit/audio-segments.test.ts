import { describe, expect, it } from 'vitest'
import {
  concatSamples,
  findSpeechSegments,
  groupIntoChunks,
  joinSegments,
  segmentsSeconds,
} from '../../app/utils/audio-segments'

/**
 * 從長錄音裡挑出有人在說話的片段。
 *
 * 這是「隨身錄音筆錄一整個半局」能不能用的關鍵一步 —— 整段送出去會
 * 超過上傳上限、而且貴得沒道理。判斷錯的方向**刻意偏向多收**：
 * 門檻太高會吃掉句首的字（「24 號」變成「號」），而那是聽不出來的錯。
 */

const RATE = 16_000

/** 造一段音訊：`spans` 是「第幾秒到第幾秒有聲音」。 */
function audio(seconds: number, spans: Array<[number, number]>, noise = 0.001): Float32Array {
  const samples = new Float32Array(Math.round(seconds * RATE))
  // 底噪：固定值就夠，這裡要測的是門檻而不是隨機性
  samples.fill(noise)

  for (const [from, to] of spans) {
    for (let i = Math.round(from * RATE); i < Math.round(to * RATE); i++) {
      // 交替正負，RMS 才等於振幅（全部填同一個值也可以，但這樣更像聲音）
      samples[i] = i % 2 === 0 ? 0.3 : -0.3
    }
  }
  return samples
}

describe('findSpeechSegments', () => {
  it('只挑出有聲音的那幾段', () => {
    const segments = findSpeechSegments(
      audio(20, [
        [5, 6],
        [12, 13],
      ]),
      RATE,
    )

    expect(segments).toHaveLength(2)
    expect(segments[0]!.start / RATE).toBeCloseTo(4.75, 1)
    expect(segments[0]!.end / RATE).toBeCloseTo(6.25, 1)
  })

  it('⚠️ 前後各往外補一點 —— 門檻訂太緊會吃掉句首的字', () => {
    const [segment] = findSpeechSegments(audio(10, [[4, 5]]), RATE)

    // 聲音是 4.0～5.0，挑出來的範圍要比它寬
    expect(segment!.start / RATE).toBeLessThan(4)
    expect(segment!.end / RATE).toBeGreaterThan(5)
  })

  it('⚠️ 很短的停頓要併起來 —— 同一句話中間本來就會停', () => {
    // 「24 號」「三壘安打」中間停 0.3 秒
    const segments = findSpeechSegments(
      audio(10, [
        [3, 3.6],
        [3.9, 4.6],
      ]),
      RATE,
    )

    expect(segments).toHaveLength(1)
  })

  it('很長的停頓要分開（兩個打席之間）', () => {
    const segments = findSpeechSegments(
      audio(30, [
        [3, 4],
        [20, 21],
      ]),
      RATE,
    )

    expect(segments).toHaveLength(2)
  })

  it('太短的雜音丟掉（碰撞聲、咳嗽）', () => {
    const segments = findSpeechSegments(audio(10, [[5, 5.1]]), RATE)

    expect(segments).toHaveLength(0)
  })

  it('完全沒有聲音時回空陣列', () => {
    expect(findSpeechSegments(audio(10, []), RATE)).toEqual([])
    expect(findSpeechSegments(new Float32Array(0), RATE)).toEqual([])
  })

  it('⚠️ 整段都是數位靜音時也不能全部當成語音', () => {
    // 噪音底是 0，`0 × 倍率` 還是 0 —— 少了絕對下限，整個挑段等於沒做
    expect(findSpeechSegments(new Float32Array(RATE * 5), RATE)).toEqual([])
  })

  /**
   * ⚠️ 噪音底是這段錄音自己的低百分位，所以音量從頭到尾都差不多時，
   * 那個底**本身就是語音的音量** —— 門檻被抬到沒有東西過得了，
   * 一段都挑不到。那是最糟的失敗方式：整段被丟掉而且沒有警告。
   */
  it('音量從頭到尾一樣大時，退化成整段都送而不是一段都不送', () => {
    const loud = audio(10, [[0, 10]])
    const segments = findSpeechSegments(loud, RATE)

    expect(segments).toHaveLength(1)
    expect(segmentsSeconds(segments, RATE)).toBeCloseTo(10, 0)
  })
})

describe('groupIntoChunks', () => {
  const seg = (fromSec: number, toSec: number) => ({
    start: fromSec * RATE,
    end: toSec * RATE,
  })

  it('裝得下就裝在同一組', () => {
    const chunks = groupIntoChunks([seg(0, 10), seg(20, 30)], RATE, 90)

    expect(chunks).toHaveLength(1)
  })

  it('超過上限就換一組', () => {
    const chunks = groupIntoChunks([seg(0, 60), seg(100, 160)], RATE, 90)

    expect(chunks).toHaveLength(2)
  })

  it('⚠️ 單一片段比上限還長時讓它自成一組，不切開', () => {
    // 切開就是切在句子中間，那正是整個模組在避免的事
    const chunks = groupIntoChunks([seg(0, 200)], RATE, 90)

    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toHaveLength(1)
  })

  it('沒有片段就沒有組', () => {
    expect(groupIntoChunks([], RATE, 90)).toEqual([])
  })
})

describe('joinSegments', () => {
  it('把片段接起來，中間的空檔消失', () => {
    const samples = Float32Array.from([0, 1, 2, 3, 4, 5, 6, 7])
    const joined = joinSegments(samples, [
      { start: 1, end: 3 },
      { start: 6, end: 8 },
    ])

    expect([...joined]).toEqual([1, 2, 6, 7])
  })
})

describe('segmentsSeconds', () => {
  it('加總長度，不算中間的空檔', () => {
    const seconds = segmentsSeconds(
      [
        { start: 0, end: RATE },
        { start: RATE * 100, end: RATE * 102 },
      ],
      RATE,
    )

    expect(seconds).toBe(3)
  })
})

describe('concatSamples', () => {
  it('接起來，順序照傳進來的', () => {
    const joined = concatSamples([Float32Array.from([1, 2]), Float32Array.from([3])])

    expect([...joined]).toEqual([1, 2, 3])
  })

  it('沒有東西就是空的', () => {
    expect(concatSamples([])).toHaveLength(0)
  })
})
