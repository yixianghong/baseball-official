# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

球隊官方網站（HG MERCENARIES）。前台呈現賽程、戰績、球員、公告；後台管理全部內容，並用
Gemini 辨識圖片自動建檔。以 `yixianghong/frontend-template` 為基底，回覆與註解使用繁體中文。

## 指令

| 指令                           | 用途                                                     |
| ------------------------------ | -------------------------------------------------------- |
| `pnpm dev`                     | 開發伺服器（3000）                                       |
| `pnpm lint` / `lint:fix`       | ESLint                                                   |
| `pnpm format` / `format:check` | Prettier                                                 |
| `pnpm typecheck`               | `vue-tsc`，約 60–90 秒                                   |
| `pnpm test`                    | 全部測試                                                 |
| `pnpm test:unit`               | 純邏輯（毫秒級，改完邏輯先跑這個）                       |
| `pnpm test:nuxt`               | 元件與 composable（happy-dom）                           |
| `pnpm test:e2e`                | 完整建置 + 真實伺服器（約一分鐘）                        |
| `pnpm seed`                    | 在空的 Firestore 建立示範資料（要加 `--confirm` 才寫入） |

跑單一檔案或單一測試：

```bash
pnpm vitest run --project unit tests/unit/game-logic.test.ts
pnpm vitest run --project nuxt -t "載入當下不會寫入資料庫"
```

`-t` 只在指定的 project 內比對，測試名稱找錯 project 會靜靜地全部 skip。

husky：commit 跑 lint-staged，push 跑 `typecheck && test:unit && test:nuxt`（不跑 e2e）。
commitlint 用 conventional commits。

**不要自動 `git commit` 或 `git push`。** 改完停下來說明改了什麼，提交與推送由使用者自己執行。
需要的話把建議的 commit 訊息寫出來給他用，但不要代為執行。

## 架構

樣板原本是「前端 → BFF → 外部 API」，這個專案把最下游換成 Firebase：

```
瀏覽器 → app/（Vue 3，只認得 /api/*）
        → server/（Nitro BFF，唯一持有憑證的地方）
        → Firestore / Storage / Gemini / Identity Toolkit
```

**前端完全不載入 Firebase SDK，也拿不到任何 token。** 後台登入是 BFF 在伺服器端向
Identity Toolkit 驗證帳密，再改發樣板自己的 httpOnly 加密 session。

### 四條分層紀律

1. **頁面不寫 API 路徑** — 一律經過 `app/composables/api/` 的領域 composable。
   命名慣例：`useXxxs()` 宣告式（`useApiFetch`，參與 SSR）、`useXxxActions()` 命令式（`useApi`）。
2. **端點不直接碰 Firestore** — 一律經過 `server/repositories/`。資料來源要換只改那個資料夾。
3. **型別與驗證寫在 `shared/schemas/`** — 後端執行期驗證、前端 `z.infer` 取型別，同一份。
   查詢上限這類前後端都要用的數字也定在這裡（例如 `MAX_GAME_QUERY_LIMIT`），
   兩邊各自寫死遲早會對不上。
4. **寫入端點先 `await requireUser(event)`** — 路由 middleware 只是體驗，真正的檢查在 BFF。

### Firebase 的兩種模式

`server/utils/firebase.ts` 依設定決定：

- **service account**（本機）：`.env` 有 `clientEmail` + `privateKey`
- **ADC**（App Hosting / Cloud Run）：只有 `projectId`，用執行環境本身的身分
- **記憶體模式**：連 `projectId` 都沒有時，repository 改用 `server/utils/memory-store.ts`
  的示範資料。這讓專案 clone 下來就能跑，e2e 也不必依賴 Firestore emulator。

production 缺少必要設定會在啟動時被 `server/plugins/00.env-validate.ts` 擋下 —— 刻意不讓它
悄悄降級跑在示範資料上。`ALLOW_MEMORY_STORE=true` 是給 e2e 的唯一例外。

### AI 辨識（四支端點，`server/utils/gemini.ts`）

賽程公告圖、計分板照片、Excel 球員名冊、LINE 出席投票截圖。共同的設計：

- 用 `responseSchema` 強制結構化 JSON 輸出，不解析散文
- **端點不寫入任何資料** — 回傳的是建議，一律先進後台表單讓人確認
- 格式收斂（日期、守備位置、慣用手的各種寫法）用程式碼處理，不靠提示詞叮嚀，
  而且可以測（`tests/unit/*-normalize.test.ts`）
- 名冊與出席辨識會把現有名單一起送給模型做名字對應（LINE 暱稱不是本名）

### 資料模型（Firestore）

