import type { ParsePlaysRequest, ParsePlaysResponse } from '#shared/schemas/ai'
import { blobToBase64, blobToWav } from '~/utils/wav'

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
    start,
    stop,
    clear,
  }
}
