# 球隊官方網站

前台呈現賽程、戰績、球員與公告；後台管理全部內容，並可用 **Gemini 圖片辨識**
把官方賽程公告圖與計分板照片自動轉成資料。

以 [`yixianghong/frontend-template`](https://github.com/yixianghong/frontend-template)
為基底（Nuxt 4 + Nitro BFF + Tailwind 4 + Zod + Pinia + Pino）。

---

## 架構

樣板原本的三層是「前端 → BFF → 外部 API」。這個專案把最下游換成 Firebase：

```
瀏覽器 → Nuxt 前端 (app/) → BFF / Nitro (server/) → Firestore / Storage / Gemini
```

- `app/` 前端（Vue 3 + Tailwind 4），**只認得 `/api/*`**
- `server/` BFF（Nitro / h3 v1），**唯一持有 Firebase 憑證與 Gemini 金鑰的地方**
- `shared/` 前後端共用的型別、錯誤碼、zod schema

前端完全不載入 Firebase SDK，也拿不到任何 token。後台登入是由 BFF 在伺服器端
向 Firebase 驗證帳密，再改發自己的 httpOnly 加密 session cookie ——
就算發生 XSS，攻擊者也偷不走任何憑證。

### 沒有 Firebase 憑證時會發生什麼

`pnpm dev` 直接跑得起來：資料會使用 `server/utils/memory-store.ts` 裡的示範
內容（球員、賽程、戰績、公告都有），後台用**任何 email + 密碼 `password1234`**
就能登入。這讓專案 clone 下來就能看到完整畫面，測試也不必依賴 Firestore emulator。

記憶體資料重啟即失。**production 缺少憑證會在啟動時直接拒絕啟動**，不會悄悄
跑在示範資料上（見 `server/plugins/00.env-validate.ts`）。

---

## 快速開始

```bash
pnpm install
cp .env.example .env                       # 產生 session 密鑰：openssl rand -base64 48
pnpm dev                                   # http://localhost:3000
```

後台在 <http://localhost:3000/admin>。還沒接 Firebase 時，用任何 email
搭配密碼 `password1234` 登入。

---

## Firebase 設定

### 1. 建立專案與資料庫

1. 到 [Firebase Console](https://console.firebase.google.com/) 建立專案
2. **Firestore Database** → 建立資料庫 → 選「正式版模式」
   （安全規則可以維持預設的全部拒絕：所有存取都經過 BFF 的 service account，
   不受安全規則限制，反而是「沒有任何用戶端能直接讀寫資料庫」比較安全）
3. **Storage** → 開始使用（要上傳球員照片與公告圖才需要）
4. **Authentication** → 開始使用 → 啟用「電子郵件/密碼」

### 2. 新增後台帳號

**Authentication → Users → 新增使用者**，填入 email 與密碼即可。

這個專案刻意**不做後台帳號管理介面** —— 新增、停用、重設密碼全部在
Firebase Console 操作，少一套自己維護的密碼儲存就少一個風險。

要區分權限時，用 Firebase 的 custom claims 設 `roles: ['admin']` 或
`role: 'editor'`；沒有設定任何 claim 的使用者一律視為 `admin`。

### 3. 取得憑證

- **服務帳戶金鑰**：專案設定 → 服務帳戶 → 產生新的私密金鑰，下載的 JSON 裡有
  `project_id`、`client_email`、`private_key`
- **Web API 金鑰**：專案設定 → 一般 → 網頁 API 金鑰

填進 `.env`：

```bash
NUXT_FIREBASE_PROJECT_ID=your-project-id
NUXT_FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxx@your-project.iam.gserviceaccount.com
# 私鑰是多行的，.env 無法直接換行 —— 保留 JSON 裡的 \n 字面寫法，整串用雙引號包起來
NUXT_FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n"
NUXT_FIREBASE_STORAGE_BUCKET=your-project.firebasestorage.app
NUXT_FIREBASE_WEB_API_KEY=AIza...
```

重啟 `pnpm dev`，啟動日誌若沒有出現「未設定 Firebase 憑證」的警告就接上了。

### 4. 建立初始資料（選用）

剛接上時 Firestore 是空的，網站看起來會像壞掉一樣。可以先灌一份示範內容
看看版面實際的樣子：

```bash
pnpm seed              # 只顯示將寫入什麼，不動資料庫
pnpm seed --confirm    # 實際寫入
```

腳本只在「completely 空的 collection」上動作：任何一個 collection 已經有資料就
整個中止，`siteSettings` 也只在完全不存在時才建立 —— 你已經上傳的隊徽與填的
隊名不會被覆蓋。之後到後台把示範內容逐筆換成真實資料即可。

### Storage 的公開讀取

上傳的圖片會被設為公開讀取（官網圖片本來就要讓所有人看得到）。若你的 bucket
啟用了 uniform bucket-level access，`makePublic()` 會失敗並在日誌留下警告 ——
請在 Console 把 bucket 設為公開讀取，或改用「貼上網址」的方式放圖片。

---

## Gemini 圖片辨識

到 [Google AI Studio](https://aistudio.google.com/apikey) 產生 API key：

```bash
NUXT_GEMINI_API_KEY=...
NUXT_GEMINI_MODEL=gemini-2.5-flash    # 換模型不需要改程式碼
```

沒有設定時，後台的辨識按鈕會明確回報「尚未設定 Gemini API 金鑰」，其餘功能
完全不受影響。

### 辨識賽程公告圖

**後台 → 賽程與結果 → 用賽程圖新增**

上傳整張賽程公告，系統會挑出**含我隊的所有場次**，其他隊伍之間的對戰自動忽略。
比對用的隊名來自「網站設定」的球隊名稱、簡稱與「其他寫法」—— 官方公告常用簡稱，
把常見寫法都列進去可以明顯提高命中率。

辨識結果會進到一個可勾選、可編輯的列表，**確認後才建立**。信心值偏低的那幾列
會被標示出來，缺日期或對手的預設不勾選。

### 辨識出席調查

**後台 → 編輯某場比賽 → 出席統計 → 用 LINE 投票截圖填寫**

出席調查多半在 LINE 上進行（投票、接龍、群組回覆），投票結束後還要把結果
一個一個敲進後台。上傳截圖就能一次填好。

**難的不是讀字，是對應名字** —— LINE 顯示的是暱稱，「阿豪」是「張志豪」、
「冠宇」少了姓。所以辨識時會把現有名單一起送給模型做對應，每一筆回來都帶著
它認為對應到哪位球員，對不上的用下拉直接改。與其追求模型百分之百正確，
不如讓修正只要一次點擊。

套用時**只動辨識結果涵蓋到的人**，沒出現在截圖裡的球員維持原狀 —— 分兩次上傳
（先投票、後來有人補回覆）不會把先前的回覆洗掉。

狀態認不得時一律當作「未回覆」，絕不猜測：猜錯一個人，名單上看起來是確定的，
實際上沒人知道他到底來不來。

### 辨識球員名冊

**後台 → 球員名單 → 從名冊匯入**

球隊的名冊多半是 Excel 或 Google 試算表。把畫面截圖上傳，系統會逐列讀出姓名、
背號、守備位置與投打習慣，表頭那一列自動略過。

名冊上的寫法很雜，這些都在後端就正規化好了（見 `server/utils/gemini.ts`）：

- 守備位置：`投手`／`投`／`P`／`先發` 都對應到 `P`；`內野手` 這種沒指定守位的歸到工具人
- 慣用手：`右投右打` 會拆成投球 `R` 與打擊 `R`；`左右開弓` 對應到打擊 `S`
- 加入年份：民國年自動換算成西元

**已經在名單裡的人會被標示出來並預設不勾選**，用姓名與背號比對 —— 名冊更新一版
整張再傳一次，不會變成全隊都多一份。

大頭照與缺漏的守備位置匯入後再到「球員名單」逐位補上；這一頁的價值是把姓名與
背號一次搬進來。

### 辨識計分板

**後台 → 編輯某場比賽 → 計分板與結果 → 選擇計分板照片**

讀出逐局得分與 R／H／E 填進表單。後端會驗算「逐局加總 = 總分」，對不起來就
降低信心值並指出是哪一邊 —— 這是計分板辨識最常出錯的地方。

### 設計原則：AI 不寫資料庫

`/api/admin/ai/*` 這四支端點**不會寫入任何資料**。它們回傳的是建議，一律要
經過人確認、修改，再由 `/api/admin/games`、`/api/admin/players/batch` 或比賽的
更新端點真正寫入。
「AI 猜的」與「人確認的」因此永遠分得清楚。

---

## 版面與配色

視覺上參考職業球團官網的作法：深色實心導覽列（左上角是隊徽座）、滿版主視覺，
以及壓在主視覺下緣的**資訊帶** —— 左邊「LAST SCORE 最新比數」、右邊
「NEXT ON 近期賽事」。球迷與隊員最想知道的兩件事（上一場打成怎樣、下一場什麼
時候），在第一屏不用捲動就看得到。內頁沿用同一套雙語標題語彙（`ROSTER ／ 球員名單`）。

配色取自球衣與隊徽，全部定義在 `app/assets/css/main.css` 的 `@theme` 區塊：

| Token              | 取自                 | 用在                                   |
| ------------------ | -------------------- | -------------------------------------- |
| `--color-brand-*`  | 球衣與隊徽的 teal    | 按鈕、連結、標籤、我方比分             |
| `--color-accent-*` | 隊徽的金黃描邊       | 勝場、置頂公告、主要行動按鈕、標題金線 |
| `--color-ink*`     | 球帽與領口的深海軍藍 | 導覽列、主視覺、資訊帶、頁尾           |

金色在隊徽上是「描邊」而不是主體，這裡也維持同樣的比例 —— 只用在需要一眼抓到
的地方，不當大面積底色。要換成別的隊色，改這三組 token 就好，不必動任何一個 class。

到後台的「網站設定」上傳隊徽與主視覺照片後，畫面會更接近真正的球團官網；
每場比賽也可以在「基本資料」分頁上傳對手隊徽。

### 隊徽的圖片規格

| 項目 | 建議                                              |
| ---- | ------------------------------------------------- |
| 格式 | **去背 PNG**（背景透明）或 SVG                    |
| 高度 | 200px 以上（顯示時約 48px，留給高解析螢幕的餘裕） |
| 形狀 | 方形徽章或橫式字標都可以                          |

網站對隊徽只固定高度、寬度讓圖自己決定，所以 `MERCS` 這種寬高比接近 3:1 的
橫式字標不會被壓成小小一塊 —— 把橫式字標塞進正方形容器再 `object-contain`，
圖會縮到只剩容器的三分之一高，周圍全是空白。

上傳時的壓縮會**保留透明度**：有透明像素的圖輸出 PNG，照片與截圖才轉 JPEG
（見 `app/utils/image.ts`）。JPEG 沒有 alpha 通道，去背圖若被轉成 JPEG，
透明區會變成黑色方塊。

手上只有白底或淺底的圖時，到「網站設定」打開**「隊徽加上白色底板」**：
同一張圖會從「沒去乾淨的背景」變成刻意的白色徽章牌。去背的隊徽請保持關閉，
直接放在深色標題列上最好看。

## 功能地圖

### 前台

| 路由            | 內容                                                                    |
| --------------- | ----------------------------------------------------------------------- |
| `/`             | 主視覺、下一場比賽（含倒數）、最新公告、最近戰績、球隊簡介              |
| `/schedule`     | 近期賽程，由近到遠                                                      |
| `/results`      | 比賽結果，由新到舊，可依年度篩選並顯示總戰績                            |
| `/games/[id]`   | **未開打** → 預計出席 + 先發陣容；**已結束** → 計分板 + 當天打線 + 投手 |
| `/players`      | 球員名單，可依守備位置篩選                                              |
| `/players/[id]` | 個人資料與出賽紀錄                                                      |
| `/news`         | 公告牆，卡片捲到就淺入，可依分類篩選                                    |

### 後台（`/admin`，需登入）

| 路由                   | 內容                                                |
| ---------------------- | --------------------------------------------------- |
| `/admin`               | 總覽。**日期已過卻還沒登錄結果的比賽會排在最上面**  |
| `/admin/games`         | 賽程列表，待補登的場次會被標示                      |
| `/admin/games/new`     | 用賽程圖辨識新增，或手動填寫                        |
| `/admin/games/[id]`    | 四個分頁：基本資料 / 出席統計 / 打線 / 計分板與結果 |
| `/admin/players`       | 球員名單，列表與表單並排                            |
| `/admin/announcements` | 公告，支援草稿與置頂                                |
| `/admin/settings`      | 隊名、隊徽、主視覺、簡介、社群連結                  |

### 比賽編輯是自動儲存的

比賽編輯頁沒有儲存按鈕 —— 改了就存。出席登記這種「點十幾下、每下都是一個
獨立決定」的操作，按鈕只是多一個會忘記的步驟。

自動儲存的實作在 `app/composables/useAutosave.ts`，它處理掉四件事：

- **不是每次改動都送一次請求**：停止操作 900ms 後才寫入，否則輸入框每打一個字
  就是一次 Firestore 寫入
- **離開前把變更送完**：換頁與元件卸載時會先 flush；關閉分頁則用 `beforeunload` 提醒
- **失敗看得見**：狀態列會顯示「儲存失敗」與重試按鈕。自動儲存最危險的失敗
  模式是「以為存好了，其實沒有」
- **載入當下不寫入**：只有載入之後的變更才算數

唯一保持手動的是「標記為已結束」：自動儲存負責把你填的東西存起來，而「這場
比賽打完了」是一個決定，不該因為你開始填計分板就被代為認定。

其他後台頁面（球員、公告、網站設定）仍是手動儲存 —— 那些是「填完一份表單再
送出」的操作，而公告還有草稿與發布的區別，自動儲存反而會讓人不安。

---

## 資料模型（Firestore）

```
players/{id}          背號、姓名、守備位置、投打習慣、照片、狀態
games/{id}            日期、對手、對手隊徽、場地、主客場、狀態
  ├─ attendance[]     出席名單
  ├─ lineup[]         先發陣容
  ├─ pitchers[]       投手紀錄
  └─ scoreboard       逐局得分與 R/H/E
announcements/{id}    標題、內容、分類、置頂、草稿/已發布
siteSettings/main     隊名、隊徽、主視覺、簡介、社群連結
```

幾個刻意的決定：

- **打線與計分板內嵌在比賽文件裡**：都遠小於 Firestore 單文件 1MB 上限，
  內嵌讓「看一場比賽只要 1 次讀取」，拆成子集合會變成 4 次往返。
- **計分板存「我隊／對手」而不是「上半局／下半局」**：後台輸入時想的是
  「我隊這局得幾分」；誰在上半局由 `homeAway` 決定，顯示時再換算。
  可推導的資訊不進資料庫，就不會有兩邊不一致的問題。
- **`null` 與 `0` 不同**：計分板上留空代表「該半局沒有進行」（顯示為 `X`），
  `0` 代表「打了但沒得分」。
- **打線只有一份**：比賽前排好的先發陣容，就是賽後的出賽紀錄。分成「預計」與
  「實際」兩個欄位只會讓人不知道該填哪一個，前台也可能顯示到沒更新的那一份。
  顯示時依比賽狀態換個說法：未開打標示「預計」，結束後就是「當天打線」。
- **排打線時只列當天會到的人**：有出席統計時，挑人的選單只顯示回報出席的球員
  （可一鍵切回全隊，臨時來的人不一定有回報）。已經排進打線的人即使沒回報出席
  也會留在選單裡 —— 否則打開編輯畫面會看到先前的選擇被清空。
- **打線存姓名快照**：球員改名或退隊後，兩年前那場比賽仍顯示當時的名字；
  同時保留 `playerId`，個人頁的連結還是通的。
- **對手隊徽存在比賽上**，而不是另開一張「球隊」資料表：業餘球隊的對手常常只
  碰過一兩次，維護一份對手名冊的成本遠大於直接在比賽上貼一張圖。沒有隊徽時
  畫面會退回顯示隊名首字，版面不會塌。

---

## 開發指令

| 指令                        | 用途                                                         |
| --------------------------- | ------------------------------------------------------------ |
| `pnpm dev`                  | 開發伺服器                                                   |
| `pnpm build` / `pnpm start` | 建置與啟動 production                                        |
| `pnpm seed`                 | 在空的 Firestore 建立示範資料（加 `--confirm` 才會實際寫入） |
| `pnpm lint` / `lint:fix`    | ESLint                                                       |
| `pnpm typecheck`            | TypeScript 檢查                                              |
| `pnpm test:unit`            | 純邏輯測試（毫秒級）                                         |
| `pnpm test:nuxt`            | 元件與 composable                                            |
| `pnpm test:e2e`             | 完整建置 + 真實伺服器                                        |
| `pnpm test`                 | 全部                                                         |

e2e 不依賴 Firestore emulator：它設定 `ALLOW_MEMORY_STORE=true` 讓 production
建置跑在記憶體資料上。**正式部署絕對不要設定這個環境變數** —— 開著等於網站跑在
示範資料上、後台用萬用密碼就能登入。

e2e 另外會在啟動前把 `NUXT_FIREBASE_*` 與 `NUXT_GEMINI_API_KEY` 清成空字串
（見 `tests/e2e/bff.test.ts` 開頭）。`.env` 填了真實憑證之後，少了這一步，
測試裡的「新增球員」會真的寫進你的正式 Firestore，登入也會真的去打
Identity Toolkit。**跑測試永遠不該動到正式資料。**

---

## 加功能時的幾條規矩

沿用樣板的分層紀律，往下多延伸了一層：

1. **頁面不寫 API 路徑**。一律透過 `app/composables/api/` 的領域 composable：
   ```ts
   // ❌ const { data } = useApiFetch('/games', { query: { scope: 'past' } })
   // ✅ const { data } = await useGames({ scope: 'past' })
   ```
2. **端點不直接碰 Firestore**。一律透過 `server/repositories/`。資料來源要換
   （Firestore → Postgres、或加一層快取）時只改那個資料夾。
3. **型別與驗證寫在 `shared/schemas/`**。後端用它做執行期驗證，前端用
   `z.infer` 取型別，兩邊永遠同步。
4. **寫入端點一律先 `await requireUser(event)`**。路由 middleware 只是體驗，
   真正的權限檢查在 BFF。
5. **錯誤用 `throw new AppError(...)`**。`defineApiHandler` 會統一轉成正確的
   狀態碼與回應格式。注意 5xx 的訊息預設**不會**顯示給使用者（避免洩漏內部
   細節），要讓管理者看到操作指引時需明確加上 `{ expose: true }`。

---

## 部署（Firebase App Hosting）

網站跑在 **Firebase App Hosting** 上 —— 它是 Firebase 為 SSR 框架提供的服務，
原生支援 Nuxt，底層是 Cloud Run。設定在 `apphosting.yaml`。

### 部署流程

App Hosting 直接監聽 GitHub：**推到 `main` 就會自動建置並部署**，不需要自己寫
部署用的 workflow。GitHub Actions 只負責品質把關（lint、型別、測試）。

因為兩者是並行的（App Hosting 不會等 CI 通過），正式的工作流程是：

```
功能分支 → 開 PR → CI 通過 → 合併到 main → App Hosting 自動部署
```

直接推 main 也會部署，但那就沒有測試把關了。

### 第一次設定

**1. 在 Firebase Console 建立 App Hosting 後端**

Console → Build → App Hosting → 建立後端，連結這個 GitHub repo，
分支選 `main`，根目錄留空。

**2. 建立機密**

```bash
firebase apphosting:secrets:set nuxt-session-password   # openssl rand -base64 48
firebase apphosting:secrets:set firebase-web-api-key    # Console → 專案設定 → Web API 金鑰
firebase apphosting:secrets:set gemini-api-key          # Google AI Studio
```

**CLI 問「要不要把它加進 `apphosting.yaml`」時請選 No。** 它會從機密名稱推導出
環境變數名（`gemini-api-key` → `GEMINI_API_KEY`），但 Nuxt 只認得 `NUXT_` 開頭的
名稱，自動加的那個讀不到；`firebase-web-api-key` 推導出的 `FIREBASE_WEB_API_KEY`
還會撞上 App Hosting 保留的前綴（`X_GOOGLE_` / `FIREBASE_` / `EXT_`）而報錯。
`apphosting.yaml` 裡的對應都已經手動寫好了。

問要不要授權 App Hosting 讀取時選 yes。之後也可以手動授權：

```bash
firebase apphosting:secrets:grantaccess nuxt-session-password --backend <後端名稱>
```

**3. 確認 `apphosting.yaml` 裡的非機密設定**

`NUXT_PUBLIC_SITE_URL` 要改成實際的網址（自訂網域或 `*.web.app`）。

### 安全規則

`firestore.rules` 與 `storage.rules` 在版控裡，用這個指令部署：

```bash
firebase deploy --only firestore:rules,storage:rules
```

兩份規則的立場很簡單：

- **Firestore 全部拒絕。** 所有資料存取都經過 BFF，而 BFF 用 service account
  連線，**不受這些規則限制**。規則管的是「瀏覽器直接連 Firestore」，
  而這個專案刻意不讓前端載入 Firebase SDK。哪天有人想在前端直接讀資料會立刻
  失敗 —— 那是好事，它會逼人回到 BFF 這條路，而不是悄悄開一個沒有權限檢查的側門。
- **Storage 開放讀取、拒絕寫入。** 隊徽與球員照片本來就要讓所有人看得到；
  上傳則只能走 `/api/admin/uploads`，那裡會先驗證登入、檢查檔案型別與大小。

### 為什麼雲端不需要 service account 金鑰

App Hosting 跑在 Google Cloud 上，Admin SDK 直接用**執行環境本身的身分**
（Application Default Credentials）存取 Firestore 與 Storage。所以雲端只需要
`NUXT_FIREBASE_PROJECT_ID`，不必把私鑰放進 Secret Manager —— 少一份要保管的
機密，就少一個外洩的途徑。

本機開發仍然用 `.env` 裡的 service account：那裡沒有 ADC 可用，而且明確指定
憑證比依賴環境更好追。切換邏輯在 `server/utils/firebase.ts`。

### 啟動時的設定檢查

缺少任何一項必填設定，服務會在啟動階段就印出明確原因並退出 ——
App Hosting 會把那次發布標記為失敗並保留前一個版本，問題在上線前就被攔下。

健康檢查：`/api/health`（liveness，不檢查外部相依）、`/api/ready`（readiness，
收到 SIGTERM 後立即回 503 以排空流量）。

### 用 Docker 在本機驗證 production 建置

專案保留了 `Dockerfile` 與 `docker-compose.yml`，可以在本機用最接近正式環境的
方式跑一次，也方便日後改用 Cloud Run 或其他平台：

```bash
docker build -t team-site .
docker run -p 3000:3000 \
  -e NUXT_SESSION_PASSWORD=... \
  -e NUXT_FIREBASE_PROJECT_ID=... \
  -e NUXT_FIREBASE_CLIENT_EMAIL=... \
  -e NUXT_FIREBASE_PRIVATE_KEY=... \
  -e NUXT_FIREBASE_WEB_API_KEY=... \
  -e NUXT_GEMINI_API_KEY=... \
  team-site
```
