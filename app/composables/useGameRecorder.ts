import { defaultCameraId, pickMimeType, sortCameras, type CameraOption } from '~/utils/recording'

/**
 * 用手機瀏覽器分段錄影（見 `docs/game-recording-plan.md`）。
 *
 * ## 為什麼是分段，而不是一次錄完整場
 * 手機瀏覽器的分頁一進背景，`MediaRecorder` 就會停。分段代表最壞情況
 * 只損失一局，而不是整場 —— 乙組七局、一場約兩小時，每局 12～15 分鐘，
 * 切點天然對齊。這也是為什麼這裡沒有「暫停」：暫停等於鼓勵使用者
 * 在錄影中途去做別的事，而那正是會讓錄影停掉的動作。
 *
 * ## 判斷邏輯都不在這裡
 * 挑容器、排鏡頭、組檔名全部在 `app/utils/recording.ts`，那些是純函式、
 * 測得到。這個檔案只負責「有狀態」的部分：權限、串流、計時、Wake Lock。
 *
 * ## 錄好的 Blob 不留著
 * 一局 1080p 約 170～280 MB，七局就是 1～2 GB。全部掛在記憶體裡等使用者
 * 之後處理，手機會直接被系統殺掉。`stop()` 把 Blob 交給呼叫端，
 * 呼叫端存完就該讓它被回收 —— 這裡刻意不保留任何一份。
 */