打線、出席、計分板都**內嵌在 `games` 文件裡** —— 遠小於 1MB 上限，看一場比賽只要一次讀取。

- 計分板存「我隊／對手」而非「上下半局」，誰先攻由 `homeAway` 推導
- 逐局得分 `null` 是「沒打這半局」（顯示 X），`0` 是「打了沒得分」
- **R（總得分）一律是逐局加總**（`withSummedRuns()`，在 repository 套用），
  後台是一格唯讀的數字。H／E 沒有逐局欄位可以加總，維持人工輸入
- **比賽狀態是一條時間線**：`scheduled`（尚未開始）→ `live`（比賽中）→
  `finished`（比賽結束），前台完全依它分流 —— 開打之後顯示 LIVE 與即時比數，
  結束後顯示 FINAL 與勝敗。`postponed`／`canceled` 是岔出去的兩條。
  狀態是人按的，不從日期時間推算：一場比賽打多久沒有定數，用時數推算的話，
  忘了按結束的場次會自己「打完」，真正還在打的場次反而可能被判定結束。
- **勝敗不存欄位，由 `gameResult()` 推導**（狀態 + 計分板總分），
  而且**只有 `finished` 才有值**。理由見下方「比賽結果」
- 打線只有一份：賽前排的陣容就是賽後的紀錄，前台依狀態改稱呼
- 打線與出席存姓名快照，球員改名不影響歷史紀錄
- **候補名單是推導的，不存欄位**（`deriveBench()`：出席 `yes` 且不在打線上）。
  多存一份就多一個會不同步的東西 —— 排進打線卻忘了從候補移除，同一個人就會
  既先發又候補。比對以 `playerId` 為主、姓名為輔（打線允許沒有 `playerId`）。

## 這個 repo 踩過的坑

- **元件自動匯入名稱是「目錄名 + 檔名」**，檔名已用目錄名開頭才會去重。
  `components/news/AnnouncementCard.vue` → `NewsAnnouncementCard`（不是 `AnnouncementCard`）。
  寫錯不會報錯，只會渲染成 `<!---->`，而 API、payload 全部正常，極難查。
- **client-only plugin 註冊的指令不能用在會 SSR 的元件上** — 伺服器端解析不到指令，
  整個元件渲染成空。`app/plugins/reveal.ts` 刻意不是 `.client.ts`。
- **動畫不能讓內容預設隱藏** — `.reveal` 預設可見，JS 才把視窗外的元素藏起來。
  反過來做等於「內容的可見性依賴 JS 成功執行」。
- **`v-reveal` 不能用 IntersectionObserver** — IO 只在「相交狀態改變」時觸發。元素
  掛載時在視窗下方（不相交），使用者一口氣跳到頁面底部後變成在視窗上方 ——
  仍然是不相交，狀態沒變，**回呼永遠不會再被呼叫**，元素就永遠停在 `opacity: 0`。
  錨點連結、按 End、重新整理時瀏覽器還原捲動位置都會走到這條路。實測慢慢捲
  6 個全部正常、一次跳到底 6 個全部隱形。現在改用共用的捲動監聽器逐一檢查。
- **深色模式不能靠陰影做層次** — 陰影是「比背景更暗」，在 `oklch(0.21)` 的底色上
  疊黑色幾乎看不出來。`.surface-card` 在深色下改用頂緣亮邊 + 由上而下的微弱漸層。
- **列表頁一定要有 error 分支** — 少了它，「載入失敗」會長得跟「沒有資料」一模一樣。
- **e2e 必須隔離所有外部服務** — `tests/e2e/bff.test.ts` 開頭把 `NUXT_FIREBASE_*`、
  `NUXT_GEMINI_API_KEY` 與 `NUXT_CWA_API_KEY` 清成空字串。`.env` 一旦有真憑證，
  測試會直接寫進正式 Firestore、或真的去打氣象署的 API。**新增任何外部服務的金鑰時，
  記得回來加一行。**
- **flex/grid item 的 `min-width: auto`** 會撐破容器，`minmax(0,1fr)` 只約束軌道管不到 item。
- **Tailwind 掃不到執行期拼出來的 class**（`sm:${變數}`），完整名稱要寫死在原始碼裡。
- **`watchEffect` 會立刻執行一次，所以不能放在它用到的 `const` 之前** —
  `const` 在宣告前是暫時性死區，開啟頁面當下就拋
  `Cannot access 'X' before initialization`，整頁掛掉。`computed` 是惰性的所以
  放前面不會爆，但兩者看起來一模一樣、讀者分不出來。
  `eslint.config.mjs` 的 `no-use-before-define` 現在會擋下這種寫法。
