import { z } from 'zod'
import { patchSchemaOf } from './common'

/**
 * 球員資料的共用契約。
 *
 * 後端用它驗證寫入 Firestore 的資料與讀出來的形狀，前端用 `z.infer` 取得型別，
 * 兩邊永遠同步。改欄位只需要改這一個地方。
 */

/**
 * 守備位置。沿用棒球通用縮寫：場上的九個守備位置，加上打 DH 制時的指定打擊。
 *
 * 順序刻意照守位編號 1～9 排，最後才是 DH —— 選單與篩選列都依這個順序呈現，
 * 看得懂棒球的人掃一眼就找得到。
 */
export const POSITIONS = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'] as const

export const positionSchema = z.enum(POSITIONS)
export type Position = z.infer<typeof positionSchema>

/** 位置的中文顯示名稱。前後台共用，避免兩邊各翻一次。 */
export const POSITION_LABELS: Record<Position, string> = {
  P: '投手',
  C: '捕手',
  '1B': '一壘手',
  '2B': '二壘手',
  '3B': '三壘手',
  SS: '游擊手',
  LF: '左外野',
  CF: '中外野',
  RF: '右外野',
  DH: '指定打擊',
}

/** 慣用手：右投右打 / 左投左打 / 左右開弓。 */
export const handSchema = z.enum(['R', 'L', 'S'])
export type Hand = z.infer<typeof handSchema>

export const HAND_LABELS: Record<Hand, string> = {
  R: '右',
  L: '左',
  S: '左右開弓',
}

/**
 * 「右投右打」這種說法。
 *
 * 不能單純把兩個標籤串起來 —— 左右開弓的球員會變成「右投左右開弓打」，
 * 讀不通。台灣棒球的習慣說法是「右投左右開弓」，中間不加「打」字。
 *
 * 收在 shared 是因為球員卡、個人頁、後台列表都要顯示它，
 * 三處各拼一次字串遲早會有一處漏掉這個例外。
 */
export function describeHands(throwsWith: Hand, batsWith: Hand): string {
  const pitching = `${HAND_LABELS[throwsWith]}投`
  return batsWith === 'S' ? `${pitching}左右開弓` : `${pitching}${HAND_LABELS[batsWith]}打`
}

/** 球員狀態。`inactive` 代表退隊或長期缺席，前台名單預設不顯示。 */
export const playerStatusSchema = z.enum(['active', 'inactive'])
export type PlayerStatus = z.infer<typeof playerStatusSchema>

/**
 * 新增／編輯球員時後台送進來的資料。
 *
 * 背號刻意用字串而非數字：棒球有 `00`、`0` 這種背號，用數字會被正規化掉。
 */
export const playerInputSchema = z.object({
  number: z
    .string()
    .trim()
    .max(3, '背號最多 3 個字元')
    .regex(/^[0-9]*$/, '背號只能是數字'),
  name: z.string().trim().min(1, '請輸入球員姓名').max(20, '姓名過長'),
  positions: z.array(positionSchema).min(1, '至少選擇一個守備位置').max(4, '最多選擇 4 個位置'),
  bats: handSchema.default('R'),
  throws: handSchema.default('R'),
  joinedYear: z
    .number()
    .int()
    .min(1900)
    .max(new Date().getFullYear() + 1)
    .nullable()
    .default(null),
  bio: z.string().trim().max(500, '簡介最多 500 字').default(''),
  photoUrl: z.string().trim().default(''),
  status: playerStatusSchema.default('active'),
  /** 名單排序用。數字小的排前面，相同時以背號遞增排序。 */
  sortOrder: z.number().int().default(0),
})

export type PlayerInput = z.input<typeof playerInputSchema>
/** 表單狀態用（所有欄位都已套用預設值）。理由見 `settings.ts` 的 `SiteSettingsForm`。 */
export type PlayerForm = z.output<typeof playerInputSchema>

/** 編輯時允許只送部分欄位。 */
export const playerPatchSchema = patchSchemaOf(playerInputSchema)
export type PlayerPatch = z.input<typeof playerPatchSchema>

/** 從 Firestore 讀出、回傳給前端的完整球員資料。 */
export const playerSchema = playerInputSchema.extend({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type Player = z.infer<typeof playerSchema>

/** 球員列表的查詢參數。 */
export const playerQuerySchema = z.object({
  status: playerStatusSchema.optional(),
  position: positionSchema.optional(),
})

export type PlayerQuery = z.input<typeof playerQuerySchema>
/** repository 用（已套用 default 與 coerce）。 */
export type PlayerQueryOptions = Partial<z.output<typeof playerQuerySchema>>

/**
 * 名單排序規則。
 *
 * 抽成函式而非散在各頁面：前台名單、後台列表、打線挑人清單都用同一套順序，
 * 使用者才不會在不同畫面看到不同排列。
 */
export function comparePlayers(a: Player, b: Player): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
  const numA = a.number === '' ? Number.MAX_SAFE_INTEGER : Number(a.number)
  const numB = b.number === '' ? Number.MAX_SAFE_INTEGER : Number(b.number)
  if (numA !== numB) return numA - numB
  return a.name.localeCompare(b.name, 'zh-Hant')
}
