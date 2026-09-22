import {
  announcementInputSchema,
  announcementSchema,
  compareAnnouncements,
  type Announcement,
  type AnnouncementInput,
  type AnnouncementPatch,
  type AnnouncementQueryOptions,
} from '../../shared/schemas/announcement'
import { getDb, isFirebaseConfigured } from '../utils/firebase'
import { getMemoryStore, memoryId } from '../utils/memory-store'
import { notFound, nowIso, parseEntity, parseEntityOrNull } from './_helpers'

const COLLECTION = 'announcements'

/**
 * 公告資料存取。
 *
 * 排序用 shared 的 `compareAnnouncements()`（置頂優先、其次時間新到舊），
 * 首頁的最新三則與公告牆因此順序一致。
 */

export async function listAnnouncements(
  query: AnnouncementQueryOptions = {},
): Promise<Announcement[]> {
  const { limit = 50 } = query
  const all = await readAll()

  return all
    .filter((item) => (query.status ? item.status === query.status : true))
    .filter((item) => (query.category ? item.category === query.category : true))
    .sort(compareAnnouncements)
    .slice(0, limit)
}

export async function getAnnouncement(id: string): Promise<Announcement | null> {
  if (!isFirebaseConfigured()) {
    return getMemoryStore().announcements.get(id) ?? null
  }

  const db = await getDb()
  const doc = await db.collection(COLLECTION).doc(id).get()
  if (!doc.exists) return null
  return parseEntity(announcementSchema, { ...doc.data(), id: doc.id }, 'announcement')
}

export async function createAnnouncement(input: AnnouncementInput): Promise<Announcement> {
  const parsed = announcementInputSchema.parse(input)
  // 未指定發布時間就用當下 —— 後台表單留空是最常見的情況
  const data = { ...parsed, publishedAt: parsed.publishedAt || nowIso() }
  const timestamps = { createdAt: nowIso(), updatedAt: nowIso() }

  if (!isFirebaseConfigured()) {
    const announcement: Announcement = { ...data, ...timestamps, id: memoryId('a') }
    getMemoryStore().announcements.set(announcement.id, announcement)
    return announcement
  }

  const db = await getDb()
  const ref = await db.collection(COLLECTION).add({ ...data, ...timestamps })
  return { ...data, ...timestamps, id: ref.id }
}

export async function updateAnnouncement(
  id: string,
  patch: AnnouncementPatch,
): Promise<Announcement> {
  const existing = await getAnnouncement(id)
  if (!existing) throw notFound('公告')

  const merged = announcementSchema.parse({ ...existing, ...patch, updatedAt: nowIso() })
  const withPublishedAt = { ...merged, publishedAt: merged.publishedAt || nowIso() }

  if (!isFirebaseConfigured()) {
    getMemoryStore().announcements.set(id, withPublishedAt)
    return withPublishedAt
  }

  const db = await getDb()
  const { id: _id, ...payload } = withPublishedAt
  await db.collection(COLLECTION).doc(id).set(payload, { merge: true })
  return withPublishedAt
}

export async function deleteAnnouncement(id: string): Promise<void> {
  const existing = await getAnnouncement(id)
  if (!existing) throw notFound('公告')

  if (!isFirebaseConfigured()) {
    getMemoryStore().announcements.delete(id)
    return
  }

  const db = await getDb()
  await db.collection(COLLECTION).doc(id).delete()
}

async function readAll(): Promise<Announcement[]> {
  if (!isFirebaseConfigured()) {
    return [...getMemoryStore().announcements.values()]
  }

  const db = await getDb()
  const snapshot = await db.collection(COLLECTION).get()
  return snapshot.docs
    .map((doc) =>
      parseEntityOrNull(announcementSchema, { ...doc.data(), id: doc.id }, 'announcement'),
    )
    .filter((item): item is Announcement => item !== null)
}
