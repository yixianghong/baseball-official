/**
 * MLB 隊徽（限期活動「預測世界大賽冠軍」，見 `docs/ws-bracket.md`）。
 *
 * 圖檔放在 `app/assets/`（不是 `public/`），所以 Vite 會加上內容雜湊並套上
 * 長效快取；檔名也就不必自己管版本。`import.meta.glob` 的 eager 模式在
 * 建置時就展開成一組 import，執行期不會有動態載入。
 *
 * ⚠️ **glob 的路徑必須是字面值**，不能組出來 —— Vite 是靜態分析的，
 * 拼接出來的路徑會掃不到，結果是每一隊都沒有隊徽而且完全不報錯。
 */
const modules = import.meta.glob('../assets/img/mlb/*.png', {
  eager: true,
  import: 'default',
}) as Record<string, string>

const BY_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(modules).map(([path, url]) => [
    path
      .split('/')
      .pop()!
      .replace(/\.png$/, '')
      .toUpperCase(),
    url,
  ]),
)

/**
 * 查隊徽。**只有今年進季後賽的十二支有圖**，其餘回 `null`。
 *
 * 回 `null` 而不是回一張預設圖：呼叫端要畫的是隊伍代碼（`CLE`），
 * 一個誰都不是的灰色剪影比三個字母難懂得多。
 */
export function mlbLogo(code: string | null | undefined): string | null {
  return code ? (BY_CODE[code.toUpperCase()] ?? null) : null
}
