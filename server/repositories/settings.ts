import {
  DEFAULT_SITE_SETTINGS,
  siteSettingsInputSchema,
  siteSettingsSchema,
  type SiteSettings,
  type SiteSettingsInput,
} from '../../shared/schemas/settings'
import { getDb, isFirebaseConfigured } from '../utils/firebase'
import { getMemoryStore } from '../utils/memory-store'
import { nowIso, parseEntityOrNull } from './_helpers'

/** 網站設定是單一文件，固定放在 `siteSettings/main`。 */
const COLLECTION = 'siteSettings'
const DOC_ID = 'main'

/**
 * 網站設定存取。
 *
 * 讀取永遠會成功：還沒設定過就回傳 `DEFAULT_SITE_SETTINGS`。
 * 這讓版面不必到處寫 `settings?.teamName ?? '...'` 的防禦式程式碼。
 */

export async function getSiteSettings(): Promise<SiteSettings> {
  if (!isFirebaseConfigured()) {
    return getMemoryStore().settings
  }

  const db = await getDb()
  const doc = await db.collection(COLLECTION).doc(DOC_ID).get()
  if (!doc.exists) return DEFAULT_SITE_SETTINGS

  return parseEntityOrNull(siteSettingsSchema, doc.data(), 'siteSettings') ?? DEFAULT_SITE_SETTINGS
}

export async function updateSiteSettings(input: SiteSettingsInput): Promise<SiteSettings> {
  const data = siteSettingsInputSchema.parse(input)
  const merged: SiteSettings = { ...data, updatedAt: nowIso() }

  if (!isFirebaseConfigured()) {
    const store = getMemoryStore()
    store.settings = merged
    return merged
  }

  const db = await getDb()
  await db.collection(COLLECTION).doc(DOC_ID).set(merged, { merge: true })
  return merged
}
