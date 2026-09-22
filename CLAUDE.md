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

## 這個 repo 踩過的坑

- **元件自動匯入名稱是「目錄名 + 檔名」**，檔名已用目錄名開頭才會去重。
  `components/news/AnnouncementCard.vue` → `NewsAnnouncementCard`（不是 `AnnouncementCard`）。
  寫錯不會報錯，只會渲染成 `<!---->`，而 API、payload 全部正常，極難查。
- **client-only plugin 註冊的指令不能用在會 SSR 的元件上** — 伺服器端解析不到指令，
  整個元件渲染成空。`app/plugins/reveal.ts` 刻意不是 `.client.ts`。
- **動畫不能讓內容預設隱藏** — `.reveal` 預設可見，JS 才把視窗外的元素藏起來。
  反過來做等於「內容的可見性依賴 JS 成功執行」。
- **列表頁一定要有 error 分支** — 少了它，「載入失敗」會長得跟「沒有資料」一模一樣。
- **e2e 必須隔離正式資料庫** — `tests/e2e/bff.test.ts` 開頭把 `NUXT_FIREBASE_*` 與
  `NUXT_GEMINI_API_KEY` 清成空字串。`.env` 一旦有真憑證，測試會直接寫進正式 Firestore。
- **flex/grid item 的 `min-width: auto`** 會撐破容器，`minmax(0,1fr)` 只約束軌道管不到 item。
- **Tailwind 掃不到執行期拼出來的 class**（`sm:${變數}`），完整名稱要寫死在原始碼裡。
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
