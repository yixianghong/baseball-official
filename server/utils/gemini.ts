import type { H3Event } from 'h3'
import { createExternalClient } from './external'
import { AppError, ERROR_CODE } from './errors'
import {
  LOW_CONFIDENCE_THRESHOLD,
  parseAttendanceResponseSchema,
  parseRosterResponseSchema,
  parseScheduleResponseSchema,
  parseScoreboardResponseSchema,
  type ParseAttendanceRequest,
  type ParseAttendanceResponse,
  type ParseRosterRequest,
  type ParseRosterResponse,
  type ParseScheduleRequest,
  type ParseScheduleResponse,
  type ParseScoreboardRequest,
  type ParseScoreboardResponse,
} from '../../shared/schemas/ai'
import { POSITIONS, type Hand, type Position } from '../../shared/schemas/player'

/**
 * Gemini 圖片辨識。
 *
 * ## 為什麼是這個專案的核心
 * 球隊的賽程與比賽結果，官方公告幾乎都是圖片（賽程表、計分板照片）。
 * 人工把一張賽程表逐格敲進後台既慢又容易錯行，這裡讓模型先讀一次，
 * 人只需要核對與修正。
 *
 * ## 兩個保證
 * 1. **結構化輸出**：用 `responseMimeType: application/json` 搭配
 *    `responseSchema`，模型被強制吐出固定形狀的 JSON，不會回傳散文，
 *    也就不需要寫任何「從自然語言裡撈欄位」的脆弱解析邏輯。
 * 2. **辨識結果不直接落地**：這裡回傳的是「建議」，一律先回到後台表單
 *    讓人確認。`confidence` 與 `warnings` 是給人判斷用的依據。
 *
 * ## 數字欄位用 -1 代表「無」
 * Gemini 的 responseSchema 對 nullable 的支援不穩定，因此約定
 * 「沒打這半局」輸出 `-1`，在這裡轉回 `null`。計分板上的 `X`（不用打）
 * 與 `0`（打了沒得分）意義完全不同，不能混為一談。
 */

const NO_VALUE = -1

/** 呼叫 Gemini 的 REST 客戶端。逾時取 `gemini.timeoutMs`（視覺推理比一般 API 慢）。 */
const geminiClient = createExternalClient({
  name: 'gemini',
  baseUrl: () => 'https://generativelanguage.googleapis.com/v1beta',
  staticHeaders: (): Record<string, string> => {
    const key = useRuntimeConfig().gemini.apiKey
    return key ? { 'x-goog-api-key': key } : {}
  },
  defaultTimeoutMs: () => useRuntimeConfig().gemini.timeoutMs,
})

interface GenerateContentResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> }
    finishReason?: string
  }>
  promptFeedback?: { blockReason?: string }
}

/** Gemini 的 responseSchema 採 OpenAPI 子集，型別名稱用大寫。 */
const SCHEDULE_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    matches: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          date: { type: 'STRING', description: '比賽日期，格式 YYYY-MM-DD，讀不到填空字串' },
          time: {
            type: 'STRING',
            description: '比賽時間，格式 HH:mm（24 小時制），讀不到填空字串',
          },
          opponent: { type: 'STRING', description: '對戰球隊名稱（不是我隊的那一隊）' },
          venue: { type: 'STRING', description: '球場名稱或場地編號，讀不到填空字串' },
          league: { type: 'STRING', description: '聯賽或賽事名稱，讀不到填空字串' },
          homeAway: { type: 'STRING', enum: ['home', 'away', 'unknown'] },
          confidence: { type: 'NUMBER', description: '對這一列的把握程度，0 到 1' },
          sourceText: { type: 'STRING', description: '這一場在原圖上的完整文字，供人工核對' },
        },
        required: ['date', 'opponent', 'confidence'],
      },
    },
    warnings: {
      type: 'ARRAY',
      items: { type: 'STRING' },
      description: '辨識過程中不確定或可能有誤的地方，用繁體中文描述',
    },
  },
  required: ['matches'],
} as const

