/**
 * 部落格文章的截圖場景定義。
 *
 * 這是「文章裡的圖」唯一的來源：`pnpm screenshots` 會起一個跑在示範資料上的
 * 正式建置，照這張清單逐一拍照，蓋寫 `docs/blog/images/`。
 *
 * ## 為什麼截圖要用程式產生
 * 手截的圖和程式碼是脫鉤的：UI 改了之後沒有人會知道哪幾張過期，而過期的截圖
 * 比沒有截圖更糟（讀者會以為那是現在的樣子）。場景寫成資料之後，「文章裡有
 * 哪些畫面」變成看得見、改得動的東西 —— 新功能要上文章就在這裡加一行。
 *
 * ## 示範資料的 id 是固定的
 * `server/utils/memory-store.ts` 的 g1…g7、p1…p12、a1…a4 不會變，所以路徑可以
 * 直接寫死。幾場比賽的狀態各不相同，挑的時候要挑對：
 *
 * - `g1` 未開賽（`scheduled`）、有出席名單與回報截止時間
 * - `g3` 已結束（`finished`）、有逐打席、落點、三段錄影
 * - `g7` 延賽（`postponed`）
 */

/** 視窗預設。桌機不放大（檔案小一半），手機用 2x —— 手機圖在文章裡是直接看細節的。 */
export const VIEWPORTS = {
  desktop: { width: 1440, height: 900, scale: 1, mobile: false },
  mobile: { width: 390, height: 844, scale: 2, mobile: true },
}

/**
 * 一個場景 = 一張圖。
 *
 * | 欄位       | 說明                                                                |
 * | ---------- | ------------------------------------------------------------------- |
 * | `name`     | 輸出檔名（`docs/blog/images/<name>.png`），也是文章裡引用的名字      |
 * | `path`     | 站內路徑                                                            |
 * | `viewport` | `VIEWPORTS` 的鍵，預設 `desktop`                                    |
 * | `admin`    | `true` 會先帶上後台 session cookie（開發模式登入）                  |
 * | `fullPage` | 整頁截圖；長頁面才開，否則一張圖裡什麼都看不清楚                     |
 * | `theme`    | `'dark'` 會模擬 `prefers-color-scheme: dark`                        |
 * | `waitFor`  | 等這個選擇器出現才拍 —— 比固定延遲可靠                               |
 * | `hide`     | 拍照前隱藏的選擇器（遮住畫面的浮層）                                 |
 * | `script`   | 拍照前在頁面裡跑的程式碼，用來把畫面帶到要拍的狀態（展開分頁、點開選單） |
 */
/**
 * 捲到某一區的 `script`。
 *
 * 聚焦某個區塊時用它，不要用整頁截圖 —— 一張四千像素高的圖在文章裡只會被縮成
 * 一條，什麼都看不清楚。留 24px 是為了不要讓標題貼著畫面頂端。
 */
function focusOn(selector) {
  return `
    const target = document.querySelector(${JSON.stringify(selector)})
    target?.scrollIntoView({ block: 'start' })
    window.scrollBy(0, -24)
  `
}

/** 同上，但用畫面上的文字找錨點 —— 沒有 id 可以指的區塊走這一條。 */
function focusOnText(text) {
  return `
    const node = [...document.querySelectorAll('h2, h3, label, legend, p')]
      .find((el) => el.textContent.trim().startsWith(${JSON.stringify(text)}))
    node?.scrollIntoView({ block: 'start' })
    window.scrollBy(0, -24)
  `
}

