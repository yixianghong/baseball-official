import type { Player } from '../../shared/schemas/player'
import type { Game } from '../../shared/schemas/game'
import type { Announcement } from '../../shared/schemas/announcement'
import type { SiteSettings } from '../../shared/schemas/settings'
import type { PushSubscriptionRecord } from '../../shared/schemas/push'
import { DEFAULT_SITE_SETTINGS } from '../../shared/schemas/settings'
import { toDateKey } from '../../shared/schemas/game'

/**
 * 沒有 Firebase 憑證時使用的記憶體資料層。
 *
 * ## 用途
 * 1. **開箱即跑**：clone 下來、還沒去 Firebase Console 開專案就能看到完整網站
 * 2. **測試不必依賴外部服務**：e2e 直接跑這一份，不需要 Firestore emulator
 *
 * ## 限制（刻意的）
 * 資料存在程序記憶體中，重啟即失，多實例之間也不共用。
 * 這只適合開發與測試；production 缺少憑證會在啟動時就被
 * `server/plugins/00.env-validate.ts` 擋下，不會悄悄跑在這個模式上。
 *
 * ## 種子資料的日期是相對今天算的
 * 寫死日期的話，示範資料過幾個月就全部變成「過去的比賽」，
 * 「近期賽程」頁會空掉。這裡固定產生兩場未來、三場已結束的比賽。
 */

export interface MemoryStore {
  players: Map<string, Player>
  games: Map<string, Game>
  announcements: Map<string, Announcement>
  settings: SiteSettings
  /** 推播訂閱。key 是 endpoint 的雜湊（見 `server/repositories/push-subscriptions.ts`）。 */
  pushSubscriptions: Map<string, PushSubscriptionRecord>
}

let store: MemoryStore | null = null

/** 取得記憶體資料（首次呼叫時建立種子資料）。 */
export function getMemoryStore(): MemoryStore {
  if (!store) store = createSeedStore()
  return store
}

/** 測試用：清空並重新產生種子資料。 */
export function resetMemoryStore(): void {
  store = null
}

/** 產生記憶體模式用的流水號 ID。 */
export function memoryId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}

/** 以今天為基準位移天數，回傳 `YYYY-MM-DD`。 */
function dayOffset(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return toDateKey(date)
}

function isoOffset(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return date.toISOString()
}

const NOW = new Date().toISOString()

function player(
  id: string,
  number: string,
  name: string,
  positions: Player['positions'],
  overrides: Partial<Player> = {},
): Player {
  return {
    id,
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
    ...overrides,
  }
}

