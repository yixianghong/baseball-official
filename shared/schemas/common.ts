import { z } from 'zod'

/**
 * 前後端共用的 zod schema。
 *
 * 放在 `shared/` 的用意：後端用它做**執行期驗證**，前端用 `z.infer` 取得
 * **編譯期型別**，兩邊永遠同步。改欄位只需要改這一個地方。
 */

/**
 * 分頁查詢參數。
 *
 * query string 進來一律是字串，所以用 `coerce` 轉型；
 * `pageSize` 設上限避免有人打 `?pageSize=999999` 拖垮上游服務。
 */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export type PaginationQueryInput = z.input<typeof paginationQuerySchema>
export type PaginationQueryOutput = z.output<typeof paginationQuerySchema>

/** 路由參數常見的 ID 形狀（非空字串）。 */
export const idParamSchema = z.object({
  id: z.string().min(1, 'ID 不可為空'),
})

/**
 * 由「新增用」的 schema 產生「部分更新用」的 schema。
 *
 * ## ⚠️ 為什麼不能直接用 `.partial()`
 * `.partial()` 只是把欄位變成選填，**帶 `.default()` 的欄位在鍵不存在時照樣會
 * 套用預設值**。於是一個只想把狀態改成「比賽結束」的 PATCH，實際送進資料層的
 * 是「狀態改成結束，順便把場地、出席、打線、計分板全部重設成空的」——
 * 而且 API 回應看起來完全正常，畫面上也不會有任何錯誤。
 *
 * 這裡先把 `ZodDefault` 拆掉再轉成選填，「沒送這個欄位」才真的等於
 * 「不要動它」。`updateGame()` 這類 `{ ...existing, ...patch }` 的合併
 * 完全依賴這個前提。
 *
 * 型別另外標註是因為推導出來的形狀對呼叫端沒有意義 —— 對他們來說它就是
 * 「輸入 schema 的每個欄位都可以省略」。
 */
export function patchSchemaOf<Shape extends z.ZodRawShape>(
  input: z.ZodObject<Shape>,
): z.ZodType<Partial<z.output<z.ZodObject<Shape>>>, Partial<z.input<z.ZodObject<Shape>>>> {
  const shape = Object.fromEntries(
    Object.entries(input.shape).map(([key, field]) => {
      // `removeDefault()` 的回傳型別是 zod 內部的 `$ZodType`，接不上 `.optional()`
      const inner = (field instanceof z.ZodDefault ? field.removeDefault() : field) as z.ZodType
      return [key, inner.optional()]
    }),
  )
  return z.object(shape) as unknown as z.ZodType<
    Partial<z.output<z.ZodObject<Shape>>>,
    Partial<z.input<z.ZodObject<Shape>>>
  >
}