export const SCENES = [
  // ── 前台 ────────────────────────────────────────────────────────
  {
    name: 'home',
    path: '/',
    fullPage: true,
    description: '首頁：下一場比賽、最近戰績、公告',
  },
  {
    // ⚠️ 深色是這個站的**預設**（`DEFAULT_COLOR_MODE`），所以要另外拍的是淺色那一張。
    // `theme` 設的是 `color_mode` cookie，不是 `prefers-color-scheme`。
    name: 'home-light',
    path: '/',
    theme: 'light',
    description: '首頁的淺色模式（深色才是預設，淺色是切換出來的）',
  },
  {
    name: 'home-mobile',
    path: '/',
    viewport: 'mobile',
    fullPage: true,
    description: '首頁在手機上的樣子',
  },
  {
    name: 'schedule',
    path: '/schedule',
    fullPage: true,
    description: '賽程頁：月曆與賽程卡片',
  },
  {
    name: 'results',
    path: '/results',
    fullPage: true,
    description: '戰績頁：勝敗場次與逐場結果',
  },
  {
    name: 'game-finished',
    path: '/games/g3',
    fullPage: true,
    description: '已結束的比賽：計分板、成績表、落點圖、逐局戰況、錄影',
  },
  {
    name: 'game-scoreboard',
    path: '/games/g3',
    waitFor: 'table',
    description: '計分板（逐局得分，R 一律是逐局加總）',
  },
  {
    name: 'game-spray-chart',
    path: '/games/g3',
    waitFor: '#spray-heading',
    script: focusOn('#spray-heading'),
    description: '擊球落點圖（形狀＝擊球類型、紅色實心＝安打，可只看一位打者）',
  },
  {
    name: 'game-box-score',
    path: '/games/g3',
    waitFor: '#box-score-heading',
    script: focusOn('#box-score-heading'),
    description: '成績表：投打成績全部由逐打席推導',
  },
  {
    name: 'game-clips',
    path: '/games/g3',
    waitFor: '#clips-heading',
    script: focusOn('#clips-heading'),
    description: '每半局一段的錄影（預設只載縮圖）',
  },
  {
    name: 'game-attendance-mobile',
    path: '/games/g1',
    viewport: 'mobile',
    fullPage: true,
    description: '隊員自己回報出席（點名字再點答案）',
  },
  {
    name: 'players',
    path: '/players',
    fullPage: true,
    description: '球員名冊',
  },
  {
    name: 'player-detail',
    path: '/players/p4',
    fullPage: true,
    description: '球員頁：守位、投打習慣、出賽紀錄',
  },
  {
    name: 'news',
    path: '/news',
    fullPage: true,
    description: '公告牆（Markdown + 附件）',
  },

  // ── 後台 ────────────────────────────────────────────────────────
  {
    name: 'admin-dashboard',
    path: '/admin',
    admin: true,
    fullPage: true,
    description: '後台首頁',
  },
  {
    name: 'admin-games',
    path: '/admin/games',
    admin: true,
    fullPage: true,
    description: '後台賽事列表',
  },
  {
    name: 'admin-game-basic',
    path: '/admin/games/g3',
    admin: true,
    fullPage: true,
    description: '單場賽事的「基本資料」分頁（賽事狀態排在最前面）',
  },
  {
    name: 'admin-game-innings',
    path: '/admin/games/g3?tab=innings',
    admin: true,
    fullPage: true,
    description: '「逐局紀錄」分頁：計分板 + 球場拖曳登錄 + 打席列表',
  },
  {
    name: 'admin-field-picker',
    path: '/admin/games/g3?tab=innings',
    admin: true,
    script: focusOnText('對手打者背號'),
    description: '球場拖曳登錄：從本壘把球拖到落點，放開後點結果',
  },
  {
    name: 'admin-scoreboard',
    path: '/admin/games/g3?tab=innings',
    admin: true,
    script: focusOnText('用照片自動填入'),
    description: '後台計分板：由逐打席推導的那幾格是唯讀的',
  },
  {
    name: 'admin-game-innings-mobile',
    path: '/admin/games/g3?tab=innings',
    viewport: 'mobile',
    admin: true,
    fullPage: true,
    description: '場邊真正在用的畫面：手機上的逐局紀錄',
  },
  {
    name: 'admin-game-lineup',
    path: '/admin/games/g3?tab=lineup',
    admin: true,
    fullPage: true,
    description: '打線編輯與出賽名單圖卡',
  },
  {
    name: 'admin-game-video',
    path: '/admin/games/g3?tab=video',
    admin: true,
    fullPage: true,
    description: '「錄影管理」分頁：每半局一段，缺口是推導的',
  },
  {
    name: 'admin-game-new',
    path: '/admin/games/new',
    admin: true,
    fullPage: true,
    description: '新增比賽：可以丟一張賽程公告圖讓 Gemini 辨識',
  },
  {
    name: 'admin-players',
    path: '/admin/players',
    admin: true,
    fullPage: true,
    description: '球員管理',
  },
  {
    name: 'admin-push',
    path: '/admin/push',
    admin: true,
    fullPage: true,
    description: '推播與排程提醒（可以立即執行一次）',
  },
]
