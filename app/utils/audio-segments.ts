/**
 * 從一段長錄音裡挑出「有人在說話」的片段。
 *
 * ## 為什麼需要它
 * 隨身錄音筆錄的是整個半局（十幾分鐘），但**真正有用的只有登錄者唸出來的
 * 那幾句**（「24 號三壘安打」）—— 一個六個打席的半局大概只有半分鐘的語音，
 * 其餘都是空檔。整段送出去有三個問題，而這一步同時解掉：
 *
 * 1. **送不上去。** 16kHz 單聲道 WAV 每秒 32KB，十五分鐘是 28MB，
 *    base64 之後 38MB —— `maxUploadBytes` 只有 8MB。
 * 2. **貴。** Gemini 的音訊是每秒 32 個 token，十五分鐘就是 28,800 個。
 * 3. **要切段，而切在句子中間會把一個打席切成兩半**（或變成兩筆）。
 *    在靜音處切就不會。
 *
 * ## 判斷方式
 * 逐 20 毫秒算 RMS，門檻取**這段錄音自己的噪音底**（低百分位）再乘一個倍率
 * —— 球場的環境音每一場都不一樣，寫死一個絕對值在安靜的球場太鬆、
 * 在吵的球場全部當成語音。
 *
 * ⚠️ **判斷錯的方向是刻意的：寧可多收一點。** 門檻訂太高會把句首的字吃掉
 * （「24 號」變成「號」），而那是**聽不出來的錯**；多收幾秒安靜的音訊只是
 * 多花 0.0001 美元。所以每一段前後都往外補一點，而且相鄰的段落間隔很短時
 * 直接併起來（同一句話中間本來就有停頓）。
 *
 * ⚠️ 環境音大到整段都超過門檻時，結果會是「一整段」—— 那就退化成固定長度
 * 切段，不會壞掉，只是省不到。
 */

export interface Segment {
  /** 樣本索引，含。 */
  start: number
  /** 樣本索引，不含。 */
  end: number
}

export interface SegmentOptions {
  /** 每一格的長度（毫秒）。 */
  frameMs?: number
  /** 噪音底乘這個倍率就是門檻。 */
  threshold?: number
  /** 間隔小於這個就併成同一段（同一句話中間的停頓）。 */
  mergeGapMs?: number
  /** 每一段前後各往外補這麼多，避免吃掉句首句尾。 */
  padMs?: number
  /** 比這個短的段落丟掉（咳嗽、碰撞聲）。 */
  minSegmentMs?: number
}

const DEFAULTS = {
  frameMs: 20,
  threshold: 2.5,
  mergeGapMs: 600,
  padMs: 250,
  minSegmentMs: 300,
} satisfies Required<SegmentOptions>

/**
 * 噪音底：把每一格的音量排序後取低百分位。
 *
 * 用百分位而不是最小值 —— 最小值可能剛好是一格全靜音，拿它當底會讓門檻
 * 低到整段都算語音。取 20% 的位置代表「這段錄音安靜的時候大概多大聲」。
 */
function noiseFloor(levels: number[]): number {
  if (levels.length === 0) return 0
  const sorted = [...levels].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length * 0.2)] ?? 0
}

