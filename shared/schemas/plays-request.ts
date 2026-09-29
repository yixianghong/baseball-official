import { z } from 'zod'
import { gameHalfSchema } from './half-inning'
import { MAX_PLAYS_PER_HALF_INNING, playSchema } from './play'

/**
 * 寫入一個半局的逐打席紀錄。
 *
 * 獨立一個檔案而不是塞進 `play.ts`：`play.ts` 是資料本身的形狀，
 * 這裡是**端點的契約**。把請求格式混進資料 schema 之後，日後加一個只有
 * 端點需要的欄位（例如樂觀鎖的版本號）就會連帶跑進資料庫。
 */
export const saveHalfInningPlaysSchema = z.object({
  inning: z.number().int().min(1).max(20),
  half: gameHalfSchema,
  /**
   * 這個半局的全部打席，依發生順序。
   *
   * **空陣列是合法的，意思是「清空這個半局」** —— 登錯半局時要刪得掉。
   * 每一筆身上的 `inning`／`half` 會被上面那兩個欄位覆蓋，所以從別的
   * 半局複製過來的打席不會帶著舊座標寫進去。
   */
  plays: z.array(playSchema).max(MAX_PLAYS_PER_HALF_INNING),
})

export type SaveHalfInningPlaysInput = z.infer<typeof saveHalfInningPlaysSchema>
