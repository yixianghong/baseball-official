/**
 * 把 `MediaRecorder` 錄下來的東西轉成 16kHz 單聲道的 WAV。
 *
 * ## 為什麼要轉，不直接把錄到的檔案送上去
 * `MediaRecorder` 在不同瀏覽器吐出不同的容器：Chrome／Android 是
 * `audio/webm;codecs=opus`，iOS Safari 是 `audio/mp4`（AAC）。而 Gemini
 * 文件列的音訊格式只有 wav／mp3／aiff／aac／ogg／flac —— **那兩種都不在
 * 清單上**。
 *
 * 實測過 `audio/mp4` 其實收得下（見 `audioMimeSchema` 的說明），但
 * `audio/webm` 到現在都沒有實測過，而 Android 的 Chrome 只錄得出它。
 * 與其讓「能不能用」取決於使用者拿的是哪支手機，不如**一律轉成同一種
 * 確定可以的格式**：一條路比兩條路好，也少掉一整類「只在某個瀏覽器
 * 才發生」的 bug。
 *
 * ## 為什麼是 16kHz 單聲道
 * 語音辨識用不到更高的取樣率（電話是 8kHz），而檔案大小直接決定了在
 * 球場的行動網路上傳得上去沒有。五秒的語音約 160KB，base64 之後約 210KB
 * —— 遠低於 `maxUploadBytes` 的 8MB。
 *
 * ## 為什麼編碼器是一個純函式
 * `encodeWav()` 只吃一個 `Float32Array` 跟取樣率，所以整段轉檔邏輯測得到
 * （`tests/unit/wav.test.ts`），不需要真的錄音。有狀態的那一半
 * （`AudioContext`、`decodeAudioData`）留在 `blobToWav()` 裡。
 */

/** 送去辨識用的取樣率。語音辨識用不到更高的。 */
export const SPEECH_SAMPLE_RATE = 16_000

/**
 * 把單聲道的 PCM 樣本編成一個 WAV 檔。
 *
 * WAV 的 header 是固定的 44 個位元組，自己寫比引入一個套件划算得多 ——
 * 而且它是純計算，完全測得到。
 */
export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)

  const writeText = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }

  writeText(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  writeText(8, 'WAVE')
  writeText(12, 'fmt ')
  view.setUint32(16, 16, true) // fmt chunk 長度
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // 單聲道
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // 每秒位元組數
  view.setUint16(32, 2, true) // 每個取樣點的位元組數
  view.setUint16(34, 16, true) // 位元深度
  writeText(36, 'data')
  view.setUint32(40, samples.length * 2, true)

  for (let i = 0; i < samples.length; i++) {
    // 夾在 [-1, 1] 再轉成 16 位元有號整數。不夾的話，超出範圍的樣本
    // 會在轉換時繞回去，聽起來是一陣爆音
    const clamped = Math.max(-1, Math.min(1, samples[i]!))
    view.setInt16(44 + i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true)
  }

  return new Blob([buffer], { type: 'audio/wav' })
}

/**
 * 把多聲道的音訊混成單聲道。
 *
 * 取平均而不是只拿第一軌：手機收音多半是單聲道沒錯，但外接麥克風可能
 * 把人聲放在右聲道，只拿左邊就會得到一段幾乎無聲的檔案。
 */
export function mixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0)
  if (channels.length === 1) return channels[0]!

  const length = channels[0]!.length
  const mixed = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    let sum = 0
    for (const channel of channels) sum += channel[i] ?? 0
    mixed[i] = sum / channels.length
  }
  return mixed
}

/**
 * 錄好的聲音 → 16kHz 單聲道 WAV。
 *
 * 用 `OfflineAudioContext` 重新取樣：它不會發出聲音，所以不需要使用者手勢
 * （iOS 對會發聲的 `AudioContext` 有這個限制，而這裡只是在算數）。
 *
 * 解碼不出來時**丟出例外而不是回傳原檔**，由呼叫端決定要不要退回送原始
 * 格式 —— 在這裡默默換一種行為的話，外面就不知道送出去的到底是什麼。
 */
export async function blobToWav(blob: Blob): Promise<Blob> {
  const AudioContextClass =
    window.OfflineAudioContext ??
    (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
      .webkitOfflineAudioContext
  if (!AudioContextClass) throw new Error('這個瀏覽器不支援音訊轉檔')

  const bytes = await blob.arrayBuffer()

  // 先用一個臨時的 context 解碼（`decodeAudioData` 需要一個 context，
  // 但長度要解碼完才知道，所以不能一開始就開目標長度的那一個）
  const decodeContext = new AudioContextClass(1, 1, SPEECH_SAMPLE_RATE)
  const decoded = await decodeContext.decodeAudioData(bytes)

  const frames = Math.max(1, Math.ceil(decoded.duration * SPEECH_SAMPLE_RATE))
  const context = new AudioContextClass(1, frames, SPEECH_SAMPLE_RATE)
  const source = context.createBufferSource()
  source.buffer = decoded
  source.connect(context.destination)
  source.start()

  const rendered = await context.startRendering()
  return encodeWav(rendered.getChannelData(0), SPEECH_SAMPLE_RATE)
}

/** `Blob` → 不含 `data:` 前綴的純 base64（`imagePayloadSchema` 同一個約定）。 */
export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  // 分批轉換：一次把幾十萬個引數展開給 `String.fromCharCode` 會爆堆疊
  const CHUNK = 8192
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}