const SCOREBOARD_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    ourRow: {
      type: 'ARRAY',
      items: { type: 'INTEGER' },
      description: '我隊各局得分，依局數順序。該半局沒有進行請填 -1',
    },
    opponentRow: {
      type: 'ARRAY',
      items: { type: 'INTEGER' },
      description: '對手各局得分，依局數順序。該半局沒有進行請填 -1',
    },
    ourTotals: {
      type: 'OBJECT',
      properties: {
        r: { type: 'INTEGER' },
        h: { type: 'INTEGER' },
        e: { type: 'INTEGER' },
      },
      required: ['r', 'h', 'e'],
    },
    opponentTotals: {
      type: 'OBJECT',
      properties: {
        r: { type: 'INTEGER' },
        h: { type: 'INTEGER' },
        e: { type: 'INTEGER' },
      },
      required: ['r', 'h', 'e'],
    },
    opponentName: { type: 'STRING', description: '計分板上對手那一列的隊名' },
    confidence: { type: 'NUMBER', description: '整體辨識把握程度，0 到 1' },
    warnings: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['ourRow', 'opponentRow', 'ourTotals', 'opponentTotals', 'confidence'],
} as const

/** 辨識賽程公告圖，只挑出含我隊的場次。 */
export async function parseScheduleImage(
  event: H3Event,
  request: ParseScheduleRequest,
): Promise<ParseScheduleResponse> {
  const year = request.defaultYear ?? new Date().getFullYear()
  const names = request.teamNames.join('、')

  const prompt = [
    '你是一位協助球隊管理賽程的助理。這張圖片是球隊聯賽的賽程公告。',
    '',
    `我方球隊的名稱可能寫成以下任何一種：${names}`,
    '簡繁體、全半形、空格差異、常見縮寫都算同一支隊伍。',
    '',
    '請找出**所有包含我方球隊的場次**，其他隊伍之間的對戰完全忽略，不要輸出。',
    '',
    '每一場請輸出：',
    `- date：日期，格式 YYYY-MM-DD。圖上若只寫月／日沒有年份，年份一律用 ${year}。`,
    '- time：開賽時間，格式 HH:mm（24 小時制）。圖上寫「下午 2 點」請轉成 14:00。',
    '- opponent：對手隊名。也就是該場次中「不是我方」的那一隊，隊名請照圖上原樣輸出。',
    '- venue：球場名稱或場地編號。',
    '- league：賽事或聯賽名稱（通常在標題）。',
    '- homeAway：我方是先攻（away）還是後攻（home）。圖上通常寫成「先攻／後攻」或用左右欄位表示；判斷不出來請填 unknown。',
    '- confidence：你對這一列的把握程度，0 到 1。',
    '- sourceText：這一場在圖上的原始文字，讓人可以核對。',
    '',
    '讀不到的欄位請填空字串，不要猜測、不要編造。',
    '如果整張圖裡找不到我方球隊，matches 請回傳空陣列，並在 warnings 說明原因。',
  ].join('\n')

  const raw = await generate<{
    matches?: Array<Record<string, unknown>>
    warnings?: string[]
  }>(event, prompt, request.imageBase64, request.mimeType, SCHEDULE_RESPONSE_SCHEMA)

  const matches = (raw.matches ?? []).map((match) => ({
    date: normalizeDate(String(match.date ?? ''), year),
    time: normalizeTime(String(match.time ?? '')),
    opponent: String(match.opponent ?? '').trim(),
    venue: String(match.venue ?? '').trim(),
    league: String(match.league ?? '').trim(),
    homeAway: match.homeAway === 'home' || match.homeAway === 'away' ? match.homeAway : null,
    confidence: clamp01(Number(match.confidence ?? 0)),
    sourceText: String(match.sourceText ?? '').trim(),
  }))

  const warnings = [...(raw.warnings ?? []).map(String)]

  // 後端自己再檢一次模型沒把握或欄位缺漏的地方，不完全依賴模型的自評
  for (const match of matches) {
    if (!match.date)
      warnings.push(`「${match.opponent || '未知對手'}」這一場讀不到日期，請手動填寫。`)
    if (!match.opponent) warnings.push('有一場次讀不到對手隊名，請手動填寫。')
  }
  if (matches.length === 0 && warnings.length === 0) {
    warnings.push('這張圖片中沒有找到我方球隊的場次，請確認隊名是否正確。')
  }

  return parseScheduleResponseSchema.parse({ matches, warnings })
}