- **「有沒有資料」不等於「是不是有效的選擇」** — 比賽月曆原本用
  「這個月有沒有比賽」判斷選到的月份是否有效，於是翻到空月份時立刻被彈回去，
  看起來就是**上一個月／下一個月按鈕沒反應**（值改了又在同一幀被改回來）。
  正確的條件是「有沒有超出最早～最晚的範圍」，見 `clampMonth()`。
  種子資料的月份剛好連續，所以本機測不出來 —— 線上是七月與九月各一場、八月空著。
- **`inputSchema.partial()` 不能拿來當 PATCH 的 schema。** `.partial()` 只是把欄位
  變成選填，**帶 `.default()` 的欄位在鍵不存在時照樣會套用預設值** —— 於是一個
  「只把狀態改成比賽結束」的 PATCH，實際上會把場地、出席、打線、計分板通通
  重設成空的，而 API 回應與畫面**完全看不出異常**。`updateGame()` 這類
  `{ ...existing, ...patch }` 的合併完全依賴「沒送的鍵不存在」這個前提。
  一律用 `shared/schemas/common.ts` 的 `patchSchemaOf()`（它會先把 `ZodDefault`
  拆掉再轉選填），`tests/unit/game-logic.test.ts` 的 `gamePatchSchema` 那組守著它。
- **改檔案前先讀** — prettier 會重排 template，憑印象做字串替換常常匹配不到。
- **SSR 內部的 `$fetch` 一樣會經過 server middleware，但沒有來源 IP。**
  限流因此把全站訪客的 SSR 請求算進同一個 `'unknown'` 桶子 —— 一次首頁渲染
  4 支內部 API，額度 100／分鐘等於全站每分鐘 25 次瀏覽就爆掉，而且**爆掉的樣子是
  頁面照常回 200、資料全部消失**。`30.rate-limit.ts` 認不出用戶端就直接放行，
  `tests/e2e/rate-limit.test.ts` 守著這個行為。
- **`setup({ nuxtConfig: { runtimeConfig } })` 會被環境變數蓋掉。**
  本機 `.env` 有值、CI 沒有，就會出現「本機全過、CI 掛」而且完全重現不了的狀況。
  要在測試裡強制某個設定，用 `process.env.NUXT_XXX` 而不是 `nuxtConfig`。
- **Nuxt plugin 裡不能只掛 `window.addEventListener('load')`** — plugin 在 hydration
  階段執行，那時 `load` 常常已經發生過了，監聽器永遠不會被呼叫。要先檢查
  `document.readyState`。`app/plugins/pwa.client.ts` 就是因為這個而安靜地沒註冊 SW。
- **黏在頂端的 header 一定要 `pt-[env(safe-area-inset-top)]`。** head 裡設了
  `apple-mobile-web-app-status-bar-style: black-translucent`，加到主畫面之後
  內容會延伸到狀態列底下（那是刻意的，導覽列要鋪到最頂端才好看）。少了這個內距，
  選單鈕就會被瀏海／動態島壓住 —— 而這**只在加到主畫面之後才看得到**，
  一般瀏覽分頁完全正常。前台修好之後後台又踩了一次，現在 e2e 兩邊都守著。
  橫向時瀏海吃的是**側邊**，所以錄影頁留的是 left/right（見「球賽錄影」）。
- **公開頁面的 SSR 輸出不能因人而異** — 它們會被 CDN 快取送給所有訪客。加 cookie、
  依 cookie 改渲染、把登入狀態畫進 HTML，都會默默破壞快取或把狀態送給別人，
  而且畫面上完全看不出來。詳見「部署」章節。

### 天氣預報（`server/utils/cwa.ts`）

中央氣象署 `F-D0047-091`（一週預報，實際回傳 22 個縣市）。**結構是打過真 API
確認的，不要照文件猜**：外層 `records.Locations[].Location[]` 大寫開頭、
`ElementName` 是中文（`天氣現象`／`最高溫度`／`12小時降雨機率`）、篩選參數是
大寫的 `LocationName`（小寫會被無視並回傳 20 倍的資料）。`F-C0032-005` 不存在。

`/api/games/[id]/weather` 是獨立端點，不併進比賽資料 —— 氣象署慢或掛掉時不該
讓整個比賽頁跟著壞，比賽頁也才能繼續走 CDN 快取。前端 `server: false`。

縣市是後台明確選的，不從場地名稱猜：猜錯會顯示成別的縣市的天氣，比不顯示更糟。

### 字體（全站）

