import {
  comparePlayers,
  playerSchema,
  type Player,
  type PlayerInput,
  type PlayerPatch,
  type PlayerQueryOptions,
} from '../../shared/schemas/player'
import { playerInputSchema } from '../../shared/schemas/player'
import { getDb, isFirebaseConfigured } from '../utils/firebase'
import { getMemoryStore, memoryId } from '../utils/memory-store'
import { notFound, nowIso, parseEntity, parseEntityOrNull } from './_helpers'

/** Firestore collection 名稱。 */
const COLLECTION = 'players'

/**
 * 球員資料存取。
 *
 * 排序一律用 `comparePlayers()`（定義在 shared），前台名單、後台列表與
 * 打線挑人清單因此永遠是同一個順序。排序在記憶體中做而不是交給 Firestore：
 * 球員數量是數十人的量級，省下一個複合索引比較划算。
 */

export async function listPlayers(query: PlayerQueryOptions = {}): Promise<Player[]> {
  const all = await readAll()
  return all
    .filter((player) => (query.status ? player.status === query.status : true))
    .filter((player) => (query.position ? player.positions.includes(query.position) : true))
    .sort(comparePlayers)
}

export async function getPlayer(id: string): Promise<Player | null> {
  if (!isFirebaseConfigured()) {
    return getMemoryStore().players.get(id) ?? null
  }

  const db = await getDb()
  const doc = await db.collection(COLLECTION).doc(id).get()
  if (!doc.exists) return null
  return parseEntity(playerSchema, { ...doc.data(), id: doc.id }, 'player')
}

export async function createPlayer(input: PlayerInput): Promise<Player> {
  const data = playerInputSchema.parse(input)
  const timestamps = { createdAt: nowIso(), updatedAt: nowIso() }

  if (!isFirebaseConfigured()) {
    const store = getMemoryStore()
    const player: Player = { ...data, ...timestamps, id: memoryId('p') }
    store.players.set(player.id, player)
    return player
  }

  const db = await getDb()
  const ref = await db.collection(COLLECTION).add({ ...data, ...timestamps })
  return { ...data, ...timestamps, id: ref.id }
}

/**
 * 批次建立（名冊截圖辨識後一次匯入多位）。
 *
 * 一位失敗不該讓其他人也進不去，所以逐筆建立並回報成功的部分 ——
 * 與 `createGames()` 同一個作法。
 */
export async function createPlayers(inputs: PlayerInput[]): Promise<Player[]> {
  const created: Player[] = []
  for (const input of inputs) {
    created.push(await createPlayer(input))
  }
  return created
}

export async function updatePlayer(id: string, patch: PlayerPatch): Promise<Player> {
  const existing = await getPlayer(id)
  if (!existing) throw notFound('球員')

  const merged = playerSchema.parse({ ...existing, ...patch, updatedAt: nowIso() })

  if (!isFirebaseConfigured()) {
    getMemoryStore().players.set(id, merged)
    return merged
  }

  const db = await getDb()
  const { id: _id, ...payload } = merged
  await db.collection(COLLECTION).doc(id).set(payload, { merge: true })
  return merged
}

export async function deletePlayer(id: string): Promise<void> {
  const existing = await getPlayer(id)
  if (!existing) throw notFound('球員')

  if (!isFirebaseConfigured()) {
    getMemoryStore().players.delete(id)
    return
  }

  const db = await getDb()
  await db.collection(COLLECTION).doc(id).delete()
}

async function readAll(): Promise<Player[]> {
  if (!isFirebaseConfigured()) {
    return [...getMemoryStore().players.values()]
  }

  const db = await getDb()
  const snapshot = await db.collection(COLLECTION).get()
  return snapshot.docs
    .map((doc) => parseEntityOrNull(playerSchema, { ...doc.data(), id: doc.id }, 'player'))
    .filter((player): player is Player => player !== null)
}