/** 辨識計分板照片。 */
export async function parseScoreboardImage(
  event: H3Event,
  request: ParseScoreboardRequest,
): Promise<ParseScoreboardResponse> {
  const names = request.teamNames.join('、')

  const prompt = [
    '你是一位協助球隊記錄比賽的助理。這張圖片是一場棒球比賽的計分板。',
    '',
    `我方球隊的名稱可能寫成以下任何一種：${names}`,
    '簡繁體、全半形、空格差異、常見縮寫都算同一支隊伍。',
    '',
    '請讀出計分板上的內容：',
    '- ourRow：我方各局得分，從第 1 局開始依序排列。',
    '- opponentRow：對手各局得分，同樣依序排列。',
    '- 兩個陣列長度必須相同，等於這場比賽打了幾局。',
    '- 某個半局沒有進行（計分板上是 X、－、空白，例如後攻方已領先不需要打最後半局），請填 -1，不要填 0。',
    '- ourTotals / opponentTotals：R（總得分）、H（安打）、E（失誤）。計分板上沒有 H 或 E 欄位時填 0。',
    '- opponentName：計分板上對手那一列顯示的隊名。',
    '- confidence：整體把握程度，0 到 1。',
    '',
    '如果分不出哪一列是我方，請以上面那一列當作我方，並在 warnings 明確說明這件事。',
    '數字看不清楚時請在 warnings 指出是哪一局，不要憑空猜測。',
  ].join('\n')

  const raw = await generate<{
    ourRow?: number[]
    opponentRow?: number[]
    ourTotals?: { r?: number; h?: number; e?: number }
    opponentTotals?: { r?: number; h?: number; e?: number }
    opponentName?: string
    confidence?: number
    warnings?: string[]
  }>(event, prompt, request.imageBase64, request.mimeType, SCOREBOARD_RESPONSE_SCHEMA)

  const ourRow = raw.ourRow ?? []
  const opponentRow = raw.opponentRow ?? []
  const length = Math.max(ourRow.length, opponentRow.length)

  const innings = Array.from({ length }, (_, index) => ({
    inning: index + 1,
    our: toScore(ourRow[index]),
    opponent: toScore(opponentRow[index]),
  }))

  const totals = {
    our: toTotals(raw.ourTotals),
    opponent: toTotals(raw.opponentTotals),
  }

  const warnings = [...(raw.warnings ?? []).map(String)]
  let confidence = clamp01(Number(raw.confidence ?? 0))

  // 後端驗算：逐局加總必須等於 R。對不起來代表某一格讀錯，這是最容易發生的失誤。
  const sums = innings.reduce(
    (acc, inning) => ({
      our: acc.our + (inning.our ?? 0),
      opponent: acc.opponent + (inning.opponent ?? 0),
    }),
    { our: 0, opponent: 0 },
  )

  if (sums.our !== totals.our.r) {
    warnings.push(`我方逐局得分加總為 ${sums.our}，與總分 ${totals.our.r} 不符，請核對後修正。`)
    confidence = Math.min(confidence, LOW_CONFIDENCE_THRESHOLD - 0.01)
  }
  if (sums.opponent !== totals.opponent.r) {
    warnings.push(
      `對手逐局得分加總為 ${sums.opponent}，與總分 ${totals.opponent.r} 不符，請核對後修正。`,
    )
    confidence = Math.min(confidence, LOW_CONFIDENCE_THRESHOLD - 0.01)
  }
  if (length === 0) {
    warnings.push('沒有從圖片中讀到任何局數，請確認圖片是否為計分板。')
  }

  return parseScoreboardResponseSchema.parse({
    innings,
    totals,
    opponentName: String(raw.opponentName ?? '').trim(),
    confidence,
    warnings,
  })
}