**`body` 的預設字體是 `--font-display`（Oswald + 系統黑體），不是 `--font-sans`。**
這一行的影響範圍比看起來小得多：Oswald 的 `@font-face` 只宣告了 latin 的
`unicode-range`，所以**中文永遠落在後面的系統黑體**，改變的只有數字與英文字母。
`#97 陳育廷` 因此不需要拆成兩個 span 就會自動「數字窄黑體、名字蘋方」。

**表單控制項是例外**，維持 `--font-sans`。窄黑體適合「被掃過的標籤與數字」，
不適合「正在被輸入的內容」—— 後台要打的是網址、信箱、公告內文這些需要逐字確認的
東西。⚠️ 那條規則**不能包在 `:where()` 裡**：Tailwind 的 preflight 有一條
`input, textarea, select { font: inherit }`，權重 (0,0,3) 會贏過 `:where()` 的 0，
結果是規則看起來沒生效、輸入框安靜地繼承了窄黑體。

**⚠️ Oswald 沒有 tabular figures。** `font-variant-numeric: tabular-nums` 在它身上
是完全無效的（實測 `111` 45px、`888` 60px，加不加一樣）。所以**數字欄位的對齊必須
來自版面**（表格的欄寬、格子的置中），不能指望 `tabular-nums`。計分板與月曆都是
靠 `<table>` 與 grid 對齊的，所以沒有受影響 —— 但新增會排成一欄的數字時要記得這件事。

**字型檔案自己放在 `public/fonts/`，不連 Google Fonts。** 三個理由各自都足夠：
CSP 的 `font-src`／`style-src` 都只有 `'self'`；`modern-screenshot` 截圖時要把字型
內嵌進 PNG，跨網域常常抓不到（症狀是螢幕上好好的、下載下來的圖字型不一樣）；
PWA 離線時外部字型不在 service worker 的快取裡。latin 子集只有 21KB，
在 `nuxt.config.ts` 的 `head.link` 預載（它是全站每一頁首次繪製都會用到的字體）。

### 比賽結果（`gameResult()`）

**勝敗不是一個存起來的欄位，也沒有手動覆寫的選項。** 它完全由「狀態」與
「計分板總分」決定，和候補名單是同一個道理（見 `deriveBench()`）——
多存一份就多一個會不同步的東西。曾經有一個「比賽結果」下拉選單可以覆寫，
實際發生的事是：改完計分板忘了回頭改它，前台就出現「6:3」配上一個「敗」。

**只有 `finished` 才有結果**，其餘一律 `null`。空的計分板總分是 0:0，不綁狀態的話
每一場還沒打的比賽都會帶著一個「和」—— 而 0:0 的「和」和「還沒打」在畫面上
長得一模一樣。進行中同理：領先不等於贏了。

`result` 已經從 `gameInputSchema` 移除，所以舊文件上殘留的那個欄位在讀取時會被
schema 丟掉（Firestore 上的鍵還在，但沒有任何程式碼看它）。後台「賽事管理」
分頁上的「判定結果」只顯示、不能改，而且和前台走同一支函式 ——
後台看到「勝」，前台就不可能是「敗」。

戰績統計走 `tallyRecord()`，它**只算已結束的場次**：傳進去的通常就是「過去的
比賽」，而那裡面混著延賽的場次（它們也列在結果頁上）。

**R（總得分）同理，一律是逐局加總**（`withSummedRuns()`）。後台曾經有一顆
「用逐局加總填入 R」的按鈕 —— 那等於把「保持一致」外包給使用者記得按，
沒按的下場是逐局 3:1、R 欄 0:0，而**前台的比數、勝敗、戰績全部讀 R**，
錯的是整個網站而不只是那張表格。現在 R 在後台是一格唯讀的數字，
並且在 repository 統一套用，AI 辨識與批次匯入走的是同一條路。
H／E 沒有逐局欄位可以加總，所以維持人工輸入。

`withSummedRuns()` 在本來就一致時**回傳同一個物件參考**：後台是自動儲存的，
每次都回新物件會讓「光是打開頁面」就送出一次 PATCH。

### 出賽名單圖卡的資料界線

`useShareRoster()` 的 `capture()` 會先 `await document.fonts.ready`。
`font-display: swap` 在螢幕上只是閃一下，但**截圖會把那一瞬間定格**，
而且只發生在字型還沒被快取的第一次，極難重現。

**名牌上只有「#背號 名字」。** 轉播圖卡上的打擊率、OPS、CLEANUP 徽章那些東西
一概不放：資料模型裡沒有球員數據（統計是明確的範圍外項目），而名單會被截圖
傳到群組，上面的每個數字都會被當真 —— 憑空生一個 `AVG .342` 比留白糟糕得多。

