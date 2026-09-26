import { HALF_LABELS, type GameHalf } from '#shared/schemas/game'

/**
 * 分段錄影的純邏輯（見 `docs/game-recording-plan.md`）。
 *
 * 錄影本身要靠 `MediaRecorder` 與 `getUserMedia`，那些在測試環境裡不存在。
 * 所以「挑哪個容器」「鏡頭怎麼排序」「檔名長什麼樣」這些**判斷**全部抽到這裡，
 * 變成不碰瀏覽器 API 的純函式 —— 它們才是真的會寫錯、也真的測得到的部分。
 * 有狀態的那一半在 `app/composables/useGameRecorder.ts`。
 */

/**
 * `MediaRecorder` 的容器候選，由相容性最好的排到最差。
 *
 * ## 為什麼 mp4 一定要排在 webm 前面
 * Safari 只錄得出也只播得動 mp4，Chrome 兩種都錄得出來。順序反過來的話，
 * Android 錄的會是 webm —— 而 **webm 在 iPhone 上完全播不動**，
 * 那支影片對一半的隊員家屬來說等於不存在，而且在錄的當下完全看不出問題。
 *
 * 帶 codecs 的字串排在前面：`isTypeSupported('video/mp4')` 有些瀏覽器會回 true
 * 但實際錄出來是它自己挑的編碼，明確指定 H.264 + AAC 才是最保險的組合。
 */
export const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=h264,opus',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
] as const

/**
 * 挑一個這台裝置錄得出來的容器。
 *
 * 傳入 `isTypeSupported` 而不是直接呼叫 `MediaRecorder.isTypeSupported` ——
 * 那是為了能在沒有瀏覽器的環境裡測這條優先順序。
 *
 * 回傳空字串代表「一個都不支援」，呼叫端應該把錄影功能整個關掉，
 * 而不是硬著頭皮用預設值開下去（那會錄出一個沒人放得出來的檔案）。
 */
export function pickMimeType(isTypeSupported: (type: string) => boolean): string {
  for (const candidate of MIME_CANDIDATES) {
    if (isTypeSupported(candidate)) return candidate
  }
  return ''
}

/** 由 MIME 決定副檔名。不採信任何外部傳來的字串。 */
export function extensionFor(mimeType: string): string {
  if (mimeType.startsWith('video/mp4')) return 'mp4'
  if (mimeType.startsWith('video/webm')) return 'webm'
  return 'bin'
}

export interface CameraOption {
  deviceId: string
  label: string
  /** 看起來像後鏡頭。排序與預設選擇都看它。 */
  isBack: boolean
  /** 看起來像超廣角 —— 球場邊拍全場要的就是這顆。 */
  isUltraWide: boolean
}

/*
 * 鏡頭只能從 label 猜，沒有標準欄位可以問。
 *
 * label 是各家作業系統自己給的字串，而且**跟著系統語言變**：
 * iOS 中文是「後置超廣角相機」、英文是「Back Ultra Wide Camera」，
 * Android 則常常是「camera2 0, facing back」這種。所以兩種語言都要比對。
 */
const BACK_PATTERN = /back|rear|environment|後置|背面/i
const ULTRA_WIDE_PATTERN = /ultra[\s-]*wide|超廣角/i

/**
 * 把鏡頭清單整理成可以直接畫在畫面上的選項。
 *
 * ⚠️ **`deviceId` 每次重新取得權限都會變**，所以不能把選擇存起來下次沿用，
 * 每一場都要重挑。而且在 `getUserMedia()` 拿到權限之前，`label` 一律是空字串 ——
 * 那時這裡判斷不出哪顆是後鏡頭，呼叫端必須先要權限再列舉。
 *
 * 排序：後鏡頭優先，後鏡頭裡超廣角再優先。其餘維持原本的順序（那通常就是
 * 系統認為的預設順序），不要自作聰明重排。
 */
export function sortCameras(devices: MediaDeviceInfo[]): CameraOption[] {
  const options = devices
    .filter((device) => device.kind === 'videoinput')
    .map((device, index) => ({
      deviceId: device.deviceId,
      // 沒有 label（還沒拿到權限）時至少給一個能點的名字
      label: device.label || `鏡頭 ${index + 1}`,
      isBack: BACK_PATTERN.test(device.label),
      isUltraWide: ULTRA_WIDE_PATTERN.test(device.label),
    }))

  return options
    .map((option, index) => ({ option, index }))
    .sort((a, b) => {
      const weight = (item: (typeof options)[number]) =>
        (item.isBack ? 2 : 0) + (item.isUltraWide ? 1 : 0)
      const diff = weight(b.option) - weight(a.option)
      // 權重相同就保持原順序 —— Array.prototype.sort 的穩定性在這裡不可依賴，
      // 因為我們比的是自己算出來的權重而不是原索引
      return diff !== 0 ? diff : a.index - b.index
    })
    .map(({ option }) => option)
}