const ROSTER_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    players: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          number: { type: 'STRING', description: '背號，只保留數字。讀不到填空字串' },
          name: { type: 'STRING', description: '球員姓名' },
          positions: {
            type: 'ARRAY',
            items: { type: 'STRING' },
            description: '守備位置，照名冊上的寫法輸出（例如「投手」「P」「一壘」）',
          },
          throws: { type: 'STRING', description: '投球慣用手，R 或 L。讀不到填空字串' },
          bats: {
            type: 'STRING',
            description: '打擊慣用手，R、L 或 S（左右開弓）。讀不到填空字串',
          },
          joinedYear: { type: 'INTEGER', description: '加入年份的西元年。讀不到填 0' },
          confidence: { type: 'NUMBER', description: '對這一列的把握程度，0 到 1' },
          sourceText: { type: 'STRING', description: '這一列在原圖上的完整文字，供人工核對' },
        },
        required: ['name', 'confidence'],
      },
    },
    warnings: {
      type: 'ARRAY',
      items: { type: 'STRING' },
      description: '辨識過程中不確定或可能有誤的地方，用繁體中文描述',
    },
  },
  required: ['players'],
} as const

/**
 * 辨識球員名冊。
 *
 * 球隊的名冊多半是 Excel 或 Google 試算表，逐列手敲進後台既慢又容易看錯行。
 * 這支函式讀一張名冊截圖，回傳每一列的球員資料。
 *
 * 守備位置與慣用手在這裡就正規化成 schema 的列舉值 —— 名冊上「投手」「P」
 * 「右投右打」的寫法都有，那種對照留給前端做只會每個表單各寫一次。
 */
export async function parseRosterImage(
  event: H3Event,
  request: ParseRosterRequest,
): Promise<ParseRosterResponse> {
  const prompt = [
    '你是一位協助球隊整理名冊的助理。這張圖片是球員名冊（多半是試算表的截圖）。',
    '',
    '請逐列讀出每一位球員的資料：',
    '- number：背號。只保留數字（名冊上寫「No.7」就輸出「7」）。讀不到填空字串。',
    '- name：球員姓名。這是唯一必要的欄位，讀不到整列就不要輸出。',
    '- positions：守備位置，照名冊上的寫法原樣輸出（「投手」「P」「一壘」都可以），一人可以有多個。',
    '- throws / bats：投球與打擊的慣用手，輸出 R（右）、L（左）或 S（左右開弓）。',
    '  名冊上常寫成「右投右打」這種合併的形式，請拆開：右投右打 → throws=R, bats=R；',
    '  右投左打 → throws=R, bats=L；左投左打 → throws=L, bats=L。',
    '  寫「左右開弓」「switch」的是打擊 bats=S。讀不到就填空字串，不要猜。',
    '- joinedYear：加入年份的西元年。名冊上若寫民國年請換算成西元（民國 110 年 = 2021）。讀不到填 0。',
    '- confidence：你對這一列的把握程度，0 到 1。',
    '- sourceText：這一列在圖上的原始文字，讓人可以核對。',
    '',
    '注意事項：',
    '- 表頭那一列（寫著「姓名」「背號」「守備位置」的那一列）不是球員，不要輸出。',
    '- 合計、備註、空白列也不要輸出。',
    '- 讀不到的欄位一律留空，不要猜測、不要編造。',
    '- 名冊上有幾位球員就輸出幾位，不要自行省略或合併。',
  ].join('\n')

  const raw = await generate<{
    players?: Array<Record<string, unknown>>
    warnings?: string[]
  }>(event, prompt, request.imageBase64, request.mimeType, ROSTER_RESPONSE_SCHEMA)

  const players = (raw.players ?? [])
    .map((player) => ({
      number: String(player.number ?? '')
        .replace(/[^0-9]/g, '')
        .slice(0, 3),
      name: String(player.name ?? '').trim(),
      positions: normalizePositions(player.positions),
      throws: normalizeHand(player.throws, 'R'),
      bats: normalizeHand(player.bats, 'R'),
      joinedYear: normalizeYear(player.joinedYear),
      confidence: clamp01(Number(player.confidence ?? 0)),
      sourceText: String(player.sourceText ?? '').trim(),
    }))
    // 沒有姓名的列多半是模型把空白列或表頭也讀進來了，直接丟掉
    .filter((player) => player.name.length > 0)

  const warnings = [...(raw.warnings ?? []).map(String)]

  if (players.length === 0 && warnings.length === 0) {
    warnings.push('這張圖片中沒有讀到任何球員，請確認圖片是否為球員名冊。')
  }

  const missingNumbers = players.filter((player) => !player.number).length
  if (missingNumbers > 0) {
    warnings.push(`有 ${missingNumbers} 位球員讀不到背號，請在下方手動補上。`)
  }

  // 名冊上背號重複通常代表看錯行，值得提醒
  const numbers = players.map((p) => p.number).filter(Boolean)
  const duplicated = [...new Set(numbers.filter((n, i) => numbers.indexOf(n) !== i))]
  if (duplicated.length > 0) {
    warnings.push(`背號 ${duplicated.join('、')} 重複出現，請核對是否看錯行。`)
  }

  return parseRosterResponseSchema.parse({ players, warnings })
}