曾經放過三項「推導得出來」的資訊（投打習慣、`CLEANUP`、有沒有 DH），後來全部
拿掉了：算得出來不等於該放，一張要被快速掃過的名單上，每多一個標籤就讓名字
少一分醒目。卡片上唯一的附加文字是投手紀錄的 `note`（例如「6 局 2 失分」），
那是人自己填的。

拿掉投打習慣之後，`/games/[id]` 也不再需要抓球員名冊 —— 那支 `usePlayers()`
當初就只是為了它。

### 公告的 Markdown（`app/utils/markdown.ts`）

資料庫存的是 **Markdown 原始碼**，不是 HTML —— 存 HTML 等於把一堆可執行的標記
放進資料庫，日後想換渲染方式或抽純文字做摘要都得回頭清一次資料。

**安全性靠的是「解析器不會產生危險的 HTML」，不是事後清洗。** `html: false` 讓
原始碼裡的 `<script>`、`onerror=` 一律被跳脫成純文字，`validateLink` 再收成白名單
（http／https／mailto／tel／相對路徑）。所以 `v-html` 在這裡是安全的，也不需要在
伺服器端模擬 DOM 去跑 DOMPurify。要動這幾個設定前先看 `tests/unit/markdown.test.ts`。

**`breaks: true` 是相容性需求而不是偏好**：公告原本是純文字、以 `pre-wrap` 呈現，
作者按的每個 Enter 都看得到。CommonMark 預設單一換行只是空白，關掉它既有的公告
會整篇擠成一段。

只能放純文字的地方（後台列表、推播內容）走 `markdownToText()`。它走的是**同一個
解析器的 token 樹**，不是正規表示式 —— 「這兩個星號是不是語法」沒辦法用 regex
正確判斷，而摘要跟內文對不上會很奇怪。

**首頁與公告牆用同一張卡片，沒有摘要模式。** 曾經有一個 `compact` 版本
（內文裁四行、附件收成「N 個附件」），但這個球隊的公告多半是「一句話 + 一個檔案」
—— 戰績表那則的內文只有「更新日期 - 2026/05/18」，**附件才是公告的內容**。
收起來，首頁那張卡就等於什麼都沒說。代價是很長的公告會把首頁撐高；真的遇到時
該做的是公告詳細頁，而不是把內容藏起來假裝版面很整齊。

後台編輯器 `AdminMarkdownEditor` 的預覽用的是前台那個 `UiBaseMarkdown`，
所以「預覽沒問題、發布後跑版」不可能發生。工具列的文字操作全在
`app/utils/markdown-edit.ts`，是純函式，每一種邊界情況都測得到。

### 公告附件（`shared/schemas/attachment.ts`）

上傳的檔案**會被公開提供**（Storage 的公開網址，或開發模式下同源的
`/api/media/…`），所以型別是**白名單**而不是黑名單，而且刻意很短：

- **不收 `image/svg+xml`** —— SVG 可以內嵌 `<script>`，點開就執行。
- **不收 `text/html`**，也不收 `.zip`（裡面可以是任何東西，收它只是為了省事）。
- `/api/media/[id]` 回 `X-Content-Type-Options: nosniff`。少了它，一個宣稱是
  `text/plain` 但內容像 HTML 的檔案可能被瀏覽器猜成網頁執行 —— 同源的 XSS。

**附件的 `url` 要擋 `//`**。`//evil.test/a.pdf` 以 `/` 開頭卻指向外部站台，
和推播通知的 `url` 是同一個坑。schema 是最後一道防線，不能因為「值都是我們
自己產生的」就省略。

副檔名一律由 MIME 決定，不採信使用者傳來的檔名 —— 檔名裡的 `../`、`.html`
都不該有機會影響 Storage 上的物件路徑。

`Content-Disposition` 用 `inline` + RFC 5987 的 `filename*=UTF-8''…`：
瀏覽器開得了的（圖片、PDF）直接開，開不了的自動下載，而中文檔名不會變成
`___.pdf`（那個標頭是 latin-1，非 ASCII 必須另外編碼）。前台的連結刻意
**不加 `download` 屬性** —— 跨網域時它會被忽略，變成「有時下載、有時開分頁」。

附件不壓縮（圖片欄位會壓）：使用者附上的那一份就是他要的那一份。
單檔上限 6MB，對應 `maxUploadBytes` 的 8MB 扣掉 base64 的 33% 膨脹。

### 球賽錄影（階段 1）

