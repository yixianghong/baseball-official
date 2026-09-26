/**
 * 把示範資料寫進 Firestore。
 *
 * 剛接上 Firebase 時資料庫是空的，網站看起來會像壞掉一樣。這支腳本建立一份
 * 完整的示範內容（球員、賽程、戰績、公告），讓你先看到版面實際的樣子，
 * 再逐筆換成真實資料。
 *
 * ## 用法
 * ```bash
 * pnpm seed              # 只顯示將寫入什麼，不動資料庫
 * pnpm seed --confirm    # 實際寫入
 * ```
 *
 * ## 安全設計
 * - 預設是「預演」模式，要明確加上 `--confirm` 才會寫入
 * - 任何一個 collection 已經有資料就整個中止，不會覆蓋你既有的內容
 * - `siteSettings` 只在完全不存在時才建立 —— 你上傳的隊徽與填的隊名不會被蓋掉
 *
 * 這份種子內容與 `server/utils/memory-store.ts`（沒有憑證時的記憶體資料）
 * 刻意保持一致，兩邊要改請一起改。
 */
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const CONFIRM = process.argv.includes('--confirm')

// ── 讀取設定 ────────────────────────────────────────────────────────────
const projectId = process.env.NUXT_FIREBASE_PROJECT_ID
const clientEmail = process.env.NUXT_FIREBASE_CLIENT_EMAIL
const privateKey = process.env.NUXT_FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')

if (!projectId || !clientEmail || !privateKey) {
  console.error(
    '\n[錯誤] 缺少 Firebase 憑證。\n' +
      '請確認 .env 內有 NUXT_FIREBASE_PROJECT_ID、NUXT_FIREBASE_CLIENT_EMAIL、' +
      'NUXT_FIREBASE_PRIVATE_KEY（見 README 的「Firebase 設定」）。\n',
  )
  process.exit(1)
}

// ── 種子資料 ────────────────────────────────────────────────────────────
const NOW = new Date().toISOString()

