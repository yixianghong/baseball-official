import type { GameHalf } from '#shared/schemas/game'

/**
 * 錄影片段的落地儲存（IndexedDB）。
 *
 * ## 為什麼錄影中就要寫到磁碟
 * `MediaRecorder` 每 5 秒吐一塊資料。原本這些塊全部留在 JS 的陣列裡，
 * 按下結束才組成一個檔案 —— 錄越久吃越多記憶體。iOS 對網頁程序的記憶體上限
 * 比原生 App 低得多，**錄到十分鐘左右就被系統整個殺掉**：主畫面 App 的表現是
 * 「閃一下、整頁重新載入、再要一次相機權限」，而那一段只存在於被殺掉的
 * 程序裡，沒有下載、也沒有上傳，就這樣消失了（實際在球場發生過）。
 *
 * 現在每一塊一到就寫進 IndexedDB 然後放掉，記憶體裡不再累積。Safari 把
 * IndexedDB 裡的 Blob 存成磁碟上的檔案，之後讀回來的 Blob 也是指向那個檔案，
 * 所以組回完整影片、存檔、上傳都不需要把整段搬進記憶體。
 *
 * ## 順便得到的：頁面沒了，影片還在
 * 片段在**上傳成功之前**都留在這裡。頁面就算真的被系統回收，重新打開時
 * 已經錄到的部分還在，可以救回來上傳或存到裝置 —— 用 5 秒一塊的 timeslice
 * 錄出來的是 fragmented MP4，截斷在任何一塊的邊界上都還能播。
 *
 * ## 什麼時候刪
 * 上傳成功、或使用者在錄影頁按「丟棄」。**存到裝置不算** —— 那一段還沒上去，
 * 頁面再被回收一次的話，救回清單裡要看得到它。
 */

export interface ClipSession {
  id: string
  gameId: string
  inning: number
  half: GameHalf
  mimeType: string
  /** `Date.now()`。救回時用它判斷哪一段是最後錄的。 */
  startedAt: number
  /** 按下結束、完整錄完。`false` 代表錄到一半頁面就沒了。 */
  finished: boolean
}

export interface ClipStore {
  begin(session: ClipSession): Promise<void>
  /** `seq` 決定組回去的順序，一定要由 0 開始遞增。 */
  append(sessionId: string, seq: number, chunk: Blob): Promise<void>
  finish(sessionId: string): Promise<void>
  /** 把存下來的塊依序組回一個檔案。一塊都沒有就回 `null`。 */
  assemble(sessionId: string): Promise<Blob | null>
  list(gameId: string): Promise<ClipSession[]>
  remove(sessionId: string): Promise<void>
}

const DB_NAME = 'hgm-recordings'
const DB_VERSION = 1
const SESSIONS = 'sessions'
const CHUNKS = 'chunks'

interface ChunkRecord {
  sessionId: string
  seq: number
  data: Blob
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/**
 * 等整個 transaction 真的寫完。
 *
 * 只等 `request.onsuccess` 不夠：那只代表「排進去了」，要等 `complete`
 * 才代表落地。錄影中途頁面被殺掉時，差的就是這一步。
 */
function committed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new DOMException('寫入被中止', 'AbortError'))
  })
}

/** 某一段的全部塊。陣列鍵依元素比較，所以 `seq` 會照數字排好。 */
function chunkRange(sessionId: string): IDBKeyRange {
  return IDBKeyRange.bound([sessionId, 0], [sessionId, Number.MAX_SAFE_INTEGER])
}

