import type { GameHalf } from '#shared/schemas/game'

/**
 * 還沒傳完的「從裝置挑的影片檔」（IndexedDB）。
 *
 * ## 為什麼要存
 * 一個 4K 半局的檔案有 1～6 GB，傳完要幾十分鐘。那段時間裡使用者一定會去做
 * 別的事 —— 換到別的後台頁（佇列活在 plugin 上，繼續傳）、關掉分頁、或者
 * 手機把整個網頁程序回收掉（錄影頁踩過，見 `clip-store.ts`）。
 * 後兩種情況下，**沒有存起來的話那幾十分鐘就白費了**，而且畫面上什麼都不會留下。
 *
 * ## 存的是 `File` 而不是內容
 * `File` 可以結構化複製進 IndexedDB，而它只是**磁碟上那個檔案的參照** ——
 * 存進來不會複製 6 GB，讀回來也不佔記憶體。
 *
 * ⚠️ 代價是它**會失效**：使用者把檔案移走、刪掉，或 iOS 回收了照片庫裡的那一份，
 * 讀的時候才會拋錯（存的當下看不出來）。所以續傳前要先試讀一個位元組
 * （`isReadable()`），失效的要明講「這個檔案找不到了，請重新挑」，
 * 而不是丟一個 `NotReadableError` 給使用者看。
 *
 * ## 連上傳位址與位移一起存
 * YouTube 的 resumable 工作階段網址有效期約一週。把它和「已確認到第幾個
 * 位元組」一起存下來，重新打開頁面就能**從斷點接著傳**，而不是重開一個
 * 工作階段（那會在 YouTube 上多一支半殘的影片）。
 *
 * ## 什麼時候刪
 * 上傳成功、或使用者按「丟棄」。**失敗不刪** —— 失敗正是它存在的理由。
 */

export interface PendingUpload {
  id: string
  gameId: string
  inning: number
  half: GameHalf
  /** YouTube 上的標題。續傳時要和第一次開工作階段時一致。 */
  title: string
  fileName: string
  file: File
  /** YouTube 的 resumable 上傳網址。空字串代表還沒開工作階段。 */
  location: string
  /** 已確認送達的位元組數。 */
  offset: number
  createdAt: number
}

export interface UploadStore {
  save(record: PendingUpload): Promise<void>
  /** 上傳途中更新進度。每傳完一塊才寫一次，不要每個 progress 事件都寫。 */
  progress(id: string, location: string, offset: number): Promise<void>
  list(gameId: string): Promise<PendingUpload[]>
  remove(id: string): Promise<void>
}

const DB_NAME = 'hgm-uploads'
const DB_VERSION = 1
const STORE = 'pending'

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
 * 才代表落地。分頁被關掉時，差的就是這一步。
 */
function committed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new DOMException('寫入被中止', 'AbortError'))
  })
}

export function createIndexedDbUploadStore(): UploadStore {
  let opening: Promise<IDBDatabase> | null = null

  function db(): Promise<IDBDatabase> {
    opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        const database = request.result
        if (!database.objectStoreNames.contains(STORE)) {
          database.createObjectStore(STORE, { keyPath: 'id' })
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
    async save(record) {
      const tx = (await db()).transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(record)
      await committed(tx)
    },

    async progress(id, location, offset) {
      const tx = (await db()).transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      const record = await promisify<PendingUpload | undefined>(store.get(id))
      // 已經被刪掉（傳完了、或使用者按了丟棄）就什麼都不做，不要把它寫回來
      if (record) store.put({ ...record, location, offset })
      await committed(tx)
    },

    async list(gameId) {
      const tx = (await db()).transaction(STORE, 'readonly')
      const records = await promisify<PendingUpload[]>(tx.objectStore(STORE).getAll())
      return records
        .filter((record) => record.gameId === gameId)
        .sort((a, b) => a.createdAt - b.createdAt)
    },

    async remove(id) {
      const tx = (await db()).transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(id)
      await committed(tx)
    },
  }
}

/**
 * 同一套介面的記憶體版。
 *
 * 給沒有 IndexedDB 的環境（測試、無痕模式下的某些瀏覽器）用。它**不會**
 * 讓上傳撐過重新載入 —— 行為等同沒有這個功能 —— 但上傳本身照樣能跑，
 * 而不是整頁掛掉。
 */
export function createMemoryUploadStore(): UploadStore {
  const records = new Map<string, PendingUpload>()

  return {
    async save(record) {
      records.set(record.id, { ...record })
    },
    async progress(id, location, offset) {
      const record = records.get(id)
      if (record) records.set(id, { ...record, location, offset })
    },
    async list(gameId) {
      return [...records.values()]
        .filter((record) => record.gameId === gameId)
        .sort((a, b) => a.createdAt - b.createdAt)
    },
    async remove(id) {
      records.delete(id)
    },
  }
}

/** 整個分頁共用一個連線 —— 上傳佇列與「還沒傳完」清單要看到同一批資料。 */
let shared: UploadStore | null = null

export function getUploadStore(): UploadStore {
  shared ??=
    typeof indexedDB === 'undefined' ? createMemoryUploadStore() : createIndexedDbUploadStore()
  return shared
}

/**
 * 這個 `File` 還讀得到嗎。
 *
 * 存進 IndexedDB 的 `File` 只是磁碟上那個檔案的參照 —— 檔案被移走、刪掉，
 * 或 iOS 回收了照片庫裡的那一份之後，物件還在、大小還讀得到，**要真的去讀
 * 內容才會拋錯**。所以續傳前先試讀一個位元組，把「檔案不見了」變成一句
 * 看得懂的話，而不是上傳到一半跳出 `NotReadableError`。
 */
export async function isReadable(file: File): Promise<boolean> {
  try {
    await file.slice(0, 1).arrayBuffer()
    return true
  } catch {
    return false
  }
}