export function useGameRecorder() {
  const cameras = ref<CameraOption[]>([])
  const selectedCameraId = ref('')
  const stream = shallowRef<MediaStream | null>(null)
  const recording = ref(false)
  const elapsedSeconds = ref(0)
  const error = ref('')

  /** 這台裝置錄得出來的容器。空字串代表整個功能不能用。 */
  const mimeType = ref('')

  /**
   * 瀏覽器支不支援。
   *
   * 做成 `ref` 而不是在 setup 當下算：SSR 時沒有 `navigator`，
   * 而這個值會決定畫面要顯示錄影介面還是說明文字 —— 兩邊算出不同結果
   * 就是 hydration mismatch。一律先當成不支援，到瀏覽器裡再更新。
   */
  const supported = ref(false)

  /**
   * 正在要求權限或開啟鏡頭。
   *
   * `getUserMedia()` 在使用者回答權限對話框之前會**一直 pending**，沒有逾時 ——
   * 少了這個狀態，那段期間畫面上是一塊全黑的預覽區加上一顆按不動的按鈕，
   * 看起來就像壞了。不能用逾時解決：使用者正在讀對話框是合理的等待。
   */
  const initializing = ref(false)

  let recorder: MediaRecorder | null = null
  let chunks: Blob[] = []
  let timer: ReturnType<typeof setInterval> | null = null
  let wakeLock: WakeLockSentinel | null = null

  /**
   * 要權限、列鏡頭。
   *
   * ⚠️ **順序不能反過來。** 沒有拿到權限之前，`enumerateDevices()` 回傳的
   * `label` 全是空字串 —— 那時分不出哪顆是後鏡頭、哪顆是超廣角，畫面上
   * 只會是「鏡頭 1／鏡頭 2／鏡頭 3」，使用者得一顆一顆試。
   */
  async function init(): Promise<boolean> {
    error.value = ''
    initializing.value = true

    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
        supported.value = false
        error.value = '這個瀏覽器不支援錄影，請改用 Safari 或 Chrome。'
        return false
      }

      mimeType.value = pickMimeType((type) => MediaRecorder.isTypeSupported(type))
      if (!mimeType.value) {
        supported.value = false
        error.value = '這個瀏覽器錄不出可播放的影片格式。'
        return false
      }

      supported.value = true

      // 先要一次權限（用什麼條件都好），label 才會出現
      const probe = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      probe.getTracks().forEach((track) => track.stop())

      cameras.value = sortCameras(await navigator.mediaDevices.enumerateDevices())
      selectedCameraId.value = defaultCameraId(cameras.value)
      return await openCamera(selectedCameraId.value)
    } catch (err) {
      error.value = describeCameraError(err)
      return false
    } finally {
      initializing.value = false
    }
  }

  /**
   * 開啟指定的鏡頭。
   *
   * 解析度用 `ideal` 而不是 `exact`：`exact` 在拿不到 1080p 的鏡頭上會直接
   * 拋 `OverconstrainedError`，結果是「某些鏡頭選了就整個壞掉」。
   * 用 `ideal` 的話拿不到就退一階，至少錄得成。
   */
  async function openCamera(deviceId: string): Promise<boolean> {
    error.value = ''
    initializing.value = true
    closeStream()

    try {
      stream.value = await navigator.mediaDevices.getUserMedia({
        video: {
          ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'environment' }),
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30 },
        },
        audio: true,
      })
      selectedCameraId.value = deviceId
      return true
    } catch (err) {
      error.value = describeCameraError(err)
      return false
    } finally {
      initializing.value = false
    }
  }

  /**
   * 轉動裝置時重新讀一次 track 設定。
   *
   * `getSettings()` **不是響應式的**，而手機轉向時影像的寬高可能會交換 ——
   * 不自己重算的話，畫面上會一直顯示剛開啟鏡頭那一刻的數字。
   */
  const settingsVersion = ref(0)

  const videoSettings = computed(() => {
    void settingsVersion.value
    return stream.value?.getVideoTracks()[0]?.getSettings() ?? null
  })

  /** 目前實際拿到的解析度。挑完鏡頭要讓使用者看到「真的是 1920×1080 嗎」。 */
  const resolution = computed(() => {
    const { width, height } = videoSettings.value ?? {}
    return width && height ? `${width}×${height}` : ''
  })

  /**
   * **錄出來的影像是直的**（寬 < 高）。
   *
   * ⚠️ 這和畫面的方向是兩回事。各家瀏覽器對「裝置轉動時 video track 的寬高
   * 要不要跟著交換」處理並不一致，所以會發生**預覽看起來是橫的、存下來的檔案
   * 卻是 1080×1920** 的情況 —— 而這件事在球場上完全看不出來，回家打開才發現
   * 一整場都是直的。
   *
   * 修不了它（那是瀏覽器的行為），但偵測得到。偵測到就大聲講。
   */
  const portraitVideo = computed(() => {
    const { width, height } = videoSettings.value ?? {}
    return Boolean(width && height && width < height)
  })

  function onOrientationChange() {
    settingsVersion.value += 1
  }

  function start(): boolean {
    if (recording.value || !stream.value || !mimeType.value) return false

    chunks = []
    try {
      recorder = new MediaRecorder(stream.value, { mimeType: mimeType.value })
    } catch (err) {
      error.value = `無法開始錄影：${err instanceof Error ? err.message : '未知的錯誤'}`
      return false
    }

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data)
    }

    /*
     * 每 5 秒切一塊。
     *
     * 不帶 timeslice 的話整段影片只在 `stop()` 時吐出來一塊 —— 錄到一半
     * 分頁被系統回收，那一局就什麼都不剩。分塊之後至少留得住已經錄到的部分。
     */
    recorder.start(5_000)
    recording.value = true
    elapsedSeconds.value = 0
    timer = setInterval(() => (elapsedSeconds.value += 1), 1_000)
    void requestWakeLock()
    return true
  }

  /**
   * 結束這一段，把 Blob 交出去。
   *
   * 一定要等 `onstop` 才能組 Blob：`stop()` 回來的當下，最後一塊資料還沒
   * 透過 `ondataavailable` 送到 —— 提早組的話每一局都會少掉最後幾秒。
   */
  function stop(): Promise<Blob | null> {
    return new Promise((resolve) => {
      const current = recorder
      if (!recording.value || !current) {
        resolve(null)
        return
      }

      current.onstop = () => {
        stopTimer()
        recording.value = false
        recorder = null
        const blob = chunks.length ? new Blob(chunks, { type: mimeType.value }) : null
        chunks = []
        void releaseWakeLock()
        resolve(blob)
      }

      current.stop()
    })
  }

  /**
   * 螢幕不要休眠。
   *
   * 失敗不當成錯誤：Wake Lock 在部分瀏覽器不存在，而錄影本身照樣能跑。
   * 畫面上那句「請勿切換 App 或鎖定螢幕」才是真正的防線。
   */
  async function requestWakeLock() {
    try {
      wakeLock = (await navigator.wakeLock?.request('screen')) ?? null
    } catch {
      wakeLock = null
    }
  }

  async function releaseWakeLock() {
    try {
      await wakeLock?.release()
    } catch {
      // 已經被系統收回了，沒有什麼要處理的
    }
    wakeLock = null
  }

  function stopTimer() {
    if (timer) clearInterval(timer)
    timer = null
  }

  function closeStream() {
    stream.value?.getTracks().forEach((track) => track.stop())
    stream.value = null
  }

  /**
   * 分頁回到前景時把 Wake Lock 要回來 —— 系統會在切走時自動收回它，
   * 而它不會自己回來。
   */
  function onVisibilityChange() {
    if (document.visibilityState === 'visible' && recording.value && !wakeLock) {
      void requestWakeLock()
    }
  }

  onMounted(() => {
    document.addEventListener('visibilitychange', onVisibilityChange)
    // resize 與 orientationchange 都要聽：桌機只有前者，手機兩者的時機不一定同步
    window.addEventListener('resize', onOrientationChange)
    window.addEventListener('orientationchange', onOrientationChange)
  })

  onBeforeUnmount(() => {
    document.removeEventListener('visibilitychange', onVisibilityChange)
    window.removeEventListener('resize', onOrientationChange)
    window.removeEventListener('orientationchange', onOrientationChange)
    stopTimer()
    // 離開頁面時相機一定要關掉，否則鏡頭旁的指示燈會一直亮著
    closeStream()
    void releaseWakeLock()
  })

  return {
    cameras,
    selectedCameraId,
    stream,
    recording,
    elapsedSeconds,
    error,
    mimeType,
    supported,
    initializing,
    resolution,
    portraitVideo,
    init,
    openCamera,
    start,
    stop,
  }
}

/**
 * 把 `getUserMedia` 的錯誤翻成看得懂的話。
 *
 * 原始訊息（`NotAllowedError`、`NotReadableError`）對使用者毫無意義，
 * 而這幾種情況的處理方式完全不同 —— 被拒絕要去設定裡開，被占用要關掉別的
 * App，沒有鏡頭則是這台裝置本來就不行。
 */
function describeCameraError(err: unknown): string {
  const name = err instanceof DOMException ? err.name : ''

  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return '相機權限被拒絕。請在瀏覽器的網站設定裡允許使用相機，然後重新整理。'
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return '找不到可用的鏡頭，或這顆鏡頭不支援要求的解析度。'
  }
  if (name === 'NotReadableError') {
    return '鏡頭正被其他 App 使用中，請先關閉相機類的 App 再試一次。'
  }
  return '無法開啟相機。請確認是以 HTTPS 開啟這個頁面。'
}