export function createIndexedDbClipStore(): ClipStore {
  let opening: Promise<IDBDatabase> | null = null

  function db(): Promise<IDBDatabase> {
    opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        const database = request.result
        if (!database.objectStoreNames.contains(SESSIONS)) {
          database.createObjectStore(SESSIONS, { keyPath: 'id' })
        }
        if (!database.objectStoreNames.contains(CHUNKS)) {
          database.createObjectStore(CHUNKS, { keyPath: ['sessionId', 'seq'] })
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    }).catch((err) => {
      // 開不起來的話下一次重試，不要把失敗的 Promise 快取一輩子
      opening = null
      throw err
    })
    return opening
  }

  /*
   * ⚠️ 每個方法都是「開 transaction → 放請求 → 等 complete」，中間不 await
   * 任何 IndexedDB 以外的東西。transaction 在事件迴圈空下來時會自動提交，
   * 中途去等別的 Promise 的話，回來時它已經關了（`TransactionInactiveError`）。
   */
  return {
    async begin(session) {
      const tx = (await db()).transaction(SESSIONS, 'readwrite')
      tx.objectStore(SESSIONS).put(session)
      await committed(tx)
    },

    async append(sessionId, seq, chunk) {
      const tx = (await db()).transaction(CHUNKS, 'readwrite')
      tx.objectStore(CHUNKS).put({ sessionId, seq, data: chunk } satisfies ChunkRecord)
      await committed(tx)
    },

    async finish(sessionId) {
      const tx = (await db()).transaction(SESSIONS, 'readwrite')
      const store = tx.objectStore(SESSIONS)
      const session = await promisify<ClipSession | undefined>(store.get(sessionId))
      if (session) store.put({ ...session, finished: true })
      await committed(tx)
    },

    async assemble(sessionId) {
      const tx = (await db()).transaction([SESSIONS, CHUNKS], 'readonly')
      const [session, records] = await Promise.all([
        promisify<ClipSession | undefined>(tx.objectStore(SESSIONS).get(sessionId)),
        promisify<ChunkRecord[]>(tx.objectStore(CHUNKS).getAll(chunkRange(sessionId))),
      ])
      if (!records.length) return null
      return new Blob(
        records.map((record) => record.data),
        { type: session?.mimeType ?? records[0]!.data.type },
      )
    },

    async list(gameId) {
      const tx = (await db()).transaction(SESSIONS, 'readonly')
      const sessions = await promisify<ClipSession[]>(tx.objectStore(SESSIONS).getAll())
      return sessions
        .filter((session) => session.gameId === gameId)
        .sort((a, b) => a.startedAt - b.startedAt)
    },

    async remove(sessionId) {
      const tx = (await db()).transaction([SESSIONS, CHUNKS], 'readwrite')
      tx.objectStore(SESSIONS).delete(sessionId)
      tx.objectStore(CHUNKS).delete(chunkRange(sessionId))
      await committed(tx)
    },
  }
}

/**
 * 同一套介面的記憶體版。
 *
 * 給沒有 IndexedDB 的環境（測試、極少數瀏覽器）用。它**不會**解決記憶體問題
 * —— 行為等同改版之前 —— 但錄影本身照樣能跑，而不是整個功能掛掉。
 */
export function createMemoryClipStore(): ClipStore {
  const sessions = new Map<string, ClipSession>()
  const chunks = new Map<string, Blob[]>()

  return {
    async begin(session) {
      sessions.set(session.id, { ...session })
      chunks.set(session.id, [])
    },
    async append(sessionId, seq, chunk) {
      const list = chunks.get(sessionId) ?? []
      list[seq] = chunk
      chunks.set(sessionId, list)
    },
    async finish(sessionId) {
      const session = sessions.get(sessionId)
      if (session) sessions.set(sessionId, { ...session, finished: true })
    },
    async assemble(sessionId) {
      const list = (chunks.get(sessionId) ?? []).filter(Boolean)
      if (!list.length) return null
      return new Blob(list, { type: sessions.get(sessionId)?.mimeType ?? list[0]!.type })
    },
    async list(gameId) {
      return [...sessions.values()]
        .filter((session) => session.gameId === gameId)
        .sort((a, b) => a.startedAt - b.startedAt)
    },
    async remove(sessionId) {
      sessions.delete(sessionId)
      chunks.delete(sessionId)
    },
  }
}

/**
 * 錄影頁用的那一份。整個分頁共用同一個連線 —— 錄影與上傳佇列要看到同一批資料。
 * 只在瀏覽器裡呼叫（錄影與上傳都是 client-only 的動作）。
 */
let shared: ClipStore | null = null

export function getClipStore(): ClipStore {
  shared ??= typeof indexedDB === 'undefined' ? createMemoryClipStore() : createIndexedDbClipStore()
  return shared
}