/**
 * 守備位置的寫法對照。
 *
 * 名冊上「投手」「投」「P」都有人寫，這裡統一成 schema 的列舉值。
 * 對不上的（「內野手」這種沒指定守位、或根本不是守位的內容）回傳 null，
 * 由呼叫端決定預設值 —— 猜一個守位填進去，看起來會像名冊上真的這樣寫。
 */
const POSITION_ALIASES: Array<[RegExp, Position]> = [
  [/^(p|sp|rp|投手?|先發|後援|中繼|終結)$/i, 'P'],
  [/^(c|捕手?)$/i, 'C'],
  [/^(1b|一壘手?|一壘|一)$/i, '1B'],
  [/^(2b|二壘手?|二壘|二)$/i, '2B'],
  [/^(3b|三壘手?|三壘|三)$/i, '3B'],
  [/^(ss|游擊手?|游擊|游)$/i, 'SS'],
  [/^(lf|左外野手?|左外野|左外|左)$/i, 'LF'],
  [/^(cf|中外野手?|中外野|中外|中)$/i, 'CF'],
  [/^(rf|右外野手?|右外野|右外|右)$/i, 'RF'],
  [/^(dh|指定打擊|指打)$/i, 'DH'],
]

export function normalizePosition(input: string): Position | null {
  const text = input.trim().replace(/\s/g, '')
  if (!text) return null

  // 已經是列舉值就直接用（模型多半會照 schema 的描述輸出縮寫）
  const exact = POSITIONS.find((position) => position.toLowerCase() === text.toLowerCase())
  if (exact) return exact

  const matched = POSITION_ALIASES.find(([pattern]) => pattern.test(text))
  if (matched) return matched[1]

  // 「內野手」「外野手」「工具人」這類沒有指定守位的寫法：回報讀不到，
  // 由呼叫端填預設值。硬塞一個猜測的守位只會讓人以為名冊上真的這樣寫。
  //
  // 注意「指定打擊」不走這條路 —— 它在上面的對照表裡，是一個明確的位置。
  return null
}

function normalizePositions(input: unknown): Position[] {
  if (!Array.isArray(input)) return []

  const positions = input
    .flatMap((item) => String(item).split(/[、,/／|]/))
    .map((item) => normalizePosition(item))
    .filter((position): position is Position => position !== null)

  // 去重並限制數量，與 playerInputSchema 的上限一致
  return [...new Set(positions)].slice(0, 4)
}

