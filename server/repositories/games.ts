import {
  gameInputSchema,
  gameSchema,
  migrateLegacyGame,
  taipeiDateKey,
  withSummedRuns,
  type Game,
  type GameClip,
  type GameInput,
  type GamePatch,
  type GameQueryOptions,
} from '../../shared/schemas/game'
import { applyPlayDerivedScores } from '../../shared/schemas/box-score'
import { replaceHalfInning, type Play } from '../../shared/schemas/play'
import type { GameHalf } from '../../shared/schemas/half-inning'
import { getDb, isFirebaseConfigured } from '../utils/firebase'
import { getMemoryStore, memoryId } from '../utils/memory-store'
import { notFound, nowIso, parseEntity, parseEntityOrNull } from './_helpers'

const COLLECTION = 'games'

/**
 * 賽程／比賽資料存取。
 *
 * ## 排序方向刻意不同
 * - **未來場次**：日期由近到遠（下一場排最前面，這是使用者最想知道的）
 * - **已結束場次**：日期由新到舊（最新戰績排最前面）
 *
 * 兩個列表頁的直覺不一樣，所以排序寫在這裡而不是讓每個頁面自己決定。
 */

export async function listGames(query: GameQueryOptions = {}): Promise<Game[]> {
  const { scope = 'all', year, limit = 50 } = query
  // 用台北日期而不是伺服器本地日期：Cloud Run 跑在 UTC，台北時間半夜到
  // 早上八點之間，伺服器還停在前一天 —— 昨天打完的比賽會繼續掛在賽程頁上
  const today = taipeiDateKey()
  const all = await readAll()

  const filtered = all
    .filter((game) => (query.status ? game.status === query.status : true))
    .filter((game) => (year ? game.date.startsWith(String(year)) : true))
    .filter((game) => {
      if (scope === 'upcoming') {
        // 進行中的場次一律留在賽程裡，不看日期：它就是「現在正在打的那一場」，
        // 而賽程頁是唯一看得到它的地方。跨過午夜的比賽也才不會突然消失。
        if (game.status === 'live') return true
        return game.status === 'scheduled' && game.date >= today
      }
      // 延賽的場次也列在「過去」：那一天確實有安排過，只是沒打成。
      // 讓它從賽程頁消失又不出現在結果頁，等於整場比賽憑空不見了。
      if (scope === 'past') return game.status === 'finished' || game.status === 'postponed'
      return true
    })

  const ascending = scope === 'upcoming'
  filtered.sort((a, b) => {
    const diff = `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)
    return ascending ? diff : -diff
  })

  return filtered.slice(0, limit)
}

export async function getGame(id: string): Promise<Game | null> {
  if (!isFirebaseConfigured()) {
    return getMemoryStore().games.get(id) ?? null
  }

  const db = await getDb()
  const doc = await db.collection(COLLECTION).doc(id).get()
  if (!doc.exists) return null
  // 舊格式（`pitchers` 陣列）先轉成現在的形狀再驗證，見 `migrateLegacyGame()`
  return parseEntity(gameSchema, migrateLegacyGame({ ...doc.data(), id: doc.id }), 'game')
}

export async function createGame(input: GameInput): Promise<Game> {
  const data = withDerivedRuns(gameInputSchema.parse(input))
  const timestamps = { createdAt: nowIso(), updatedAt: nowIso() }

  if (!isFirebaseConfigured()) {
    const game: Game = {
      ...data,
      ...timestamps,
      remindersSent: [],
      clips: [],
      plays: [],
      id: memoryId('g'),
    }
    getMemoryStore().games.set(game.id, game)
    return game
  }

  const db = await getDb()
  const ref = await db.collection(COLLECTION).add({ ...data, ...timestamps })
  return { ...data, ...timestamps, remindersSent: [], clips: [], plays: [], id: ref.id }
}

export async function updateGame(id: string, patch: GamePatch): Promise<Game> {
  const existing = await getGame(id)
  if (!existing) throw notFound('比賽')

  const merged = withDerivedRuns(gameSchema.parse({ ...existing, ...patch, updatedAt: nowIso() }))

  if (!isFirebaseConfigured()) {
    getMemoryStore().games.set(id, merged)
    return merged
  }

  const db = await getDb()
  const { id: _id, ...payload } = merged
  await db.collection(COLLECTION).doc(id).set(payload, { merge: true })
  return merged
}

/**
 * 記下「這場的某種提醒已經送出去了」。
 *
 * 不走 `updateGame()`：那支會跑整份 schema 的驗證，而這裡要改的欄位
 * 刻意不在 input schema 裡（理由見 `gameSchema`）。
 * 只動這一個欄位，也不會把管理者同時在後台編輯的內容蓋掉。
 */
export async function markReminderSent(id: string, kind: string): Promise<void> {
  const existing = await getGame(id)
  if (!existing) throw notFound('比賽')
  if (existing.remindersSent.includes(kind)) return

  const remindersSent = [...existing.remindersSent, kind]

  if (!isFirebaseConfigured()) {
    getMemoryStore().games.set(id, { ...existing, remindersSent })
    return
  }

  const db = await getDb()
  await db.collection(COLLECTION).doc(id).set({ remindersSent }, { merge: true })
}

/**
 * 加一段錄影，或覆蓋同一個半局既有的那一段（重錄）。
 *
 * 不走 `updateGame()`：理由和 `markReminderSent()` 相同 —— 只動這一個欄位，
 * 不會把管理者同時在後台編輯的內容蓋掉。錄影頁和編輯頁很可能同時開著。
 */
export async function addGameClip(id: string, clip: GameClip): Promise<GameClip[]> {
  const existing = await getGame(id)
  if (!existing) throw notFound('比賽')

  // 同一個半局重錄時取代舊的，而不是疊上去 —— 否則前台會出現兩段一樣的
  const clips = [
    ...existing.clips.filter((item) => !(item.inning === clip.inning && item.half === clip.half)),
    clip,
  ]
  await saveClips(id, existing, clips)
  return clips
}

export async function removeGameClip(id: string, videoId: string): Promise<GameClip[]> {
  const existing = await getGame(id)
  if (!existing) throw notFound('比賽')

  const clips = existing.clips.filter((item) => item.videoId !== videoId)
  await saveClips(id, existing, clips)
  return clips
}

/** 更新片段的可見度（管理者在 YouTube Studio 改完之後同步回來）。 */
export async function setClipPrivacy(
  id: string,
  privacyByVideoId: Record<string, GameClip['privacy']>,
): Promise<GameClip[]> {
  const existing = await getGame(id)
  if (!existing) throw notFound('比賽')

  const clips = existing.clips.map((clip) =>
    privacyByVideoId[clip.videoId] ? { ...clip, privacy: privacyByVideoId[clip.videoId]! } : clip,
  )
  await saveClips(id, existing, clips)
  return clips
}

/**
 * 換掉一個半局的逐打席紀錄（空陣列＝清空那個半局）。
 *
 * ## 為什麼粒度是「一個半局」而不是「一筆打席」
 * 三個理由各自都足夠：
 *
 * 1. 一個半局就是自然的編輯單位 —— 打席會插入、刪除、重排，逐筆同步順序
 *    很麻煩，而順序在這裡是資料的一部分。
 * 2. **冪等**，所以離線重送天然安全。球場的行動網路上，失敗是常態
 *    （這條規則整個專案都適用，見 `docs/game-recording-plan.md`）。
 * 3. 和 `addGameClip()` 以 `(inning, half)` 為鍵覆蓋是**同一個身分概念** ——
 *    影片與打席講的是同一個半局，兩者可以直接對齊。
 *
 * ## 為什麼不走 `updateGame()`
 * 和 `addGameClip()`、`markReminderSent()` 相同：只動這一個欄位，不會把
 * 管理者同時在別的分頁編輯的內容蓋掉。逐局紀錄頁和編輯頁很可能同時開著。
 *
 * ⚠️ 計分板要跟著寫回去。逐局得分是由打席推導的（`applyPlayDerivedScores()`），
 * 只寫 `plays` 的話，資料庫裡的計分板會停在改動之前的數字 —— 而前台的
 * 比數、勝敗、戰績全部讀它。
 */
export async function saveHalfInningPlays(
  id: string,
  inning: number,
  half: GameHalf,
  plays: Play[],
): Promise<Pick<Game, 'plays' | 'scoreboard'>> {
  const existing = await getGame(id)
  if (!existing) throw notFound('比賽')

  const next = replaceHalfInning(existing.plays, inning, half, plays)
  const { scoreboard } = withDerivedRuns({ ...existing, plays: next })
  const payload = { plays: next, scoreboard }

  if (!isFirebaseConfigured()) {
    getMemoryStore().games.set(id, { ...existing, ...payload })
    return payload
  }

  const db = await getDb()
  await db.collection(COLLECTION).doc(id).set(payload, { merge: true })
  return payload
}

async function saveClips(id: string, existing: Game, clips: GameClip[]): Promise<void> {
  if (!isFirebaseConfigured()) {
    getMemoryStore().games.set(id, { ...existing, clips })
    return
  }

  const db = await getDb()
  await db.collection(COLLECTION).doc(id).set({ clips }, { merge: true })
}

export async function deleteGame(id: string): Promise<void> {
  const existing = await getGame(id)
  if (!existing) throw notFound('比賽')

  if (!isFirebaseConfigured()) {
    getMemoryStore().games.delete(id)
    return
  }

  const db = await getDb()
  await db.collection(COLLECTION).doc(id).delete()
}

/**
 * 批次建立（AI 辨識賽程圖後一次匯入多場）。
 *
 * 一場失敗不該讓其他場也進不去，所以逐筆建立並回報成功的部分。
 */
export async function createGames(inputs: GameInput[]): Promise<Game[]> {
  const created: Game[] = []
  for (const input of inputs) {
    created.push(await createGame(input))
  }
  return created
}

/**
 * 計分板的推導鏈，一條單向的路：
 *
 * ```
 * 逐打席 → applyPlayDerivedScores() → 逐局得分 → withSummedRuns() → R
 * ```
 *
 * 放在 repository 而不是端點或表單：不論從哪個入口寫入（後台表單、AI 辨識
 * 計分板照片、批次匯入、逐局紀錄頁），存進去的資料都保證一致。前台的比數、
 * 勝敗、戰績全部讀 R，它一旦和逐局對不上，錯的是整個網站而不只是那張表格。
 *
 * ⚠️ **順序不能反。** 先套逐打席、再加總 R —— 反過來的話，R 會是套用逐打席
 * **之前**那份逐局得分的總和，而畫面上那兩個數字會安靜地對不起來。
 */
function withDerivedRuns<
  T extends { scoreboard: Game['scoreboard']; homeAway: Game['homeAway']; plays?: Game['plays'] },
>(game: T): T {
  const scoreboard = applyPlayDerivedScores({
    scoreboard: game.scoreboard,
    homeAway: game.homeAway,
    plays: game.plays ?? [],
  })
  return { ...game, scoreboard: withSummedRuns(scoreboard) }
}

async function readAll(): Promise<Game[]> {
  if (!isFirebaseConfigured()) {
    return [...getMemoryStore().games.values()]
  }

  const db = await getDb()
  const snapshot = await db.collection(COLLECTION).get()
  return snapshot.docs
    .map((doc) =>
      parseEntityOrNull(gameSchema, migrateLegacyGame({ ...doc.data(), id: doc.id }), 'game'),
    )
    .filter((game): game is Game => game !== null)
}
