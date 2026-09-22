/**
 * VAPID 公鑰的格式轉換。
 *
 * 獨立成一支純函式（不依賴任何瀏覽器 API）是為了能直接單元測試 ——
 * base64url 的 padding 處理是典型「多數輸入都對、特定長度才壞」的地方，
 * 而它壞掉的症狀是 `pushManager.subscribe()` 拋一個看不出原因的錯誤。
 */

/**
 * base64url → `Uint8Array`。
 *
 * `pushManager.subscribe()` 的 `applicationServerKey` 不吃字串。
 * base64url 用 `-` 與 `_`，而 `atob` 只認標準 base64 的 `+` 與 `/`，
 * 而且 base64url 通常省略結尾的 `=`，所以要先補回來。
 *
 * @throws {Error} 不是合法 base64 時
 */
export function urlBase64ToUint8Array(base64url: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64url.length % 4)) % 4)
  const base64 = (base64url + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)

  // 明確配置 ArrayBuffer：`new Uint8Array(number)` 推導出來的型別是
  // `Uint8Array<ArrayBufferLike>`，而 `subscribe()` 要的是 `BufferSource`，
  // 兩者在 TypeScript 5.7 之後不相容。
  const output = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i)
  return output
}

/**
 * 既有訂閱是不是用「現在這把」VAPID 公鑰建立的。
 *
 * ## 為什麼需要這個判斷
 * 換了 VAPID 金鑰之後，瀏覽器裡還留著用舊公鑰建立的訂閱。這時候直接呼叫
 * `pushManager.subscribe()` **會拋 `InvalidStateError`** —— 規格不允許同一個
 * registration 同時存在兩個不同 applicationServerKey 的訂閱。
 *
 * 症狀是「按了開啟通知沒反應」，而且只發生在「曾經訂閱過」的裝置上，
 * 在乾淨的瀏覽器測起來一切正常，所以極難重現。正確的做法是先退掉舊的再訂新的。
 *
 * 本機與正式環境用不同金鑰時，同一台電腦切換兩邊就會遇到。
 */
export function isSameApplicationServerKey(
  existing: ArrayBuffer | null | undefined,
  publicKey: string,
): boolean {
  if (!existing) return false

  let expected: Uint8Array
  try {
    expected = urlBase64ToUint8Array(publicKey)
  } catch {
    return false
  }

  const actual = new Uint8Array(existing)
  if (actual.length !== expected.length) return false

  return actual.every((byte, index) => byte === expected[index])
}