/** 預設要選哪一顆：超廣角後鏡頭 → 任一後鏡頭 → 第一顆。 */
export function defaultCameraId(cameras: CameraOption[]): string {
  const ultraWideBack = cameras.find((camera) => camera.isBack && camera.isUltraWide)
  const back = cameras.find((camera) => camera.isBack)
  return (ultraWideBack ?? back ?? cameras[0])?.deviceId ?? ''
}

/**
 * 片段的檔名。
 *
 * 沿用出賽名單圖卡的格式（`隊名-vs-對手-日期`，見 `GameLineupCard.vue`），
 * 後面接局數與上下半 —— 十四個檔案下載到同一個資料夾時，靠檔名就排得出
 * 比賽順序、也看得出是哪一場。
 *
 * 局數補零是為了「第 10 局」不會排在「第 2 局」前面。上下半不必補零：
 * 「上」是 U+4E0A、「下」是 U+4E0B，碼位順序剛好就是比賽順序
 * （`tests/unit/recording.test.ts` 守著這件事，別換成別的字）。
 *
 * 會出現在檔名裡的只有隊名與對手，它們是後台自己輸入的；但檔案系統不接受
 * `/` 與 `\`，中文隊名也可能被貼進奇怪的字元，所以還是清一次。
 */
export function clipFileName(options: {
  teamName: string
  opponent: string
  date: string
  inning: number
  half: GameHalf
  mimeType: string
}): string {
  const safe = (value: string) => value.replace(/[\\/:*?"<>|]/g, '').trim() || '未命名'
  const inning = String(options.inning).padStart(2, '0')
  const stem = [
    safe(options.teamName),
    'vs',
    safe(options.opponent),
    options.date,
    `第${inning}局${HALF_LABELS[options.half]}`,
  ]
  return `${stem.join('-')}.${extensionFor(options.mimeType)}`
}

/**
 * 下一段要錄哪裡：上半 → 同一局的下半 → 下一局的上半。
 *
 * 錄完自動往前推，是為了讓球場邊那個人**不必碰局數選擇器** —— 他兩隻手
 * 都在忙，而且一場要按十四次。超過最後一局就停在原地（延長賽再手動選）。
 */
export function nextHalf(
  current: { inning: number; half: GameHalf },
  totalInnings: number,
): { inning: number; half: GameHalf } {
  if (current.half === 'top') return { inning: current.inning, half: 'bottom' }
  if (current.inning >= totalInnings) return current
  return { inning: current.inning + 1, half: 'top' }
}

/**
 * 回到錄影頁時要接著錄哪裡。
 *
 * 看**比賽裡最後面的那一格**（第幾局、上半在下半之前）：錄完了 → 下一個
 * 半局；只有錄到一半被中斷的 → 同一個半局（剩下的部分還沒錄）。
 *
 * 輸入是三個來源的聯集：已經上傳到網站的、這次正在傳的、還留在裝置上沒傳的。
 * 只看其中一個的話，離開再回來就會從第 1 局上半開始 —— 場邊的人得自己回想
 * 剛剛錄到哪，而他通常正在看比賽。
 *
 * 刻意不用時間戳：已上傳的片段與裝置上的暫存各有各的時間，比「局數」脆弱；
 * 而錄影本來就是照比賽順序往前推的。
 */
export function resumePosition(
  entries: ReadonlyArray<{ inning: number; half: GameHalf; finished: boolean }>,
  totalInnings: number,
): { inning: number; half: GameHalf } | null {
  const order = (entry: { inning: number; half: GameHalf }) =>
    entry.inning * 2 + (entry.half === 'bottom' ? 1 : 0)

  let furthest = -1
  for (const entry of entries) furthest = Math.max(furthest, order(entry))
  if (furthest < 0) return null

  const atFurthest = entries.filter((entry) => order(entry) === furthest)
  const here = { inning: atFurthest[0]!.inning, half: atFurthest[0]!.half }
  // 同一格有錄完的（例如重錄過）就往下一格走
  return atFurthest.some((entry) => entry.finished) ? nextHalf(here, totalInnings) : here
}

/** 秒數轉成 `12:34`。錄影中的計時器用。 */
export function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds))
  const mm = String(Math.floor(safe / 60)).padStart(2, '0')
  const ss = String(safe % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

/*
 * 檔案大小用的是 `~/utils/image.ts` 既有的 `formatBytes()`，這裡刻意不再寫一份。
 * 兩個同名的匯出會被 Nuxt 的自動匯入靜靜地蓋掉其中一個，而且不會有任何警告 ——
 * 畫面上只是數字長得不一樣，極難查。
 */
