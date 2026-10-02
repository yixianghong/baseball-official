/**
 * Service worker 請頁面換頁時，該去哪裡。
 *
 * 點了推播通知之後，SW 會先試 `WindowClient.navigate()`；那個 API 在部分
 * 瀏覽器（WebKit）不存在，所以還有一條退路是 `postMessage()` 請頁面自己的
 * 路由走過去（見 `public/sw.js` 的 `openTarget()`）。這裡是接那則訊息的判斷。
 *
 * 抽成純函式是因為它是**最後一道防線**：訊息從 SW 來，而 SW 的通知酬載
 * 是從網路來的。SW 已經把目標限制在同源，這裡再擋一次 —— 多一層幾乎不花
 * 成本，而漏掉的下場是一個「外觀來自球隊、點下去是別人網站」的開放重導向。
 */
export function navigationTargetFrom(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null

  const message = data as { type?: unknown; url?: unknown }
  if (message.type !== 'navigate' || typeof message.url !== 'string') return null

  const url = message.url.trim()

  /*
   * ⚠️ 只檢查「開頭是 /」不夠。`//evil.test` 也以 `/` 開頭，但它是**協定
   * 相對網址**，`router.push()` 之後瀏覽器會解析成 `https://evil.test`。
   * `/\evil.test` 在部分瀏覽器也會被當成同一回事。
   * 和 `shared/schemas/push.ts` 的 `url` 欄位是同一條規則。
   */
  if (!url.startsWith('/') || url.startsWith('//') || url.startsWith('/\\')) return null

  return url
}
