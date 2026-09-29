import type { GameHalf } from '#shared/schemas/half-inning'
import type { Play } from '#shared/schemas/play'

/**
 * 逐打席紀錄的離線草稿（IndexedDB）。
 *
 * ## 為什麼需要它
 * 這個功能有兩個使用情境，其中一個在球場邊：一邊看球一邊登錄。而**球場的
 * 行動網路上，失敗是常態**（這條規則整個專案都適用，見
 * `docs/game-recording-plan.md`）。沒有草稿的話，網路一斷就白記一整局，
 * 而且畫面上看起來完全正常 —— 只是「儲存失敗」一閃而過。
 *
 * ## 順序不能反：先寫本機，再送伺服器
 * 和錄影「先存到裝置、再排進上傳佇列」是同一條規則。反過來的話，送出失敗
 * 就等於那半局沒了。寫成功、伺服器也收下之後才刪草稿。
 *
 * ## 為什麼重送是安全的
 * 端點以 `(inning, half)` 為鍵**整個半局覆蓋**，所以是冪等的 —— 同一份草稿
 * 送十次和送一次的結果一樣。這就是粒度選成「一個半局」的其中一個理由
 * （見 `saveHalfInningPlays()`）。
 *
 * ⚠️ IndexedDB 的兩個坑在 `clip-store.ts` 已經踩過了，這裡照抄：要等
 * `tx.oncomplete`（`request.onsuccess` 只代表排進去了），而且 transaction
 * 中間不能 await 任何 IndexedDB 以外的東西（它會自動提交然後拋
 * `TransactionInactiveError`）。
 */

export interface PlayDraft {
  /** `${gameId}:${inning}:${half}` —— 一個半局一筆，重寫就覆蓋。 */
  key: string
  gameId: string
  inning: number
  half: GameHalf
  plays: Play[]
  /** `Date.now()`。畫面上顯示「這份草稿是什麼時候的」。 */
  savedAt: number
}

export interface PlayStore {
  /** 寫入（或覆蓋）一個半局的草稿。 */
  put(draft: PlayDraft): Promise<void>
  /** 這場還沒同步成功的草稿，依半局順序。 */
  list(gameId: string): Promise<PlayDraft[]>
  remove(key: string): Promise<void>
}

const DB_NAME = 'hgm-plays'
const DB_VERSION = 1
const DRAFTS = 'drafts'

export function draftKey(gameId: string, inning: number, half: GameHalf): string {
  return `${gameId}:${inning}:${half}`
}

function committed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new DOMException('寫入被中止', 'AbortError'))
  })
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function byHalfInning(a: PlayDraft, b: PlayDraft): number {
  return a.inning - b.inning || (a.half === 'top' ? 0 : 1) - (b.half === 'top' ? 0 : 1)
}

export function createIndexedDbPlayStore(): PlayStore {
  let opening: Promise<IDBDatabase> | null = null

  function db(): Promise<IDBDatabase> {
    opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        const database = request.result
        if (!database.objectStoreNames.contains(DRAFTS)) {
          database.createObjectStore(DRAFTS, { keyPath: 'key' })
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

  return {
    async put(draft) {
      const tx = (await db()).transaction(DRAFTS, 'readwrite')
      tx.objectStore(DRAFTS).put(draft)
      await committed(tx)
    },

    async list(gameId) {
      const tx = (await db()).transaction(DRAFTS, 'readonly')
      const all = await promisify<PlayDraft[]>(tx.objectStore(DRAFTS).getAll())
      return all.filter((draft) => draft.gameId === gameId).sort(byHalfInning)
    },

    async remove(key) {
      const tx = (await db()).transaction(DRAFTS, 'readwrite')
      tx.objectStore(DRAFTS).delete(key)
      await committed(tx)
    },
  }
}

/**
 * 同一套介面的記憶體版。
 *
 * 給沒有 IndexedDB 的環境（測試、無痕視窗的某些設定）用。它**不會**在頁面
 * 關掉之後保住草稿 —— 但登錄本身照樣能跑，而不是整個分頁掛掉。
 */
export function createMemoryPlayStore(): PlayStore {
  const drafts = new Map<string, PlayDraft>()

  return {
    async put(draft) {
      drafts.set(draft.key, { ...draft })
    },
    async list(gameId) {
      return [...drafts.values()].filter((draft) => draft.gameId === gameId).sort(byHalfInning)
    },
    async remove(key) {
      drafts.delete(key)
    },
  }
}

/** 整個分頁共用同一個連線。只在瀏覽器裡呼叫。 */
let shared: PlayStore | null = null

export function getPlayStore(): PlayStore {
  shared ??= typeof indexedDB === 'undefined' ? createMemoryPlayStore() : createIndexedDbPlayStore()
  return shared
}