/**
 * 慣用手的寫法對照。
 *
 * prompt 已要求模型輸出 R／L／S，這裡處理它偶爾回「右」「左投」的情況。
 * 讀不到時回退到預設值而不是報錯 —— 慣用手是後台隨時能改的欄位，
 * 不該因為名冊沒寫就讓整列匯不進來。
 */
export function normalizeHand(input: unknown, fallback: Hand): Hand {
  const text = String(input ?? '')
    .trim()
    .toLowerCase()
  if (!text) return fallback

  if (/^s$|左右|開弓|switch|雙/.test(text)) return 'S'
  if (/^l$|左/.test(text)) return 'L'
  if (/^r$|右/.test(text)) return 'R'
  return fallback
}

/** 年份：0 或不合理的值視為讀不到。民國年（三位數）自動換算成西元。 */
function normalizeYear(input: unknown): number | null {
  const value = Number(input)
  if (!Number.isFinite(value) || value <= 0) return null

  // 民國年通常是 80～130 這個範圍
  if (value >= 1 && value <= 200) return value + 1911

  const currentYear = new Date().getFullYear()
  if (value >= 1900 && value <= currentYear + 1) return Math.round(value)
  return null
}

const ATTENDANCE_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    entries: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          playerId: {
            type: 'STRING',
            description: '對應到的球員 id，必須是名單中出現過的 id。對不上就填空字串',
          },
          displayName: { type: 'STRING', description: '截圖上顯示的名字，原樣輸出' },
          status: { type: 'STRING', enum: ['yes', 'no', 'maybe', 'pending'] },
          confidence: { type: 'NUMBER', description: '對這一筆（含名字對應）的把握程度，0 到 1' },
        },
        required: ['displayName', 'status', 'confidence'],
      },
    },
    warnings: {
      type: 'ARRAY',
      items: { type: 'STRING' },
      description: '辨識過程中不確定或可能有誤的地方，用繁體中文描述',
    },
  },
  required: ['entries'],
} as const

/**
 * 辨識出席調查的截圖。
 *
 * 球隊的出席調查多半在 LINE 上進行 —— 投票功能、接龍訊息、或單純的
 * 「+1」回覆。這支函式讀一張截圖，回傳每個人的出席狀態。
 *
 * ## 名字對應才是難點
 * LINE 上顯示的是暱稱，常常不是本名：「阿豪」是「張志豪」、「冠宇」少了姓。
 * 所以這裡把**現有的球員名單一起送給模型**，讓它做對應 —— 讀音、字形、
 * 部分相符這種判斷，交給模型比在後端寫一套字串比對規則可靠得多。
 *
 * 對不上的名字不會被丟掉，而是帶著 `playerId: ''` 回去，由後台手動指定。
 */
