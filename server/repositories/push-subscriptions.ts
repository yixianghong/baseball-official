import { createHash } from 'node:crypto'
import {
  pushSubscriptionRecordSchema,
  type PushSubscriptionInput,
  type PushSubscriptionRecord,
} from '../../shared/schemas/push'
import { getDb, isFirebaseConfigured } from '../utils/firebase'
import { getMemoryStore } from '../utils/memory-store'
import { nowIso, parseEntity } from './_helpers'

/** Firestore collection 名稱。 */
const COLLECTION = 'pushSubscriptions'

/**
 * 推播訂閱的存取。
 *
 * ## 文件 ID 用 endpoint 的雜湊，不用自動 ID
 * endpoint 本身就是這筆訂閱的唯一識別，但它有好幾百個字元，而且含有
 * Firestore 文件 ID 不允許的 `/`。取 SHA-256 之後：
 *
 * - 同一台裝置重複訂閱會覆蓋同一筆，不會累積重複資料
 * - 退訂時不必先查詢就能直接刪除（少一次讀取）
 * - endpoint 是一個「能對這台裝置發推播」的能力憑證，不適合當成 ID 攤在網址上
 *
 * ## 沒有「屬於誰」的欄位
 * 訂閱是匿名的 —— 網站本身除了後台之外沒有使用者系統，訪客也不需要登入
 * 才能訂閱球隊公告。要做「只推給特定球員」得先有球員帳號，那是另一件事。
 */

/** endpoint → 文件 ID。 */
export function subscriptionId(endpoint: string): string {
  return createHash('sha256').update(endpoint).digest('hex').slice(0, 40)
}

export async function saveSubscription(
  subscription: PushSubscriptionInput,
  userAgent = '',
): Promise<PushSubscriptionRecord> {
  const id = subscriptionId(subscription.endpoint)
  const existing = await getSubscription(id)

  const record: PushSubscriptionRecord = {
    ...subscription,
    id,
    userAgent,
    createdAt: existing?.createdAt ?? nowIso(),
    updatedAt: nowIso(),
    // 重新訂閱視為「這台裝置又活了」，把先前累積的失敗次數歸零
    failureCount: 0,
  }

  if (!isFirebaseConfigured()) {
    getMemoryStore().pushSubscriptions.set(id, record)
    return record
  }

  const db = await getDb()
  const { id: _id, ...data } = record
  await db.collection(COLLECTION).doc(id).set(data)
  return record
}

export async function getSubscription(id: string): Promise<PushSubscriptionRecord | null> {
  if (!isFirebaseConfigured()) {
    return getMemoryStore().pushSubscriptions.get(id) ?? null
  }

  const db = await getDb()
  const doc = await db.collection(COLLECTION).doc(id).get()
  if (!doc.exists) return null
  return parseEntity(
    pushSubscriptionRecordSchema,
    { ...doc.data(), id: doc.id },
    'pushSubscription',
  )
}

export async function listSubscriptions(): Promise<PushSubscriptionRecord[]> {
  if (!isFirebaseConfigured()) {
    return [...getMemoryStore().pushSubscriptions.values()]
  }

  const db = await getDb()
  const snapshot = await db.collection(COLLECTION).get()
  return snapshot.docs.map((doc) =>
    parseEntity(pushSubscriptionRecordSchema, { ...doc.data(), id: doc.id }, 'pushSubscription'),
  )
}

export async function countSubscriptions(): Promise<number> {
  if (!isFirebaseConfigured()) {
    return getMemoryStore().pushSubscriptions.size
  }

  const db = await getDb()
  const snapshot = await db.collection(COLLECTION).count().get()
  return snapshot.data().count
}

/** 依 endpoint 刪除。找不到不是錯誤 —— 退訂本來就該是冪等的。 */
export async function removeSubscription(endpoint: string): Promise<void> {
  const id = subscriptionId(endpoint)

  if (!isFirebaseConfigured()) {
    getMemoryStore().pushSubscriptions.delete(id)
    return
  }

  const db = await getDb()
  await db.collection(COLLECTION).doc(id).delete()
}

/** 記錄一次非致命的發送失敗。回傳累積次數。 */
export async function recordFailure(id: string): Promise<number> {
  const existing = await getSubscription(id)
  if (!existing) return 0

  const failureCount = existing.failureCount + 1

  if (!isFirebaseConfigured()) {
    getMemoryStore().pushSubscriptions.set(id, { ...existing, failureCount })
    return failureCount
  }

  const db = await getDb()
  await db.collection(COLLECTION).doc(id).set({ failureCount }, { merge: true })
  return failureCount
}

/** 依文件 ID 刪除（發送時發現訂閱已失效會用到）。 */
export async function removeSubscriptionById(id: string): Promise<void> {
  if (!isFirebaseConfigured()) {
    getMemoryStore().pushSubscriptions.delete(id)
    return
  }

  const db = await getDb()
  await db.collection(COLLECTION).doc(id).delete()
}