export function findSpeechSegments(
  samples: Float32Array,
  sampleRate: number,
  options: SegmentOptions = {},
): Segment[] {
  const { frameMs, threshold, mergeGapMs, padMs, minSegmentMs } = { ...DEFAULTS, ...options }

  const frame = Math.max(1, Math.round((sampleRate * frameMs) / 1000))
  if (samples.length === 0) return []

  const levels: number[] = []
  for (let start = 0; start < samples.length; start += frame) {
    let sum = 0
    const end = Math.min(start + frame, samples.length)
    for (let i = start; i < end; i++) sum += samples[i]! * samples[i]!
    levels.push(Math.sqrt(sum / (end - start)))
  }

  /** 絕對下限：低於它一律是靜音，不管噪音底算出什麼。 */
  const limitFloor = 0.005
  /*
   * 絕對下限不能省：整段都是數位靜音（噪音底 0）時，`0 * 2.5` 還是 0，
   * 於是連真正的靜音都會被當成語音，整個挑段等於沒做。
   */
  const limit = Math.max(noiseFloor(levels) * threshold, limitFloor)

  /*
   * ⚠️ **門檻已經高過整段的最大音量 → 底估錯了，整段都當成語音。**
   *
   * 噪音底是這段錄音自己的低百分位，所以**音量從頭到尾都差不多**時
   * （環境音很大、或整段都在講話），那個底本身就是語音的音量 —— 門檻被抬到
   * 沒有東西過得了，結果是**整段被丟掉而且沒有任何警告**，使用者只看到
   * 「辨識不出東西」，完全不知道是這裡判斷錯了。退回「整段都送」只是省不到
   * 頻寬與 token，不會壞掉。
   *
   * ⚠️ 判斷用「門檻 ≥ 最大音量」而不是「一段都沒挑到」—— 後者會把**真的
   * 沒人講話**的錄音也退回整段送，而那時候送上去的是十五分鐘的環境音。
   *
   * ⚠️ 用迴圈而不是 `Math.max(...levels)`：兩小時的錄音有三十幾萬格，
   * 展開成參數會直接爆掉呼叫堆疊。
   */
  let peak = 0
  for (const level of levels) if (level > peak) peak = level
  if (peak > limitFloor && limit >= peak) return [{ start: 0, end: samples.length }]

  const merge = Math.round((mergeGapMs / frameMs) | 0)
  const raw: Segment[] = []
  let open: Segment | null = null
  let quiet = 0

  levels.forEach((level, index) => {
    if (level >= limit) {
      quiet = 0
      if (open) open.end = index + 1
      else open = { start: index, end: index + 1 }
      return
    }

    quiet += 1
    // 停頓還不夠長就當成同一句話的中間，繼續開著
    if (open && quiet > merge) {
      raw.push(open)
      open = null
    }
  })
  if (open) raw.push(open)

  const pad = Math.round(padMs / frameMs)
  const minFrames = Math.round(minSegmentMs / frameMs)

  const segments = raw
    .filter((segment) => segment.end - segment.start >= minFrames)
    .map((segment) => ({
      start: Math.max(0, (segment.start - pad) * frame),
      end: Math.min(samples.length, (segment.end + pad) * frame),
    }))

  return segments
}

/**
 * 把挑出來的片段分組，每一組不超過 `maxSeconds` 的語音。
 *
 * 一組會送一次辨識，所以這個數字同時決定了**上傳大小**（16kHz 單聲道 WAV
 * 每秒 32KB，base64 之後 ×1.33）與**每次的音訊 token**（每秒 32 個）。
 *
 * ⚠️ 單一片段本身就超過上限時，**照樣讓它自成一組而不是切開** ——
 * 切開就是切在句子中間，那正是這整個模組在避免的事。那種片段多半代表
 * 「環境音大到整段都算語音」，而那時切在哪裡都一樣差。
 */
export function groupIntoChunks(
  segments: Segment[],
  sampleRate: number,
  maxSeconds: number,
): Segment[][] {
  const budget = Math.max(1, Math.round(maxSeconds * sampleRate))
  const chunks: Segment[][] = []
  let current: Segment[] = []
  let used = 0

  for (const segment of segments) {
    const length = segment.end - segment.start
    if (current.length && used + length > budget) {
      chunks.push(current)
      current = []
      used = 0
    }
    current.push(segment)
    used += length
  }
  if (current.length) chunks.push(current)

  return chunks
}

/** 把一組片段接成一段連續的聲音。中間的空檔就這樣消失，那正是重點。 */
export function joinSegments(samples: Float32Array, segments: Segment[]): Float32Array {
  const total = segments.reduce((sum, segment) => sum + (segment.end - segment.start), 0)
  const out = new Float32Array(total)

  let offset = 0
  for (const segment of segments) {
    out.set(samples.subarray(segment.start, segment.end), offset)
    offset += segment.end - segment.start
  }
  return out
}

/**
 * 把好幾段聲音接成一段。
 *
 * 多個錄音檔時用得到：每個檔案各自挑出語音之後，接成一條連續的音軌，
 * 分組與編碼就不必知道「原本來自哪個檔案」。
 */
export function concatSamples(parts: Float32Array[]): Float32Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Float32Array(total)

  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

/** 這些片段加起來有多少秒。畫面上要寫出「十五分鐘裡有 38 秒在說話」。 */
export function segmentsSeconds(segments: Segment[], sampleRate: number): number {
  const frames = segments.reduce((sum, segment) => sum + (segment.end - segment.start), 0)
  return frames / sampleRate
}
