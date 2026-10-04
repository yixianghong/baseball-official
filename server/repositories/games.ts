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
  type AttendanceEntry,
  type HalfInningNarrative,
  attendanceEntrySchema,
} from '../../shared/schemas/game'
import { applyPlayDerivedScores } from '../../shared/schemas/box-score'
import {
  applyAttendanceAnswer,
  type AttendanceAnswer,
} from '../../shared/schemas/attendance-request'
import { mergeAttendanceWithRoster } from '../../shared/schemas/attendance'
import { listPlayers } from './players'
import { replaceHalfInning, type Play } from '../../shared/schemas/play'
import type { GameHalf } from '../../shared/schemas/half-inning'
import { getDb, isFirebaseConfigured } from '../utils/firebase'
import { getMemoryStore, memoryId } from '../utils/memory-store'
import { notFound, nowIso, parseEntity, parseEntityOrNull } from './_helpers'

const COLLECTION = 'games'

/** 交易裡只驗這一個欄位，不跑整份 `gameSchema`（見 `answerAttendance()`）。 */
const attendanceListSchema = attendanceEntrySchema.array()

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

/**
 * 新增一場比賽。
 *
 * ⚠️ **沒帶出席名單時，自動補上現役名冊（全部「未回覆」）。**
 * 隊員是在前台**自己**回報出席的（`PUT /api/games/[id]/attendance`），而那支
 * 端點只能改「已經在名單上的那個人」—— 它不能把人加進名單，否則就變成一支
 * 匿名的任意寫入。所以名單必須在比賽建好的那一刻就在。
 *
 * 少了這一步，一場剛建好的比賽前台是「尚未開始統計出席」，沒有任何人可以點
 * —— 而賽前提醒是排程自動送出的，**不保證**管理者在那之前開過出席分頁
 * （開過才會由 `mergeAttendanceWithRoster()` 補上）。
 *
 * 之後才入隊的新隊員由後台出席分頁補（同一支純函式），所以兩邊的規則是同一條。
 */