/** 以今天為基準位移天數，回傳 `YYYY-MM-DD`（當地時區）。 */
function dayOffset(days) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${m}-${d}`
}

function isoOffset(days) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return date.toISOString()
}

function player(number, name, positions, extra = {}) {
  return {
    number,
    name,
    positions,
    bats: 'R',
    throws: 'R',
    joinedYear: new Date().getFullYear() - 2,
    bio: '',
    photoUrl: '',
    status: 'active',
    sortOrder: 0,
    createdAt: NOW,
    updatedAt: NOW,
    ...extra,
  }
}

const PLAYERS = [
  player('1', '陳冠宇', ['P'], { throws: 'L', bats: 'L', bio: '球隊王牌左投，控球穩定。' }),
  player('2', '林建良', ['C'], { bio: '捕手兼隊長，配球經驗豐富。' }),
  player('5', '王柏翔', ['1B', 'DH'], { bats: 'L' }),
  player('7', '張志豪', ['2B'], { bio: '守備範圍大，上壘率高。' }),
  player('9', '李承翰', ['SS'], { bats: 'S' }),
  player('12', '黃威霖', ['3B']),
  player('15', '吳政憲', ['LF', 'CF']),
  player('18', '劉家豪', ['CF'], { bats: 'L', throws: 'L' }),
  player('21', '蔡孟哲', ['RF']),
  player('24', '鄭凱文', ['P'], { bio: '主要後援投手。' }),
  player('31', '許書豪', ['2B', '3B']),
  player('44', '謝明宏', ['P'], { status: 'inactive', bio: '因傷休養中。' }),
]

const emptyScoreboard = {
  innings: [],
  totals: { our: { r: 0, h: 0, e: 0 }, opponent: { r: 0, h: 0, e: 0 } },
}

function game(overrides) {
  return {
    time: '09:00',
    venue: '',
    league: '春季聯賽',
    homeAway: 'home',
    status: 'scheduled',
    note: '',
    coverImageUrl: '',
    opponentLogoUrl: '',
    attendance: [],
    lineup: [],
    pitchers: [],
    batters: [],
    scoreboard: emptyScoreboard,
    result: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

/** 依球員在陣列中的位置組出打線（寫入時存姓名快照，與後台的行為一致）。 */
function lineupFrom(indexes, playerIds) {
  return indexes.map((playerIndex, order) => {
    const p = PLAYERS[playerIndex]
    return {
      order: order + 1,
      playerId: playerIds[playerIndex] ?? '',
      name: p.name,
      number: p.number,
      position: p.positions[0],
    }
  })
}

/**
 * 打擊紀錄，順序比照打線。
 *
 * `notes` 是**純文字**（「4 打數 2 安打」這種句子），系統不解析也不加總 ——
 * 理由寫在 `shared/schemas/game.ts` 的 `batterEntrySchema` 上。
 */
function battersFrom(indexes, playerIds, notes) {
  return indexes.map((playerIndex, order) => {
    const p = PLAYERS[playerIndex]
    return {
      playerId: playerIds[playerIndex] ?? '',
      name: p.name,
      number: p.number,
      note: notes[order] ?? '',
    }
  })
}

function attendanceFrom(statuses, playerIds) {
  return PLAYERS.map((p, index) => ({ p, index }))
    .filter(({ p }) => p.status === 'active')
    .map(({ p, index }) => ({
      playerId: playerIds[index] ?? '',
      name: p.name,
      number: p.number,
      status: statuses[index] ?? 'pending',
      note: '',
    }))
}

const ANNOUNCEMENTS = [
  {
    title: '春季聯賽開打，週日集合時間調整',
    content:
      '本週日的比賽集合時間提前至上午 08:00，請各位隊員準時到場進行熱身與傳接球。\n\n當天球場有其他隊伍使用，停車位有限，建議共乘或搭乘大眾運輸。',
    category: 'game',
    pinned: true,
    status: 'published',
    publishedAt: isoOffset(-2),
    coverImageUrl: '',
    createdAt: isoOffset(-2),
    updatedAt: isoOffset(-2),
  },
  {
    title: '例行練習時間異動公告',
    content:
      '因球場整修，本月起週三練習改至河濱球場進行，時間維持 19:00–21:00。\n\n請隊員自行前往，需要共乘的隊員請在群組登記。',
    category: 'training',
    pinned: false,
    status: 'published',
    publishedAt: isoOffset(-9),
    coverImageUrl: '',
    createdAt: isoOffset(-9),
    updatedAt: isoOffset(-9),
  },
  {
    title: '球隊招募新血',
    content:
      '本季開放招募新隊員，不限守備位置，歡迎有基礎的球友加入。\n\n有意者請透過官網聯絡信箱與我們聯繫，或直接到週三的練習現場找教練團。',
    category: 'recruit',
    pinned: false,
    status: 'published',
    publishedAt: isoOffset(-16),
    coverImageUrl: '',
    createdAt: isoOffset(-16),
    updatedAt: isoOffset(-16),
  },
  {
    title: '年度隊聚與頒獎典禮',
    content: '年度隊聚訂於下個月舉行，將同時頒發本季最佳打者與最佳投手獎項。詳細地點另行公告。',
    category: 'event',
    pinned: false,
    status: 'published',
    publishedAt: isoOffset(-25),
    coverImageUrl: '',
    createdAt: isoOffset(-25),
    updatedAt: isoOffset(-25),
  },
]

// ── 主流程 ──────────────────────────────────────────────────────────────
const app =
  getApps()[0] ??
  initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) })
const db = getFirestore(app)

console.log(`\n專案：${projectId}`)
console.log(CONFIRM ? '模式：實際寫入\n' : '模式：預演（不會寫入任何資料）\n')

// 安全檢查：任何一個 collection 有資料就中止，不覆蓋既有內容
const collections = ['players', 'games', 'announcements']
for (const name of collections) {
  const snapshot = await db.collection(name).limit(1).get()
  if (!snapshot.empty) {
    console.error(
      `[中止] collection「${name}」已經有資料了。\n` +
        '這支腳本只用於建立初始示範內容，不會覆蓋既有資料。\n' +
        '若確定要重新開始，請先在 Firebase Console 清空該 collection。\n',
    )
    process.exit(1)
  }
}

const settingsRef = db.collection('siteSettings').doc('main')
const settingsSnapshot = await settingsRef.get()
const settingsExists = settingsSnapshot.exists

console.log('將建立：')
console.log(`  players        ${PLAYERS.length} 筆`)
console.log('  games          6 筆（3 場已結束、3 場待打）')
console.log(`  announcements  ${ANNOUNCEMENTS.length} 筆`)
console.log(
  settingsExists
    ? '  siteSettings   略過（已存在，不覆蓋你設定的隊名與隊徽）'
    : '  siteSettings   1 筆（預設隊名與簡介，之後可在後台修改）',
)

if (!CONFIRM) {
  console.log('\n以上都還沒寫入。確認無誤後執行：\n  pnpm seed --confirm\n')
  process.exit(0)
}

// --- 球員 ---
const playerIds = []
for (const data of PLAYERS) {
  const ref = await db.collection('players').add(data)
  playerIds.push(ref.id)
}
console.log(`\n✓ players 已建立 ${playerIds.length} 筆`)

// --- 比賽 ---
const starters = [3, 4, 2, 5, 8, 7, 6, 1, 0]
const GAMES = [
  game({
    date: dayOffset(7),
    opponent: '藍鷹棒球隊',
    venue: '市立棒球場',
    note: '請提前 30 分鐘到場熱身。',
    attendance: attendanceFrom(
      { 0: 'yes', 1: 'yes', 2: 'yes', 3: 'yes', 4: 'maybe', 5: 'yes', 6: 'no', 7: 'yes', 8: 'yes', 9: 'yes' },
      playerIds,
    ),
    lineup: lineupFrom(starters, playerIds),
  }),
  game({
    date: dayOffset(21),
    time: '13:30',
    opponent: '紅獅隊',
    venue: '大安運動中心球場',
    homeAway: 'away',
    attendance: attendanceFrom({ 0: 'yes', 1: 'yes', 3: 'maybe' }, playerIds),
  }),
  game({
    date: dayOffset(35),
    time: '10:30',
    opponent: '金剛棒球隊',
    venue: '新莊棒球場',
    homeAway: 'away',
  }),
  game({
    date: dayOffset(-6),
    opponent: '黑豹棒球隊',
    venue: '市立棒球場',
    status: 'finished',
    note: '延長賽驚險獲勝。',
    lineup: lineupFrom(starters, playerIds),
    pitchers: [
      { playerId: playerIds[0], name: '陳冠宇', number: '1', role: 'starter', note: '6 局 2 失分' },
      { playerId: playerIds[9], name: '鄭凱文', number: '24', role: 'closer', note: '2 局無失分' },
    ],
    // 備註是純文字，系統不解析也不加總（見 `batterEntrySchema`）
    batters: battersFrom(starters, playerIds, [
      '4 打數 2 安打 1 打點',
      '4 打數 1 安打 2 打點',
      '3 打數 1 安打 1 得分',
      '4 打數無安打',
      '3 打數 2 安打 1 二壘打',
      '4 打數 1 安打',
      '3 打數無安打 1 四壞',
      '3 打數 1 安打 2 打點',
      '3 打數無安打',
    ]),
    scoreboard: {
      innings: [
        { inning: 1, our: 0, opponent: 1 },
        { inning: 2, our: 2, opponent: 0 },
        { inning: 3, our: 0, opponent: 0 },
        { inning: 4, our: 1, opponent: 1 },
        { inning: 5, our: 0, opponent: 0 },
        { inning: 6, our: 0, opponent: 1 },
        { inning: 7, our: 1, opponent: 0 },
        { inning: 8, our: 2, opponent: 0 },
      ],
      totals: { our: { r: 6, h: 9, e: 1 }, opponent: { r: 3, h: 6, e: 2 } },
    },
    result: 'win',
  }),
  game({
    date: dayOffset(-20),
    time: '15:00',
    opponent: '金剛棒球隊',
    venue: '新莊棒球場',
    homeAway: 'away',
    status: 'finished',
    lineup: lineupFrom([4, 3, 2, 5, 7, 8, 6, 1, 9], playerIds),
    pitchers: [{ playerId: playerIds[9], name: '鄭凱文', number: '24', role: 'starter', note: '' }],
    scoreboard: {
      innings: [
        { inning: 1, our: 0, opponent: 0 },
        { inning: 2, our: 1, opponent: 3 },
        { inning: 3, our: 0, opponent: 0 },
        { inning: 4, our: 2, opponent: 1 },
        { inning: 5, our: 0, opponent: 2 },
        { inning: 6, our: 1, opponent: 0 },
        { inning: 7, our: 0, opponent: null },
      ],
      totals: { our: { r: 4, h: 7, e: 3 }, opponent: { r: 6, h: 10, e: 1 } },
    },
    result: 'loss',
  }),
  game({
    date: dayOffset(-34),
    opponent: '飛鷹隊',
    venue: '市立棒球場',
    league: '熱身賽',
    status: 'finished',
    lineup: lineupFrom([3, 4, 2, 8, 5, 7, 6, 1, 0], playerIds),
    pitchers: [{ playerId: playerIds[0], name: '陳冠宇', number: '1', role: 'starter', note: '' }],
    scoreboard: {
      innings: [
        { inning: 1, our: 1, opponent: 1 },
        { inning: 2, our: 0, opponent: 0 },
        { inning: 3, our: 2, opponent: 1 },
        { inning: 4, our: 0, opponent: 1 },
        { inning: 5, our: 1, opponent: 1 },
        { inning: 6, our: 0, opponent: 0 },
        { inning: 7, our: 0, opponent: 0 },
      ],
      totals: { our: { r: 4, h: 8, e: 2 }, opponent: { r: 4, h: 8, e: 2 } },
    },
    result: 'tie',
  }),
]

for (const data of GAMES) {
  await db.collection('games').add(data)
}
console.log(`✓ games 已建立 ${GAMES.length} 筆`)

// --- 公告 ---
for (const data of ANNOUNCEMENTS) {
  await db.collection('announcements').add(data)
}
console.log(`✓ announcements 已建立 ${ANNOUNCEMENTS.length} 筆`)

// --- 網站設定（只在不存在時建立）---
if (!settingsExists) {
  await settingsRef.set({
    teamName: '我的球隊',
    shortName: '',
    aliases: '',
    slogan: '每一球都全力以赴',
    intro: '請到後台的「網站設定」修改這段球隊簡介。',
    logoUrl: '',
    logoPlate: false,
    heroImageUrl: '',
    foundedYear: new Date().getFullYear() - 8,
    homeField: '',
    contactEmail: '',
    socialLinks: [],
    updatedAt: NOW,
  })
  console.log('✓ siteSettings 已建立')
} else {
  console.log('· siteSettings 已存在，未變更')
}

console.log('\n完成。重新整理網站就能看到內容了。\n')
process.exit(0)
