import type { ParsePlaysRequest, ParsePlaysResponse } from '#shared/schemas/ai'
import { blobToBase64, blobToSamples, blobToWav, encodeWav, SPEECH_SAMPLE_RATE } from '~/utils/wav'
import {
  concatSamples,
  findSpeechSegments,
  groupIntoChunks,
  joinSegments,
  segmentsSeconds,
  type Segment,
} from '~/utils/audio-segments'
import { sortByCapture } from '~/utils/clip-import'

/**
 * 按「開始錄音」→ 說話 → 按「停止並辨識」→ 辨識出幾個打席。
 *
 * ## 為什麼不是按住說話
 * 原本要按住麥克風鈕、放開才辨識。比賽中沒有那麼多時間按著一顆按鈕 ——
 * 場邊的人一邊看球一邊登錄，手上還有別的事，而按住的那幾秒裡他不能做
 * 任何其他動作。兩段式的代價是「忘了按停止」變成可能發生的事，所以有
 * `MAX_RECORDING_MS`（見下方）。
 *
 * ## ⚠️ 麥克風會和錄影頁搶
 * `useGameRecorder` 的兩處 `getUserMedia` 都帶 `audio: true`，所以
 * **同一台裝置不要同時開錄影頁和逐局紀錄頁**。實務上不會撞到：錄影那台
 * 架在腳架上對著球場，登錄的是另一台。但真的撞到時要講得出原因 ——
 * `getUserMedia` 的錯誤訊息完全不會提到這件事，看起來只像「麥克風壞了」。
 *
 * ## 為什麼不用瀏覽器內建的 SpeechRecognition
 * **iOS 加到主畫面的 PWA 沒有它**：API 偵測得到，但 `onresult` 永遠不會
 * 觸發（WebKit #225298，RESOLVED/LATER）。而這個球隊的登錄裝置正是
 * iPhone 的主畫面 App。走 Gemini 還多拿到一件事：一次可以連著講三四個
 * 打席，模型自己斷句。
 */

/** mp4 排在 webm 前面：和錄影用的 `MIME_CANDIDATES` 同一個順序與理由。 */
const MIME_CANDIDATES = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm']

/**
 * 錄音上限。到了就**自動停下來並送辨識**，不是丟掉。
 *
 * ⚠️ 這是「開始／停止」才需要的東西。按住說話的版本結構上不可能錄太久 ——
 * 手指放開就停了。改成兩段式之後「忘了按停止」變成很可能發生的事，而代價
 * 不是錄得比較長，是**整段都送不上去**：16kHz 單聲道 WAV 每秒 32KB、
 * base64 之後約 42KB，`maxUploadBytes`（8MB）在三分半左右就滿，而那時候
 * 使用者已經講完一整局了，會拿到一個「辨識失敗」而不知道原因。自動停下來
 * 至少講過的東西還在。
 *
 * 90 秒遠多於實際需要（一次講三四個打席約 5～9 秒），只是為了擋住忘記。
 */
export const MAX_RECORDING_MS = 90_000

/** 計時器的間隔。只用來顯示秒數與判斷上限，不需要更細。 */
const TICK_MS = 250

export type VoiceStatus = 'idle' | 'recording' | 'parsing'

