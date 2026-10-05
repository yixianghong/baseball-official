import type { Player } from '../../shared/schemas/player'
import type { Game } from '../../shared/schemas/game'
import type { Announcement } from '../../shared/schemas/announcement'
import type { SiteSettings } from '../../shared/schemas/settings'
import type { PushSubscriptionRecord } from '../../shared/schemas/push'
import type { GameHalf } from '../../shared/schemas/half-inning'
import type { Play, PlayResult } from '../../shared/schemas/play'
import {
  defaultBatted,
  FIELDER_SPOTS,
  nearestFielder,
  needsBattedType,
  needsFielder,
  NO_LANDING_RESULTS,
  roundPoint,
} from '../../shared/schemas/field'
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

  /**
   * 逐打席的示範資料。
   *
   * 一列就是一個打席：`[第幾局, 上/下, 打者, 結果, 這個打席得幾分?]`。
   * 打者寫我隊的球員 id（`'p4'`）或對手打者的背號（`'#11'`）—— 對手沒有名冊，
   * 名單上本來就只有背號，這份示範資料照著真實情況長。
   *
   * 投手一律填我隊的那位，但**只會被記進我隊防守的半局**
   * （`derivePitching()` 自己會擋），所以不必在這裡分情況。
   */
  /**
   * 示範資料的落點。
   *
   * ⚠️ **這些位置是依結果類型輪流產生的，不是真的比賽**：滾地球輪流打向
   * 內野手、飛球輪流打向外野手、安打輪流落在幾個空檔。目的只是讓落點圖
   * 開箱就有東西可以看，並且每一種形狀（滾地／平飛／高飛、安打／出局）都有。
   */
  const demoLanding = (
    result: PlayResult,
    index: number,
  ): Pick<Play, 'location' | 'fielder' | 'batted'> => {
    if ((NO_LANDING_RESULTS as readonly string[]).includes(result)) {
      return { location: null, fielder: null, batted: null }
    }

    const cycle = <T>(items: readonly T[]) => items[index % items.length]!
    const jitter = ((index * 37) % 7) / 100 - 0.03

    const near = (position: keyof typeof FIELDER_SPOTS) => ({
      x: FIELDER_SPOTS[position].x + jitter,
      y: FIELDER_SPOTS[position].y + jitter / 2,
    })

    const byResult: Partial<Record<PlayResult, () => { x: number; y: number }>> = {
      groundout: () => near(cycle(['SS', '2B', '3B', '1B', 'P'] as const)),
      doublePlay: () => near(cycle(['SS', '2B'] as const)),
      fieldersChoice: () => near('SS'),
      sacrificeBunt: () => ({ x: 0.05, y: 0.08 }),
      flyout: () => near(cycle(['CF', 'LF', 'RF'] as const)),
      lineout: () => near(cycle(['SS', 'LF', '2B'] as const)),
      sacrificeFly: () => near('RF'),
      foulout: () =>
        cycle([
          { x: 0.42, y: 0.12 },
          { x: -0.4, y: 0.15 },
        ]),
      reachedOnError: () => near('3B'),
      single: () =>
        cycle([
          { x: -0.2, y: 0.58 },
          { x: 0.24, y: 0.56 },
          { x: 0.02, y: 0.62 },
          { x: -0.36, y: 0.5 },
        ]),
      double: () =>
        cycle([
          { x: -0.3, y: 0.9 },
          { x: 0.33, y: 0.88 },
        ]),
      triple: () =>
        cycle([
          { x: 0.56, y: 0.7 },
          { x: -0.5, y: 0.76 },
        ]),
      homerun: () =>
        cycle([
          { x: -0.4, y: 1.04 },
          { x: 0.12, y: 1.07 },
        ]),
    }

    const location = roundPoint((byResult[result] ?? (() => near('CF')))())
    return {
      location,
      fielder: needsFielder(result) ? nearestFielder(location).position : null,
      batted: needsBattedType(result) ? defaultBatted(location) : null,
    }
  }

  const playsFrom = (
    ourPitcherId: string,
    /** 這一場的打線（球員 id 依棒次排）—— 用來替我隊的打席記上第幾棒。 */
    lineupIds: string[],
    spec: Array<
      [number, GameHalf, string, PlayResult] | [number, GameHalf, string, PlayResult, number]
    >,
  ): Play[] => {
    const pitcher = players.find((item) => item.id === ourPitcherId)!
    return spec.map(([inning, half, who, result, runs = 0], index) => {
      const player = who.startsWith('#') ? undefined : players.find((item) => item.id === who)
      return {
        inning,
        half,
        batter: player
          ? { playerId: player.id, name: player.name, number: player.number }
          : { playerId: '', name: '', number: who.slice(1) },
        pitcher: { playerId: pitcher.id, name: pitcher.name, number: pitcher.number },
        result,
        runs,
        // 示範資料裡的得分都是打點（沒有失誤、暴投推進回來的分數）
        rbi: runs,
        note: '',
        transcript: '',
        ...demoLanding(result, index),
        bats: player ? (player.bats === 'S' ? (index % 2 ? 'L' : 'R') : player.bats) : null,
        battingSlot:
          player && lineupIds.includes(player.id) ? lineupIds.indexOf(player.id) + 1 : null,
      }
    })
  }

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
      // 示範：回報截止在賽前一天晚上九點（前台會寫出來，到了就鎖）
      attendanceLockAt: `${dayOffset(6)}T21:00`,
      narratives: [],
      remindersSent: [],
      plays: [],
      clips: [],
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
      startingPitcher: null,
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
      attendanceLockAt: '',
      narratives: [],
      remindersSent: [],
      plays: [],
      clips: [],
      attendance: attendanceFrom({ p1: 'yes', p2: 'yes', p4: 'maybe' }),
      lineup: [],
      startingPitcher: null,
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
      attendanceLockAt: '',
      narratives: [],
      remindersSent: [],
      plays: [],
      clips: [],
      attendance: [],
      lineup: [],
      startingPitcher: null,
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
      attendanceLockAt: '',
      narratives: [],
      remindersSent: [],
      plays: [],
      clips: [],
      attendance: [],
      lineup: [],
      startingPitcher: null,
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
      // 一段公開、一段還沒改成公開（前台應該只看得到前者）
      clips: [
        { inning: 1, half: 'top', videoId: 'aaaaaaaaaaa', privacy: 'public', createdAt: NOW },
        { inning: 1, half: 'bottom', videoId: 'bbbbbbbbbbb', privacy: 'private', createdAt: NOW },
        { inning: 2, half: 'top', videoId: 'ccccccccccc', privacy: 'unlisted', createdAt: NOW },
      ],
      coverImageUrl: '',
      opponentLogoUrl: '',
      attendanceLockAt: '',
      narratives: [],
      remindersSent: [],
      /**
       * 只登錄了前兩局 —— 用來呈現「**登錄不完整**」的樣子：那幾格的得分
       * 由打席推導（後台會變成唯讀），其餘維持手填，而 box score 上
       * **不會出現打擊率**（見 `playLogComplete()`）。
       * 主場，所以上半局是對手打擊。
       */
      plays: playsFrom(
        'p1',
        ['p4', 'p5', 'p3', 'p6', 'p9', 'p8', 'p7', 'p2', 'p1'],
        [
          // 1 上（對手）1 分
          [1, 'top', '#8', 'single'],
          [1, 'top', '#12', 'single', 1],
          [1, 'top', '#20', 'strikeout'],
          [1, 'top', '#4', 'doublePlay'],
          // 1 下（我隊）0 分
          [1, 'bottom', 'p4', 'flyout'],
          [1, 'bottom', 'p5', 'walk'],
          [1, 'bottom', 'p3', 'strikeout'],
          [1, 'bottom', 'p6', 'groundout'],
          // 2 上（對手）0 分
          [2, 'top', '#16', 'groundout'],
          [2, 'top', '#8', 'flyout'],
          [2, 'top', '#12', 'strikeout'],
          // 2 下（我隊）2 分
          [2, 'bottom', 'p9', 'double'],
          [2, 'bottom', 'p8', 'single'],
          [2, 'bottom', 'p7', 'triple', 2],
          [2, 'bottom', 'p2', 'strikeout'],
          [2, 'bottom', 'p1', 'flyout'],
          [2, 'bottom', 'p4', 'groundout'],
        ],
      ),
      attendance: [],
      lineup: lineupFrom(['p4', 'p5', 'p3', 'p6', 'p9', 'p8', 'p7', 'p2', 'p1']),
      startingPitcher: { playerId: 'p1', name: '陳冠宇', number: '1' },
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
      attendanceLockAt: '',
      narratives: [],
      remindersSent: [],
      plays: [],
      clips: [],
      attendance: [],
      lineup: lineupFrom(['p5', 'p4', 'p3', 'p6', 'p8', 'p9', 'p7', 'p2', 'p10']),
      startingPitcher: { playerId: 'p10', name: '鄭凱文', number: '24' },
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
      attendanceLockAt: '',
      narratives: [],
      remindersSent: [],
      /**
       * 這一場**逐打席全部登錄完整**（每個半局都到三出局），所以前台的
       * box score 會顯示打擊率 —— 這是示範資料裡唯一一場。g3 只登錄了
       * 前兩局，用來呈現「登錄不完整」的樣子（那時候不顯示打擊率）。
       */
      plays: playsFrom(
        'p1',
        ['p4', 'p5', 'p3', 'p9', 'p6', 'p8', 'p7', 'p2', 'p1'],
        [
          // 1 上（對手）1 分
          [1, 'top', '#3', 'single'],
          [1, 'top', '#6', 'double', 1],
          [1, 'top', '#11', 'strikeout'],
          [1, 'top', '#14', 'groundout'],
          [1, 'top', '#17', 'flyout'],
          // 1 下（我隊）1 分
          [1, 'bottom', 'p4', 'single'],
          [1, 'bottom', 'p5', 'double', 1],
          [1, 'bottom', 'p3', 'strikeout'],
          [1, 'bottom', 'p9', 'groundout'],
          [1, 'bottom', 'p6', 'flyout'],
          // 2 上
          [2, 'top', '#23', 'groundout'],
          [2, 'top', '#33', 'strikeout'],
          [2, 'top', '#3', 'flyout'],
          // 2 下 —— 雙殺打一次吃掉兩個出局
          [2, 'bottom', 'p8', 'walk'],
          [2, 'bottom', 'p7', 'doublePlay'],
          [2, 'bottom', 'p2', 'groundout'],
          // 3 上（對手）1 分，高飛犧牲打不算打數
          [3, 'top', '#6', 'single'],
          [3, 'top', '#11', 'single'],
          [3, 'top', '#14', 'sacrificeFly', 1],
          [3, 'top', '#17', 'strikeout'],
          [3, 'top', '#23', 'groundout'],
          // 3 下（我隊）2 分
          [3, 'bottom', 'p1', 'strikeout'],
          [3, 'bottom', 'p4', 'walk'],
          [3, 'bottom', 'p5', 'single'],
          [3, 'bottom', 'p3', 'triple', 2],
          [3, 'bottom', 'p9', 'flyout'],
          [3, 'bottom', 'p6', 'groundout'],
          // 4 上（對手）1 分
          [4, 'top', '#33', 'homerun', 1],
          [4, 'top', '#3', 'flyout'],
          [4, 'top', '#6', 'strikeout'],
          [4, 'top', '#11', 'groundout'],
          // 4 下
          [4, 'bottom', 'p8', 'flyout'],
          [4, 'bottom', 'p7', 'strikeout'],
          [4, 'bottom', 'p2', 'groundout'],
          // 5 上（對手）1 分
          [5, 'top', '#14', 'double'],
          [5, 'top', '#17', 'single', 1],
          [5, 'top', '#23', 'doublePlay'],
          [5, 'top', '#33', 'flyout'],
          // 5 下（我隊）1 分
          [5, 'bottom', 'p1', 'groundout'],
          [5, 'bottom', 'p4', 'homerun', 1],
          [5, 'bottom', 'p5', 'strikeout'],
          [5, 'bottom', 'p3', 'flyout'],
          // 6 上
          [6, 'top', '#3', 'groundout'],
          [6, 'top', '#6', 'flyout'],
          [6, 'top', '#11', 'strikeout'],
          // 6 下 —— 野手選擇上壘，算打數但不算安打
          [6, 'bottom', 'p9', 'single'],
          [6, 'bottom', 'p6', 'fieldersChoice'],
          [6, 'bottom', 'p8', 'doublePlay'],
          // 7 上
          [7, 'top', '#14', 'strikeout'],
          [7, 'top', '#17', 'groundout'],
          [7, 'top', '#23', 'lineout'],
          // 7 下
          [7, 'bottom', 'p7', 'flyout'],
          [7, 'bottom', 'p2', 'strikeout'],
          [7, 'bottom', 'p1', 'groundout'],
        ],
      ),
      clips: [],
      attendance: [],
      lineup: lineupFrom(['p4', 'p5', 'p3', 'p9', 'p6', 'p8', 'p7', 'p2', 'p1']),
      startingPitcher: { playerId: 'p1', name: '陳冠宇', number: '1' },
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
        // 逐打席全部登錄完整，H／E 都由打席推導：這一場沒有失誤上壘，所以 E 是 0
        totals: { our: { r: 4, h: 6, e: 0 }, opponent: { r: 4, h: 7, e: 0 } },
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