function createSeedStore(): MemoryStore {
  const players: Player[] = [
    player('p1', '1', '陳冠宇', ['P'], { throws: 'L', bats: 'L', bio: '球隊王牌左投，控球穩定。' }),
    player('p2', '2', '林建良', ['C'], { bio: '捕手兼隊長，配球經驗豐富。' }),
    player('p3', '5', '王柏翔', ['1B', 'DH'], { bats: 'L' }),
    player('p4', '7', '張志豪', ['2B'], { bio: '守備範圍大，上壘率高。' }),
    player('p5', '9', '李承翰', ['SS'], { bats: 'S' }),
    player('p6', '12', '黃威霖', ['3B']),
    player('p7', '15', '吳政憲', ['LF', 'CF']),
    player('p8', '18', '劉家豪', ['CF'], { bats: 'L', throws: 'L' }),
    player('p9', '21', '蔡孟哲', ['RF']),
    player('p10', '24', '鄭凱文', ['P'], { bio: '主要後援投手。' }),
    player('p11', '31', '許書豪', ['2B', '3B'], { status: 'active' }),
    player('p12', '44', '謝明宏', ['P'], { status: 'inactive', bio: '因傷休養中。' }),
  ]

  const lineupFrom = (ids: string[]) =>
    ids.map((id, index) => {
      const p = players.find((item) => item.id === id)!
      return {
        order: index + 1,
        playerId: p.id,
        name: p.name,
        number: p.number,
        position: p.positions[0]!,
      }
    })

  const attendanceFrom = (statuses: Record<string, Game['attendance'][number]['status']>) =>
    players
      .filter((p) => p.status === 'active')
      .map((p) => ({
        playerId: p.id,
        name: p.name,
        number: p.number,
        status: statuses[p.id] ?? 'pending',
        note: '',
      }))

  const games: Game[] = [
    {
      id: 'g1',
      date: dayOffset(7),
      time: '09:00',
      opponent: '藍鷹棒球隊',
      venue: '市立棒球場',
      mapUrl: '',
      city: '新北市',
      league: '春季聯賽',
      homeAway: 'home',
      status: 'scheduled',
      note: '請提前 30 分鐘到場熱身。',
      coverImageUrl: '',
      opponentLogoUrl: '',
      remindersSent: [],
      attendance: attendanceFrom({
        p1: 'yes',
        p2: 'yes',
        p3: 'yes',
        p4: 'yes',
        p5: 'maybe',
        p6: 'yes',
        p7: 'no',
        p8: 'yes',
        p9: 'yes',
        p10: 'yes',
      }),
      lineup: lineupFrom(['p4', 'p5', 'p3', 'p6', 'p9', 'p8', 'p7', 'p2', 'p1']),
      pitchers: [],
      scoreboard: {
        innings: [],
        totals: { our: { r: 0, h: 0, e: 0 }, opponent: { r: 0, h: 0, e: 0 } },
      },
      createdAt: NOW,
      updatedAt: NOW,
    },
    {
      id: 'g2',
      date: dayOffset(21),
      time: '13:30',
      opponent: '紅獅隊',
      venue: '大安運動中心球場',
      mapUrl: '',
      city: '臺北市',
      league: '春季聯賽',
      homeAway: 'away',
      status: 'scheduled',
      note: '',
      coverImageUrl: '',
      opponentLogoUrl: '',
      remindersSent: [],
      attendance: attendanceFrom({ p1: 'yes', p2: 'yes', p4: 'maybe' }),
      lineup: [],
      pitchers: [],
      scoreboard: {
        innings: [],
        totals: { our: { r: 0, h: 0, e: 0 }, opponent: { r: 0, h: 0, e: 0 } },
      },
      createdAt: NOW,
      updatedAt: NOW,
    },
    {
      id: 'g6',
      date: dayOffset(35),
      time: '10:30',
      opponent: '金剛棒球隊',
      venue: '新莊棒球場',
      mapUrl: '',
      city: '桃園市',
      league: '春季聯賽',
      homeAway: 'away',
      status: 'scheduled',
      note: '',
      coverImageUrl: '',
      opponentLogoUrl: '',
      remindersSent: [],
      attendance: [],
      lineup: [],
      pitchers: [],
      scoreboard: {
        innings: [],
        totals: { our: { r: 0, h: 0, e: 0 }, opponent: { r: 0, h: 0, e: 0 } },
      },
      createdAt: NOW,
      updatedAt: NOW,
    },
    {
      id: 'g7',
      date: dayOffset(-13),
      time: '09:00',
      opponent: '雷雨隊',
      venue: '市立棒球場',
      mapUrl: '',
      city: '新北市',
      league: '春季聯賽',
      homeAway: 'home',
      status: 'postponed',
      note: '當天大雨，擇期再賽。',
      coverImageUrl: '',
      opponentLogoUrl: '',
      remindersSent: [],
      attendance: [],
      lineup: [],
      pitchers: [],
      scoreboard: {
        innings: [],
        totals: { our: { r: 0, h: 0, e: 0 }, opponent: { r: 0, h: 0, e: 0 } },
      },
      createdAt: NOW,
      updatedAt: NOW,
    },
    {
      id: 'g3',
      date: dayOffset(-6),
      time: '09:00',
      opponent: '黑豹棒球隊',
      venue: '市立棒球場',
      mapUrl: '',
      city: '臺北市',
      league: '春季聯賽',
      homeAway: 'home',
      status: 'finished',
      note: '延長賽驚險獲勝。',
      coverImageUrl: '',
      opponentLogoUrl: '',
      remindersSent: [],
      attendance: [],
      lineup: lineupFrom(['p4', 'p5', 'p3', 'p6', 'p9', 'p8', 'p7', 'p2', 'p1']),
      pitchers: [
        { playerId: 'p1', name: '陳冠宇', number: '1', role: 'starter', note: '6 局 2 失分' },
        { playerId: 'p10', name: '鄭凱文', number: '24', role: 'closer', note: '2 局無失分' },
      ],
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
      createdAt: NOW,
      updatedAt: NOW,
    },
    {
      id: 'g4',
      date: dayOffset(-20),
      time: '15:00',
      opponent: '金剛棒球隊',
      venue: '新莊棒球場',
      mapUrl: '',
      city: '新北市',
      league: '春季聯賽',
      homeAway: 'away',
      status: 'finished',
      note: '',
      coverImageUrl: '',
      opponentLogoUrl: '',
      remindersSent: [],
      attendance: [],
      lineup: lineupFrom(['p5', 'p4', 'p3', 'p6', 'p8', 'p9', 'p7', 'p2', 'p10']),
      pitchers: [{ playerId: 'p10', name: '鄭凱文', number: '24', role: 'starter', note: '' }],
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
      createdAt: NOW,
      updatedAt: NOW,
    },
    {
      id: 'g5',
      date: dayOffset(-34),
      time: '09:00',
      opponent: '飛鷹隊',
      venue: '市立棒球場',
      mapUrl: '',
      city: '臺中市',
      league: '熱身賽',
      homeAway: 'home',
      status: 'finished',
      note: '',
      coverImageUrl: '',
      opponentLogoUrl: '',
      remindersSent: [],
      attendance: [],
      lineup: lineupFrom(['p4', 'p5', 'p3', 'p9', 'p6', 'p8', 'p7', 'p2', 'p1']),
      pitchers: [{ playerId: 'p1', name: '陳冠宇', number: '1', role: 'starter', note: '' }],
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
      createdAt: NOW,
      updatedAt: NOW,
    },
  ]

  const announcements: Announcement[] = [
    {
      id: 'a1',
      title: '春季聯賽開打，週日集合時間調整',
      content:
        '本週日對戰藍鷹棒球隊，集合時間提前至上午 08:00，請各位隊員準時到場進行熱身與傳接球。\n\n當天球場有其他隊伍使用，停車位有限，建議共乘或搭乘大眾運輸。',
      category: 'game',
      pinned: true,
      status: 'published',
      publishedAt: isoOffset(-2),
      coverImageUrl: '',
      attachments: [],
      createdAt: isoOffset(-2),
      updatedAt: isoOffset(-2),
    },
    {
      id: 'a2',
      title: '例行練習時間異動公告',
      content:
        '因球場整修，本月起週三練習改至河濱球場進行，時間維持 19:00–21:00。\n\n請隊員自行前往，需要共乘的隊員請在群組登記。',
      category: 'training',
      pinned: false,
      status: 'published',
      publishedAt: isoOffset(-9),
      coverImageUrl: '',
      attachments: [],
      createdAt: isoOffset(-9),
      updatedAt: isoOffset(-9),
    },
    {
      id: 'a3',
      title: '球隊招募新血',
      content:
        '本季開放招募新隊員，不限守備位置，歡迎有基礎的球友加入。\n\n有意者請透過官網聯絡信箱與我們聯繫，或直接到週三的練習現場找教練團。',
      category: 'recruit',
      pinned: false,
      status: 'published',
      publishedAt: isoOffset(-16),
      coverImageUrl: '',
      attachments: [],
      createdAt: isoOffset(-16),
      updatedAt: isoOffset(-16),
    },
    {
      id: 'a4',
      title: '年度隊聚與頒獎典禮',
      content: '年度隊聚訂於下個月舉行，將同時頒發本季最佳打者與最佳投手獎項。詳細地點另行公告。',
      category: 'event',
      pinned: false,
      status: 'published',
      publishedAt: isoOffset(-25),
      coverImageUrl: '',
      attachments: [],
      createdAt: isoOffset(-25),
      updatedAt: isoOffset(-25),
    },
  ]

  const settings: SiteSettings = {
    ...DEFAULT_SITE_SETTINGS,
    teamName: '城市棒球隊',
    shortName: '城市',
    aliases: '城市隊,City',
    slogan: '每一球都全力以赴',
    intro:
      '城市棒球隊成立於社區球友之間，以「打得開心、打得認真」為宗旨。我們每週固定練習，並參加地區聯賽，歡迎喜愛棒球的朋友加入我們。',
    foundedYear: new Date().getFullYear() - 8,
    homeField: '市立棒球場',
    homeCity: '臺北市',
    contactEmail: 'team@example.com',
    socialLinks: [],
    updatedAt: NOW,
  }

  return {
    players: new Map(players.map((p) => [p.id, p])),
    games: new Map(games.map((g) => [g.id, g])),
    announcements: new Map(announcements.map((a) => [a.id, a])),
    settings,
    // 推播訂閱沒有種子資料：它綁的是真實裝置，假資料送不出去也沒有意義
    pushSubscriptions: new Map(),
  }
}