export function useVoicePlayInput() {
  const { parsePlays } = useAiActions()

  const status = ref<VoiceStatus>('idle')
  const error = ref('')
  /** 辨識出來、還沒被採用的打席。使用者確認過才寫進半局。 */
  const suggestions = ref<ParsePlaysResponse['plays']>([])
  const transcript = ref('')
  const warnings = ref<string[]>([])

  /** 已經錄了多久（毫秒）。按住說話時不需要，兩段式一定要看得到。 */
  const elapsedMs = ref(0)

  let recorder: MediaRecorder | null = null
  let stream: MediaStream | null = null
  let chunks: Blob[] = []
  let ticker: ReturnType<typeof setInterval> | null = null

  function stopTicker(): void {
    if (ticker !== null) clearInterval(ticker)
    ticker = null
  }

  /** 這個瀏覽器錄得出東西嗎。錄不出來就不要顯示那顆麥克風鈕。 */
  const supported = computed(
    () =>
      import.meta.client &&
      typeof MediaRecorder !== 'undefined' &&
      Boolean(navigator.mediaDevices?.getUserMedia),
  )

  function pickMimeType(): string | undefined {
    return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type))
  }

  function release(): void {
    stopTicker()
    stream?.getTracks().forEach((track) => track.stop())
    stream = null
    recorder = null
  }

  /**
   * 開始錄音。
   *
   * `onLimit` 在錄到 `MAX_RECORDING_MS` 時被呼叫，由呼叫端接著呼叫
   * `stop()` —— 辨識需要的 context（第幾局、哪半局、名單）只有它拿得到。
   */
  async function start(onLimit?: () => void): Promise<void> {
    if (status.value !== 'idle') return
    error.value = ''
    suggestions.value = []
    warnings.value = []
    chunks = []
    elapsedMs.value = 0

    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (err) {
      // ⚠️ 這一句要講得出「可能是錄影頁佔著」——`getUserMedia` 自己不會說
      error.value =
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? '拿不到麥克風。請確認瀏覽器的麥克風權限，以及這台裝置沒有同時開著錄影頁。'
          : '拿不到麥克風，請改用按鈕登錄。'
      return
    }

    const mimeType = pickMimeType()
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data)
    }
    recorder.start()
    status.value = 'recording'

    const startedAt = Date.now()
    ticker = setInterval(() => {
      elapsedMs.value = Date.now() - startedAt
      if (elapsedMs.value >= MAX_RECORDING_MS) {
        // 先收掉計時器，否則 stop() 轉檔的那幾百毫秒裡會再觸發一次
        stopTicker()
        onLimit?.()
      }
    }, TICK_MS)
  }

  /**
   * 按下「停止並辨識」：停止錄音、轉檔、送辨識。
   *
   * ⚠️ 一定要等 `onstop` 才組 Blob —— 最後一塊資料是在 `stop()` 回來
   * **之後**才透過 `ondataavailable` 送到的（和錄影是同一個坑）。
   */
  async function stop(context: {
    inning: number
    half: ParsePlaysRequest['half']
    batting: ParsePlaysRequest['batting']
    roster: ParsePlaysRequest['roster']
    existing: ParsePlaysRequest['existing']
  }): Promise<void> {
    if (status.value !== 'recording' || !recorder) return
    stopTicker()

    const active = recorder
    const recordedType = active.mimeType || 'audio/webm'
    await new Promise<void>((resolve) => {
      active.onstop = () => resolve()
      active.stop()
    })
    release()

    const recorded = new Blob(chunks, { type: recordedType })
    chunks = []

    if (recorded.size === 0) {
      status.value = 'idle'
      error.value = '沒有錄到聲音，請再試一次。'
      return
    }

    status.value = 'parsing'
    try {
      // 先轉成 16kHz 單聲道 WAV；轉不成功才退回送原始格式
      // （`audio/mp4` 實測收得下，`audio/webm` 沒驗過 —— 見 `app/utils/wav.ts`）
      let payload: Blob = recorded
      let mimeType: ParsePlaysRequest['mimeType'] = 'audio/wav'
      try {
        payload = await blobToWav(recorded)
      } catch {
        mimeType = recordedType.startsWith('audio/mp4') ? 'audio/mp4' : 'audio/webm'
      }

      const result = await parsePlays({
        audioBase64: await blobToBase64(payload),
        mimeType,
        ...context,
      })

      suggestions.value = result.plays
      transcript.value = result.transcript
      warnings.value = result.warnings
      if (result.plays.length === 0 && result.warnings.length === 0) {
        error.value = '沒有聽出任何打席，請再說一次。'
      }
    } catch {
      error.value = '辨識失敗，請再試一次，或直接用按鈕登錄。'
    } finally {
      status.value = 'idle'
    }
  }

  /* ── 上傳錄音檔（隨身錄音筆錄的整個半局）──────────────────── */

  /**
   * 一次送多少秒的語音。
   *
   * 16kHz 單聲道 WAV 每秒 32KB，base64 之後 ×1.33 —— 90 秒約 3.8MB，
   * 在 `maxUploadBytes`（8MB）之內還留了一倍的餘裕。
   */
  const CHUNK_SECONDS = 90

  /**
   * 最多送幾段。
   *
   * 挑段之後還有這麼多語音，代表不是「一個半局的登錄」而是別的東西
   * （整場的檔案、或整段都是環境音）。擋住的不是正確性而是帳單與等待時間 ——
   * 20 段大約 30 分鐘的語音、兩三分鐘的等待。
   */
  const MAX_CHUNKS = 20

  /** 解析到第幾段／共幾段。畫面上一定要看得到，這會跑好幾十秒。 */
  const progress = ref({ done: 0, total: 0 })
  /** 這個檔案裡有多少秒真的在說話。和檔案長度一起寫出來，人才知道挑對了沒。 */
  const speechSeconds = ref(0)

  /**
   * 解析錄音檔。**一個檔案或好幾個都可以。**
   *
   * ## 為什麼一支函式就吃得下兩種錄法
   * 錄法沒有規定：可以一個半局錄一個檔（隨身錄音筆開著不關），也可以一個
   * 打席錄一段（每次下場按一下），或者混著來。挑段之後本來就是「一串話接起來
   * 分組」，**多個檔案只是多幾個來源** —— 全部接成一條音軌，後面的分組、
   * 編碼、送辨識完全不必知道原本來自哪裡。
   *
   * 順帶的好處是**小檔案不會變成很多次呼叫**：四個三秒的片段加起來才十二秒，
   * 還是一次就送完。一個檔案一次呼叫的做法會貴四倍，而且模型看不到前後文。
   *
   * ⚠️ **順序要照錄的時間排，不是照使用者挑的順序。** 打席天生有先後，
   * 排錯的話出局數與棒次就跟著錯。用的是影片匯入那一支
   * （`sortByCapture()`）—— 同一個問題：檔名規則各家錄音筆不同，
   * 「先錄的排前面」才是每一台都成立的。
   *
   * ## 為什麼不是整段送上去
   * 隨身錄音筆錄的是整個半局（十幾分鐘），而真正有用的只有登錄者唸出來的
   * 那幾句。整段送有三個問題：超過上傳上限、音訊 token 貴、以及**切段時
   * 會切在句子中間**。所以先挑出有說話的片段（`findSpeechSegments()`），
   * 接起來、分組，每組送一次 —— 切點一律落在靜音處。
   *
   * ## ⚠️ 後面幾段要知道前面認出了什麼
   * 每一組是獨立的一次呼叫，模型看不到前一組。所以把**已經登錄的打席
   * 加上前面幾組認出來的**一起當成 `existing` 送下去 —— 它靠這個知道
   * 現在幾出局、輪到誰，少了它後面幾段的判斷會從頭開始。
   */
  async function parseFiles(
    files: File[],
    context: {
      inning: number
      half: ParsePlaysRequest['half']
      batting: ParsePlaysRequest['batting']
      roster: ParsePlaysRequest['roster']
      existing: ParsePlaysRequest['existing']
    },
  ): Promise<void> {
    clear()
    status.value = 'parsing'
    progress.value = { done: 0, total: 0 }
    speechSeconds.value = 0

    try {
      /*
       * 每個檔案各自挑出語音，再接成一條連續的音軌。
       * `utterances` 記的是每一句話在那條音軌上的位置 —— 分組要切在句子
       * 之間，所以不能只留下一個長陣列。
       */
      const parts: Float32Array[] = []
      const utterances: Segment[] = []
      let offset = 0

      for (const file of sortByCapture(files)) {
        const samples = await blobToSamples(file)
        for (const segment of findSpeechSegments(samples, SPEECH_SAMPLE_RATE)) {
          const length = segment.end - segment.start
          parts.push(samples.subarray(segment.start, segment.end))
          utterances.push({ start: offset, end: offset + length })
          offset += length
        }
      }

      if (utterances.length === 0) {
        error.value =
          files.length > 1 ? '這些檔案裡沒有聽到說話的聲音。' : '這個檔案裡沒有聽到說話的聲音。'
        return
      }

      const speech = concatSamples(parts)
      speechSeconds.value = segmentsSeconds(utterances, SPEECH_SAMPLE_RATE)
      const chunks = groupIntoChunks(utterances, SPEECH_SAMPLE_RATE, CHUNK_SECONDS)

      if (chunks.length > MAX_CHUNKS) {
        error.value = `挑進來的錄音裡有 ${Math.round(speechSeconds.value / 60)} 分鐘的語音，太長了。請一次處理一個半局。`
        return
      }

      progress.value = { done: 0, total: chunks.length }

      const collected: ParsePlaysResponse['plays'] = []
      const notes: string[] = []
      const transcripts: string[] = []

      for (const chunk of chunks) {
        const wav = encodeWav(joinSegments(speech, chunk), SPEECH_SAMPLE_RATE)
        const result = await parsePlays({
          audioBase64: await blobToBase64(wav),
          mimeType: 'audio/wav',
          ...context,
          // 前面幾組認出來的也算「已經有的」，模型才接得上出局數與棒次
          existing: [
            ...context.existing,
            ...collected.map((play) => ({
              number: play.batter.number ?? '',
              result: play.result ?? '',
            })),
          ],
        })

        collected.push(...result.plays)
        notes.push(...result.warnings)
        if (result.transcript) transcripts.push(result.transcript)
        progress.value = { done: progress.value.done + 1, total: chunks.length }
      }

      suggestions.value = collected
      transcript.value = transcripts.join('\n')
      warnings.value = notes
      if (collected.length === 0 && notes.length === 0) {
        error.value = '沒有聽出任何打席，請確認錄音裡有唸出背號與結果。'
      }
    } catch {
      error.value = '檔案讀不出來，請確認是錄音檔（mp3、m4a、wav 都可以）。'
    } finally {
      status.value = 'idle'
    }
  }

  function clear(): void {
    suggestions.value = []
    transcript.value = ''
    warnings.value = []
    error.value = ''
  }

  /** 元件被卸載時一定要放掉麥克風 —— 否則手機上的錄音指示燈會一直亮著。 */
  onBeforeUnmount(release)

  return {
    status,
    error,
    suggestions,
    transcript,
    warnings,
    supported,
    elapsedMs,
    progress,
    speechSeconds,
    start,
    stop,
    parseFiles,
    clear,
  }
}