規格在 `docs/game-recording-plan.md`。後台 `/admin/record/[id]` 用瀏覽器原生的
`getUserMedia()` + `MediaRecorder` **每半局錄一段**（攻守交換就是天然的切點），
目前只存到手機、還不上傳。錄完自動推進到下一個半局（`nextHalf()`）——
場邊的人兩隻手都在忙，一場要按十四次，不該還要手動選局數。

**⚠️ `Permissions-Policy` 是第一個會擋死相機的東西。**
`10.security-headers.ts` 現在送的是 `camera=(self), microphone=(self)`。
關著的時候 `getUserMedia()` 會直接失敗，而且**錯誤訊息完全不會提到這個標頭** ——
看起來就像使用者拒絕了權限或相機壞掉。`tests/e2e/bff.test.ts` 守著這一行。

**分段而不是一次錄完整場**：手機瀏覽器分頁一進背景 `MediaRecorder` 就會停，
分段代表最壞只損失半局。`recorder.start(5_000)` 的 timeslice 是同一個理由。

**⚠️ 影片片段存 `top`／`bottom`，計分板存 `our`／`opponent`** —— 看起來矛盾，
但記的是不同的事實：分數天生屬於某一隊（上下半局由 `homeAway` 推導），
而「這段拍的是哪半局」是拍攝當下的物理事實。`homeAway` 填錯又改回來時，
計分板會跟著修正、影片標籤不會 —— 兩個都正確。誰在打擊由
`battingSide(half, homeAway)` 推導（客隊先攻）。理由寫在 `gameHalfSchema` 上。

**`stop()` 一定要等 `onstop` 才能組 Blob** —— 最後一塊資料是在 `stop()` 回來**之後**
才透過 `ondataavailable` 送到的，提早組會讓每一局都少掉最後幾秒，而且錄的當下
完全看不出來。

**mp4 一定要排在 webm 前面**（`app/utils/recording.ts` 的 `MIME_CANDIDATES`）：
Safari 只錄得出 mp4，Chrome 兩種都行。順序反過來 Android 會錄成 webm，
而 **webm 在 iPhone 上完全播不動** —— 錄的人看不出異常，一半的家屬打開是黑的。

**橫向是主要姿勢，而且是另一套版面。** 實測直向的垂直堆疊有 855px 高，
橫向的可用高度只有 320px 上下 —— 照搬過去錄影鈕會在畫面外 459px。
用 `landscape:` variant 切兩欄，預覽靠**高度**撐滿（橫向不能用 `w-full`，
16:9 會算出比視窗還高），**錄影鈕放在捲動區外面**。高度用 `dvh` 不用 `vh`
（`100vh` 含會收起的工具列），左右要留 `env(safe-area-inset-left/right)`
（橫向時瀏海吃的是側邊）。**不能用程式鎖定方向** —— `screen.orientation.lock()`
要先進全螢幕，而 iPhone 對非 video 元素的 Fullscreen API 長期不支援。

**⚠️ 畫面是橫的，錄出來可能是直的。** 各家瀏覽器對「裝置轉動時 video track
的寬高要不要交換」處理不一致，會出現預覽正常、檔案卻是 1080×1920 的情況，
而且在球場上看不出來。`portraitVideo` 偵測到就在預覽上壓紅色警告。
`getSettings()` 不是響應式的，轉動時要自己重讀。

**⚠️ API 上傳的影片一律是私人的，而且和我們送什麼無關。** 未通過 YouTube
合規稽核的專案（2020/07/28 之後建立的都算）強制如此。管理者要到 YouTube Studio
手動改成公開 —— 所以 `gameClipSchema` 有一個 `privacy` 欄位，而前台的
`visibleClips()` **只渲染非 private 的片段**：私人影片嵌進去只會顯示「無法播放」，
而那是訪客看到的畫面。寧可少一段，也不要一個壞掉的播放器。

**前台預設只載縮圖**（`i.ytimg.com`），點了才換成 iframe —— 一場最多十四段，
十四個 YouTube 播放器會把手機直接拖垮。CSP 的 `frame-src` 只開
`youtube-nocookie.com` 一個來源，沒有這一條會 fallback 到 `default-src 'self'`
而整個被擋，症狀只有 console 一行 `Refused to frame`。

**檔名要排得出比賽順序**：局數補零（第 10 局不會排在第 2 局前面），
上下半靠「上」(U+4E0A) 的碼位小於「下」(U+4E0B) —— 換成別的字會壞掉，
`tests/unit/recording.test.ts` 守著這個巧合。

**`deviceId` 每次重新取得權限都會變**，不能記住上次選的鏡頭；而且要先
`getUserMedia()` 拿到權限，`enumerateDevices()` 的 `label` 才不是空字串 ——
沒有 label 就分不出哪顆是超廣角。

