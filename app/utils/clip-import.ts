import { GAME_HALVES, type GameHalf } from '#shared/schemas/game'

/**
 * 「從裝置挑現成的影片檔，一個半局一個檔案」的純判斷邏輯
 * （`/admin/upload/[id]`，見 `docs/game-recording-plan.md`）。
 *
 * 有狀態的那一半（檔案選取、上傳佇列）在那一頁與 `~/utils/youtube-upload.ts`。
 * 會寫錯、也真的測得到的是這裡：哪些檔案該擋掉、挑進來的十四個檔案要照什麼
 * 順序對到哪幾個半局。
 *
 * ## ⚠️ 網頁沒辦法直接讀相機裡的檔案
 * 外接相機（Insta360 GO Ultra 這類）是 Wi-Fi／USB 裝置，瀏覽器沒有任何 API
 * 連得進去。所以流程一定是三段：**相機 → 用相機的 App 匯出到手機或電腦 →
 * 這一頁從「檔案／照片」挑**。畫面上要把這件事講出來，否則使用者會一直找
 * 「連線到相機」的按鈕。
 */

/** 挑檔案時只需要這幾個欄位 —— 宣告成介面，測試就不必偽造整個 `File`。 */
export interface ImportFile {
  name: string
  size: number
  type: string
  /** 檔案的修改時間。相機匯出的檔案通常就是拍攝時間，拿來排序。 */
  lastModified: number
}

/**
 * Insta360（與多數運動相機）會在拍攝檔旁邊放一個低解析度的代理檔，
 * 給手機 App 預覽用。`LRV` = low resolution video。
 *
 * ⚠️ **這種檔案一定要擋掉。** 它的檔名、時間、副檔名都和正片幾乎一樣，
 * 混進來之後最好的情況是多傳一份垃圾，最壞的情況是**正片被它擠掉**：
 * 兩個檔案排在一起，一人一個半局，於是每隔一局就有一段是 480p 的預覽畫質。
 * 而那要等到有人點開前台的影片才會發現。
 */
const PROXY_PATTERN = /(^|[_.-])(lrv|pro_lrv|thm)([_.-]|$)|\.lrv$/i

export function isProxyVideo(name: string): boolean {
  return PROXY_PATTERN.test(name)
}

/**
 * 看得出是不是影片。
 *
 * 以 `type` 為主 —— 但**從「檔案」App 挑出來的檔案 `type` 常常是空字串**
 * （尤其是 iOS 上的 `.insv`、`.mov`），所以空的時候退回看副檔名，
 * 而不是直接擋掉（擋掉的話使用者會以為檔案壞了）。
 */
const VIDEO_EXTENSIONS = ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi', 'insv', 'lrv']

export function isVideoFile(file: ImportFile): boolean {
  if (file.type.startsWith('video/')) return true
  if (file.type) return false
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  return VIDEO_EXTENSIONS.includes(extension)
}

/** 這個檔案能不能上傳，不能的話為什麼。 */
export type FileRejection = 'not-video' | 'proxy' | 'empty'

export function rejectionOf(file: ImportFile): FileRejection | null {
  if (!isVideoFile(file)) return 'not-video'
  if (isProxyVideo(file.name)) return 'proxy'
  if (file.size <= 0) return 'empty'
  return null
}

export const REJECTION_LABELS: Record<FileRejection, string> = {
  'not-video': '不是影片檔',
  proxy: '相機的低畫質預覽檔（LRV），不是正片',
  empty: '檔案是空的',
}

/**
 * 依拍攝順序排好。
 *
 * 以**修改時間**為主而不是檔名：相機的檔名規則各家不同（`VID_001`、
 * `PRO_VID_20260930_…`、`GX010023`），而「先拍的排前面」是每一台都成立的。
 * 時間一樣（同一秒匯出的多個檔案，在電腦上複製過就很常見）才比檔名，
 * 而且用 `localeCompare` 的數字模式，`VID_2` 才不會排在 `VID_10` 後面。
 */
export function sortByCapture<T extends ImportFile>(files: readonly T[]): T[] {
  return [...files].sort(
    (a, b) =>
      a.lastModified - b.lastModified ||
      a.name.localeCompare(b.name, 'en', { numeric: true, sensitivity: 'base' }),
  )
}

export interface HalfInningSlot {
  inning: number
  half: GameHalf
}

/** 一場比賽的所有半局，照比賽順序。 */
export function halfInningSlots(totalInnings: number): HalfInningSlot[] {
  return Array.from({ length: Math.max(1, totalInnings) }, (_, i) => i + 1).flatMap((inning) =>
    GAME_HALVES.map((half) => ({ inning, half })),
  )
}

/**
 * 把挑進來的檔案依序填進**還沒有影片的**半局。
 *
 * 一次挑十四個檔案時，逐個選局數是十四次下拉選單 —— 而它們本來就是照順序
 * 拍的。所以預設「第一個檔案配第一個缺口」，使用者只在對不上時才動手改。
 *
 * 缺口用完之後還有檔案的話，**繼續往後排到已經有影片的半局上**（重錄會覆蓋，
 * 這是既有行為），排完整場就停 —— 多出來的檔案不指派，讓使用者自己決定。
 * 靜靜地丟掉檔案比留一個空的局數選單糟糕得多。
 */
export function planAssignments<T extends ImportFile>(options: {
  files: readonly T[]
  slots: readonly HalfInningSlot[]
  /** 已經有影片的半局，`${inning}-${half}`。這些排在缺口後面。 */
  taken: ReadonlySet<string>
}): Array<{ file: T; slot: HalfInningSlot | null }> {
  const key = (slot: HalfInningSlot) => `${slot.inning}-${slot.half}`
  const queue = [
    ...options.slots.filter((slot) => !options.taken.has(key(slot))),
    ...options.slots.filter((slot) => options.taken.has(key(slot))),
  ]

  return sortByCapture(options.files).map((file, index) => ({
    file,
    slot: queue[index] ?? null,
  }))
}

/**
 * 有沒有兩個檔案指到同一個半局。
 *
 * 片段的身分是「第幾局的哪半局」，所以重複指派不會報錯 ——
 * **後傳的那個會直接覆蓋前一個**，而且兩支影片都已經上傳到 YouTube 了。
 * 畫面上一定要先警告，這是使用者唯一會發現的機會。
 */
export function duplicateSlots(
  assignments: ReadonlyArray<{ slot: HalfInningSlot | null }>,
): Set<string> {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const { slot } of assignments) {
    if (!slot) continue
    const key = `${slot.inning}-${slot.half}`
    if (seen.has(key)) duplicates.add(key)
    seen.add(key)
  }
  return duplicates
}
