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