判斷邏輯全在 `app/utils/recording.ts`（純函式、測得到），有狀態的那一半在
`app/composables/useGameRecorder.ts`。**相機本身只能用實機驗證**，
macOS 的無頭 Chrome 取不到相機。

### 分享出賽名單（`app/composables/useShareRoster.ts`）

把圖卡畫成 PNG 用 `modern-screenshot`，**點下去才動態 import**（它有二十幾 KB，
多數訪客不會按）。按鈕刻意放在被截的節點**外面**，不靠 `filter` 排除 ——
以後改版不會忘記更新。

下載與分享是**兩個獨立的動作**，不做成一顆會自己判斷的按鈕：使用者按下去
之前得知道會發生什麼。分享在不支援的瀏覽器上退回複製網址，並且明說原因。

`server/api/media/remote.get.ts` 是為了這件事而存在的圖片轉送：canvas 畫進
沒有 CORS 標頭的跨網域圖片會被污染，而 Storage 上的隊徽實測沒有那個標頭。
**它沒有登入保護，白名單是唯一的防線**（SSRF），判斷邏輯在 `isAllowed()`，
單元與 e2e 各有一組測試守著。

### 比賽自動提醒（排程）

賽前 3～7 天送一則出席提醒、賽前一天再送一則。判斷邏輯全在
`shared/schemas/reminder.ts` 的純函式裡，端點只負責「誰可以呼叫」與「送出去」。

**`minInstances: 0` 代表程式裡的計時器一定行不通。** 沒人瀏覽時容器整個關掉，
`setInterval` 只在「剛好有人正在看網站」時活著 —— 而要發提醒的清晨正是最沒有人
在看的時候。必須由外部的 Cloud Scheduler 每天叫一次
`POST /api/cron/game-reminders`。

**時區是這個功能最容易錯的地方。** Cloud Run 跑在 **UTC**（`apphosting.yaml`
沒設 `TZ`），台北時間 00:00–07:59 這八小時裡伺服器還停在前一天 —— 用
`toDateKey(new Date())` 算「今天」會讓所有提醒差一整天，而**本機完全重現不了**，
因為本機就是台北時間。一律用 `taipeiDateKey()`。`listGames()` 的 `scope: 'upcoming'`
也是同一個理由改過來的。

**記號在送出之後才寫。** 反過來做（先記號再發送）會在發送失敗時把提醒永久吞掉，
而「大家都沒收到通知」不會有人來回報。現在最壞的情況是重複送一次，那至少看得出來。
記號是比賽文件上的 `remindersSent`，刻意**不在 `gameInputSchema` 裡** —— 放進去的話
後台表單每次存檔都會把它一起送上來，漏帶一次就等於清掉記號、所有人再收一次。

**早鳥提醒是 3～7 天的區間而不是剛好第 7 天**：排程漏跑一次那一場就永遠收不到了。
下限是 3 而不是 1，否則新增一場後天的比賽會連兩天各收到一則講同一件事的通知。
文案講的是**實際還有幾天**，不是寫死「7 天後」—— 區間意味著它可能在第 5 天才送出。

`/api/cron/*` 是全站第二支沒有 session 也能呼叫的寫入端點（第一支是推播訂閱），
閘門是 Secret Manager 裡的 `NUXT_CRON_SECRET`，用 `timingSafeEqual` 比對。
**留空代表整個排程端點關閉**，不是「不用驗證」。已登入的管理者也放行，
後台推播頁的「立即執行一次」打的就是同一支端點 —— 驗證的必須是排程器實際會做的事。

建立排程工作（一個工作，在 Cloud Scheduler 的免費額度內）：

```bash
gcloud scheduler jobs create http game-reminders \
  --project hg-baseball --location asia-east1 \
  --schedule "0 9 * * *" --time-zone "Asia/Taipei" \
  --uri "https://baseball-official--hg-baseball.asia-east1.hosted.app/api/cron/game-reminders" \
  --http-method POST \
  --headers "x-cron-secret=<密鑰>,content-type=application/json" \
  --message-body "{}"
```

### PWA 與推播

`public/sw.js` 是**手寫的** service worker（沒有 Workbox），同時負責離線快取與推播。
註冊在 `app/plugins/pwa.client.ts`，開發模式不註冊 —— 要驗證請用 `pnpm build && pnpm start`。

推播走**標準 Web Push（VAPID）而不是 FCM**：FCM 要在瀏覽器載入 Firebase SDK，
那會推翻「前端完全不載入 Firebase SDK」這條設計。發送用 `web-push` 套件
（ECDH + HKDF + AES-GCM 不該自己實作），金鑰只在 `server/utils/push.ts`。