export async function parseAttendanceImage(
  event: H3Event,
  request: ParseAttendanceRequest,
): Promise<ParseAttendanceResponse> {
  const rosterLines = request.roster
    .map(
      (player) => `- id=${player.id}｜${player.number ? `#${player.number} ` : ''}${player.name}`,
    )
    .join('\n')

  const prompt = [
    '這張圖片是球隊某場比賽的出席調查，可能是 LINE 的投票結果、接龍訊息，或群組裡的回覆。',
    '',
    '球隊名單如下：',
    rosterLines || '（名單是空的）',
    '',
    '請讀出每一個人的出席狀態：',
    '- displayName：截圖上顯示的名字，原樣輸出（可能是暱稱）。',
    '- playerId：對應到的球員 id，**必須是上面名單中出現過的 id**。',
    '  截圖上是暱稱時請依讀音、字形或部分相符判斷，例如「阿豪」對應到「張志豪」、',
    '  「冠宇」對應到「陳冠宇」。真的對不上就填空字串，不要硬湊。',
    '- status：出席狀態，只能是下面四個值之一：',
    '  yes＝出席（「出席」「參加」「+1」「可以」「OK」「✅」或投票投給出席那一欄）',
    '  no＝不出席（「不出席」「請假」「無法參加」「不行」「❌」）',
    '  maybe＝待確認（「可能」「不一定」「再看看」「?」）',
    '  pending＝看不出來他表達了什麼',
    '- confidence：你對這一筆的把握程度（包含名字對應是否正確），0 到 1。',
    '',
    '注意事項：',
    '- 投票類的截圖通常一個選項底下列出多個名字，那一整組人都算同一個狀態。',
    '- 同一個人重複出現時（例如改過票），以最後一次的回覆為準，只輸出一筆。',
    '- 不是球隊成員的人（例如群組裡的其他人）也照樣輸出，playerId 留空即可，',
    '  由後台的人決定要不要用。',
    '- 沒有出現在截圖裡的球員不要輸出，不要自行補上。',
  ].join('\n')

  const raw = await generate<{
    entries?: Array<Record<string, unknown>>
    warnings?: string[]
  }>(event, prompt, request.imageBase64, request.mimeType, ATTENDANCE_RESPONSE_SCHEMA)

  const validIds = new Set(request.roster.map((player) => player.id))

  const entries = (raw.entries ?? [])
    .map((entry) => {
      const playerId = String(entry.playerId ?? '').trim()
      return {
        // 模型偶爾會生出名單裡沒有的 id，那種一律當作沒對應到
        playerId: validIds.has(playerId) ? playerId : '',
        displayName: String(entry.displayName ?? '').trim(),
        status: normalizeAttendanceStatus(entry.status),
        confidence: clamp01(Number(entry.confidence ?? 0)),
      }
    })
    .filter((entry) => entry.displayName.length > 0)

  const warnings = [...(raw.warnings ?? []).map(String)]

  const unmatched = entries.filter((entry) => !entry.playerId).length
  if (unmatched > 0) {
    warnings.push(`有 ${unmatched} 個名字對不上名單中的球員，請在下方手動指定或略過。`)
  }

  // 同一位球員被對應到兩次，代表模型把兩個名字都算到同一個人身上
  const ids = entries.map((entry) => entry.playerId).filter(Boolean)
  const duplicated = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))]
  if (duplicated.length > 0) {
    const names = duplicated.map(
      (id) => request.roster.find((player) => player.id === id)?.name ?? id,
    )
    warnings.push(`${names.join('、')} 被對應到兩次以上，請確認是不是不同的人。`)
  }

  if (entries.length === 0 && warnings.length === 0) {
    warnings.push('這張圖片中沒有讀到任何出席回覆，請確認圖片內容。')
  }

  return parseAttendanceResponseSchema.parse({ entries, warnings })
}

/**
 * 把模型回的出席狀態正規化。
 *
 * prompt 已限定只能回四個值之一，這裡處理它偶爾回中文或其他寫法的情況。
 * 認不得的一律當成「未回覆」——猜一個出席狀態填進去，教練會照著錯的人數
 * 準備裝備。寧可讓那一列空著等人確認。
 */
export function normalizeAttendanceStatus(input: unknown): 'yes' | 'no' | 'maybe' | 'pending' {
  const text = String(input ?? '')
    .trim()
    .toLowerCase()
  if (text === 'yes' || text === 'no' || text === 'maybe') return text
  return 'pending'
}

/**
 * 呼叫 Gemini 並取出結構化 JSON。
 *
 * `temperature: 0` 是刻意的：這是讀圖抄寫的工作，不需要創造力，
 * 同一張圖每次都該讀出同樣的結果。
 */