export async function createGame(input: GameInput): Promise<Game> {
  const parsed = gameInputSchema.parse(input)
  const data = withDerivedRuns({
    ...parsed,
    attendance: parsed.attendance.length ? parsed.attendance : await rosterAttendance(),
  })
  const timestamps = { createdAt: nowIso(), updatedAt: nowIso() }

  if (!isFirebaseConfigured()) {
    const game: Game = {
      ...data,
      ...timestamps,
      remindersSent: [],
      clips: [],
      plays: [],
      narratives: [],
      id: memoryId('g'),
    }
    getMemoryStore().games.set(game.id, game)
    return game
  }

  const db = await getDb()
  const ref = await db.collection(COLLECTION).add({ ...data, ...timestamps })
  return {
    ...data,
    ...timestamps,
    remindersSent: [],
    clips: [],
    plays: [],
    narratives: [],
    id: ref.id,
  }
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
 * 隊員自己回報出席（`PUT /api/games/[id]/attendance`，不需要登入）。
 *
 * 不走 `updateGame()`：理由和 `markReminderSent()` 相同 —— 只動 `attendance`
 * 這一個欄位，不會把管理者同時在後台編輯的打線或計分板蓋掉。
 *
 * ## ⚠️ 這支一定要用 transaction，別的欄位不必
 * `addGameClip()` 那幾支是「同一個人在同一台裝置上依序操作」，讀出來再寫回去
 * 中間不會有別人。出席相反：**提醒推播是同一時間送給所有人的**，十幾個隊員
 * 會在同一分鐘內各自按下去。讀-改-寫沒有交易保護的話，兩個人同時按就會有一個
 * 被後寫的那份整個陣列蓋掉 —— 而他看到的畫面是「我按了，也成功了」，
 * 隔天才發現自己不在名單上。這種錯誤沒有任何錯誤訊息。
 *
 * 名單上沒有這個 `playerId` 時回 `null`（端點據此回 404）——
 * 這支端點只能改既有的那幾筆，不能把新的人塞進名單。
 */
export async function answerAttendance(
  id: string,
  answer: AttendanceAnswer,
): Promise<AttendanceEntry[] | null> {
  if (!isFirebaseConfigured()) {
    const existing = getMemoryStore().games.get(id)
    if (!existing) throw notFound('比賽')
    const attendance = applyAttendanceAnswer(existing.attendance, answer)
    if (!attendance) return null
    getMemoryStore().games.set(id, { ...existing, attendance })
    return attendance
  }

  const db = await getDb()
  const ref = db.collection(COLLECTION).doc(id)

  return db.runTransaction(async (tx) => {
    const doc = await tx.get(ref)
    if (!doc.exists) throw notFound('比賽')

    /*
     * 交易裡只取 `attendance` 這一個欄位來算，不跑整份 `gameSchema.parse()`
     * —— 舊文件上可能有過不了現行 schema 的殘留欄位，而那不該讓一個
     * 「我會到」寫不進去。
     */
    const current = attendanceListSchema.parse(doc.data()?.attendance ?? [])
    const attendance = applyAttendanceAnswer(current, answer)
    if (!attendance) return null

    tx.set(ref, { attendance }, { merge: true })
    return attendance
  })
}

/**
 * 存下一個半局的賽況敘述，或覆蓋既有的那一段（重新產生）。
 *
 * 以「第幾局的哪半局」為鍵，和 `addGameClip()` 完全同一套 —— 重新產生就蓋掉
 * 同一格，不會疊第二筆。空字串＝把那一格刪掉。
 *
 * 不走 `updateGame()`：`narratives` 刻意不在 `gameInputSchema` 裡（和 `clips`、
 * `plays` 同一個理由），而且只動這一個欄位才不會蓋掉管理者同時在別處編輯的內容。
 */
export async function saveHalfInningNarrative(
  id: string,
  inning: number,
  half: GameHalf,
  text: string,
): Promise<HalfInningNarrative[]> {
  const existing = await getGame(id)
  if (!existing) throw notFound('比賽')

  const rest = existing.narratives.filter((item) => !(item.inning === inning && item.half === half))
  const narratives = text ? [...rest, { inning, half, text, createdAt: nowIso() }] : rest

  if (!isFirebaseConfigured()) {
    getMemoryStore().games.set(id, { ...existing, narratives })
    return narratives
  }

  const db = await getDb()
  await db.collection(COLLECTION).doc(id).set({ narratives }, { merge: true })
  return narratives
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

  /*
   * ⚠️ **打席一變，那一格的賽況敘述就要丟掉。**
   *
   * 敘述是從打席寫出來的，而**前台看得到它** —— 改完打席還留著舊的那一段，
   * 等於對訪客說一件沒有發生過的事，而且它讀起來非常像真的（AI 寫的）。
   * 「寧可空白，也不要一段看起來很專業但是錯的文字」和「登錄不完整就不顯示
   * 打擊率」是同一條原則。
   *
   * 代價是調一下得分就要重新產生一次（約 US$0.003）。用「標記為過時」代替
   * 刪除的話，就得同時決定前台要不要顯示過時的那一段 —— 而那個問題沒有好答案。
   */
  const narratives = existing.narratives.filter(
    (item) => !(item.inning === inning && item.half === half),
  )
  const payload = { plays: next, scoreboard, narratives }

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
 * 現役名冊轉成一份「全部未回覆」的出席名單。
 *
 * 名冊讀不到時回空陣列而不是拋錯 —— 建比賽是主要的動作，出席名單只是順手
 * 補上的方便。為了它讓「新增比賽」整個失敗，代價和收益完全不成比例
 * （後台開一次出席分頁就補回來了）。
 */
async function rosterAttendance(): Promise<Game['attendance']> {
  try {
    return mergeAttendanceWithRoster([], await listPlayers())
  } catch {
    return []
  }
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