三個容易踩的點：

- **`/api/push/subscribe` 是全站唯一沒有 `requireUser()` 的寫入端點**（訂閱的是
  一般訪客）。它的防線是 `isKnownPushService()` —— 少了這條，這支端點就變成
  「任何人都能叫伺服器去打任意網址」（SSRF）。
- **通知的 `url` 只能是站內路徑，而且要擋掉 `//`**。`//evil.test` 以 `/` 開頭，
  但 `new URL()` 會把它解析成外部網站，結果是一則外觀來自球隊的釣魚通知。
- **VAPID 三項要嘛全設、要嘛全不設**。只設一半的症狀是前台訂閱按鈕整個消失，
  看起來像功能沒做。`00.env-validate.ts` 會對這個狀況發警告。
- **換了 VAPID 公鑰之後，舊訂閱會擋住新的訂閱**。瀏覽器不允許同一個 registration
  存在兩個不同 `applicationServerKey` 的訂閱，直接 `subscribe()` 會拋
  `InvalidStateError`。症狀是「按了開啟通知沒反應」，而且**只發生在曾經訂閱過的
  裝置上**，乾淨的瀏覽器測不出來。`usePushSubscription` 會先比對金鑰、退掉舊的
  再訂新的（`isSameApplicationServerKey`）。本機與正式環境各用一組金鑰時，
  同一台電腦切換兩邊就會遇到。

iOS 必須先「加入主畫面」才能訂閱推播，這是系統限制，前台頁尾直接把這件事寫出來。

## 部署

Firebase App Hosting（`apphosting.yaml`），推 `main` 自動建置部署。
GitHub Actions 只負責品質把關，兩者並行，所以正式流程是
`功能分支 → PR → CI 通過 → 合併 main`。

機密放 Cloud Secret Manager。`firebase apphosting:secrets:set` 問「要不要加進
apphosting.yaml」時**選 No** —— 它推導出的變數名沒有 `NUXT_` 前綴，Nuxt 讀不到；
而 `FIREBASE_` 開頭還會撞上 App Hosting 的保留前綴。

`firestore.rules` 全部拒絕、`storage.rules` 只開放讀取：所有存取都走 BFF 的 service
account（不受規則限制），規則擋的是「瀏覽器直接連資料庫」那條路。

### 公開頁面走 CDN 快取

`minInstances: 0`，沒人看的時候縮到零（冷啟動實測約 2.7 秒）。冷啟動不靠付錢
解決，靠 CDN：公開頁面在 `nuxt.config.ts` 的 `routeRules` 帶
`public, max-age=0, s-maxage=60, stale-while-revalidate=600`，過期後 CDN 先送舊的
再背景更新，**冷啟動因此不在使用者的等待路徑上**。

代價是「同一份 HTML 送給所有人」，所以公開頁面的 SSR 輸出**不能包含任何個人狀態**：

- 配色偏好由 `<head>` 的開機腳本在瀏覽器端套用（`shared/constants/theme.ts`），
  SSR 不輸出 `class="dark"`。會被快取的頁面裡不要用 `isDark` 決定渲染什麼，
  改用 Tailwind 的 `dark:` variant 讓 CSS 決定。
- 登入狀態只在 `/admin` 的 SSR 還原，公開頁面進瀏覽器後才問 `/api/auth/me`
  （`app/app.vue`）。
- **回應只要帶一個 `Set-Cookie`，CDN 就完全不快取。** i18n 的語言偵測因此關掉，
  `useCookie` 也不能給 `default`（給了 SSR 就會寫回 cookie）。

`tests/e2e/bff.test.ts` 的「CDN 快取」那組測試守著這些條件 —— 它們檢查的是
header 與「兩種 cookie 拿到的畫面一樣」，因為這類失效在畫面上完全看不出來。

App Hosting **沒有清除 CDN 快取的手段**，只能等 TTL。60 秒是「後台改完馬上想看到」
與「快取有效」的折衷。API 刻意不快取：SSR 取資料走 Nitro 內部呼叫不經過 CDN，
而後台讀的是同一批端點，快取只會讓「我明明存檔了」變成客訴。

## 其他

- 內容以繁體中文為主，i18n 模組保留但只維護 `zh-TW`
- 配色取自球衣與隊徽，定義在 `app/assets/css/main.css` 的 `@theme`：
  `--color-brand-*`（teal）、`--color-accent-*`（金）、`--color-ink*`（墨藍）
- `docs/CONTRIBUTING.md` 有更完整的分層說明與環境設定