async function generate<T>(
  event: H3Event,
  prompt: string,
  imageBase64: string,
  mimeType: string,
  responseSchema: unknown,
): Promise<T> {
  const config = useRuntimeConfig(event)

  if (!config.gemini.apiKey) {
    // 5xx 預設不對外揭露訊息，但這一則是給後台管理者的操作指引，
    // 換成泛用的「系統發生錯誤」反而讓人不知道該怎麼辦。
    throw new AppError(
      ERROR_CODE.SERVICE_UNAVAILABLE,
      '尚未設定 Gemini API 金鑰，無法使用圖片辨識。請改用手動輸入。',
      { expose: true },
    )
  }

  const response = await geminiClient<GenerateContentResponse>(
    event,
    `/models/${config.gemini.model}:generateContent`,
    {
      method: 'POST',
      body: {
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: imageBase64 } }],
          },
        ],
        generationConfig: {
          temperature: 0,
          responseMimeType: 'application/json',
          responseSchema,
        },
      },
      retries: 0,
    },
  )

  if (response.promptFeedback?.blockReason) {
    event.context.logger?.warn(
      { blockReason: response.promptFeedback.blockReason },
      'gemini blocked the request',
    )
    throw new AppError(ERROR_CODE.UPSTREAM_ERROR, '這張圖片無法被辨識，請改用手動輸入。', {
      expose: true,
    })
  }

  const text = response.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) {
    throw new AppError(ERROR_CODE.UPSTREAM_ERROR, '辨識服務沒有回傳內容，請稍後再試。', {
      expose: true,
    })
  }

  try {
    return JSON.parse(text) as T
  } catch (err) {
    event.context.logger?.error({ text: text.slice(0, 500) }, 'gemini returned malformed json')
    throw new AppError(ERROR_CODE.UPSTREAM_ERROR, '辨識結果格式異常，請稍後再試。', {
      cause: err,
      expose: true,
    })
  }
}

/** `-1` 代表該半局沒有進行，轉成 `null`；其餘限制在合理範圍內。 */
function toScore(value: number | undefined): number | null {
  if (value === undefined || value === NO_VALUE || value < 0) return null
  return Math.min(Math.round(value), 99)
}

function toTotals(totals: { r?: number; h?: number; e?: number } | undefined) {
  return {
    r: clampInt(totals?.r),
    h: clampInt(totals?.h),
    e: clampInt(totals?.e),
  }
}

function clampInt(value: number | undefined): number {
  if (typeof value !== 'number' || Number.isNaN(value) || value < 0) return 0
  return Math.min(Math.round(value), 999)
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0
  return Math.min(Math.max(value, 0), 1)
}

/**
 * 把模型回的日期正規化成 `YYYY-MM-DD`。
 *
 * 模型多半會照要求輸出，但偶爾會回 `3/15`、`2026/3/15`、`2026.03.15`。
 * 與其在 prompt 裡一再強調，不如在這裡收斂 —— 這類格式問題用程式碼處理
 * 比用提示詞處理可靠得多。
 */
export function normalizeDate(input: string, defaultYear: number): string {
  const text = input.trim()
  if (!text) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text

  const parts = text.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/)
  if (parts) {
    return `${parts[1]}-${pad(parts[2]!)}-${pad(parts[3]!)}`
  }

  // 尾端允許多餘的非數字：台灣的賽程公告常寫成「3月15日」，
  // 若要求字串以數字結尾，那個「日」就會讓整個比對失敗。
  const monthDay = text.match(/^(\d{1,2})\D+(\d{1,2})\D*$/)
  if (monthDay) {
    return `${defaultYear}-${pad(monthDay[1]!)}-${pad(monthDay[2]!)}`
  }

  return ''
}

/** 把模型回的時間正規化成 `HH:mm`。 */
export function normalizeTime(input: string): string {
  const text = input.trim()
  if (!text) return ''
  if (/^([01]\d|2[0-3]):[0-5]\d$/.test(text)) return text

  const match = text.match(/(\d{1,2})\D+(\d{2})/)
  if (match) {
    const hour = Number(match[1])
    if (hour >= 0 && hour <= 23) return `${pad(String(hour))}:${match[2]}`
  }

  const hourOnly = text.match(/^(\d{1,2})\s*(?:點|時|:00)?$/)
  if (hourOnly) {
    const hour = Number(hourOnly[1])
    if (hour >= 0 && hour <= 23) return `${pad(String(hour))}:00`
  }

  return ''
}

function pad(value: string): string {
  return value.padStart(2, '0')
}
