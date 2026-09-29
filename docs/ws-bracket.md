# 預測世界大賽冠軍（限期活動）

球隊內部的小遊戲：MLB 季後賽樹狀圖上，先點自己的頭像、再點看好的球隊就算下注，
一注 $200。其中 $100 是球隊隊費（不參與分配），剩下 $100 進彩池，
押中世界大賽冠軍的人平分彩池。**同一隊同一個人最多押一注，一個人全部加起來
最多押兩注**（`MAX_BETS_PER_PLAYER`）。

入口在前台導覽列的「冠軍預測」，頁面在 `/ws-bracket`。

> **這是限期活動，整包設計成可以拆掉。** 拆除清單在最後一節。

---

## 它為什麼不照全站的架構走

CLAUDE.md 有一條鐵律：**前端完全不載入 Firebase SDK**，所有存取都經過 BFF。
這個功能**刻意違反它**，而且只違反這一條：

| 資料              | 走哪裡                                           |
| ----------------- | ------------------------------------------------ |
| 樹狀圖與 MLB 戰績 | 照規矩走 BFF（`/api/ws-bracket`）                |
| **下注與移除**    | **瀏覽器直接讀寫 Realtime Database**             |
| 鎖盤時間          | 照規矩走 BFF（`PUT /api/admin/ws-bracket/lock`） |

三個理由，缺一個都不會這樣做：

1. **要真的即時。** 下注時大家會同時開著頁面看，輪詢的幾秒延遲會讓
   「我剛剛按了，怎麼沒出現」變成常態。RTDB 的 `onValue` 是推送的。
2. **資料要跟正式資料完全分家。** 它存在另一個 Realtime Database（甚至可以是
   另一個 Firebase 專案），和 Firestore 上的比賽、球員、公告沒有任何交集 ——
   活動結束時把整棵 `ws-bracket` 節點刪掉就乾淨了，正式資料一個位元組都沒動到。
3. **沒有前台登入系統。** 走 BFF 的話 BFF 也只能無條件放行，等於多寫一層
   什麼都沒擋住的端點。防線本來就只能是 RTDB 的安全規則。

SDK 是 `import()` 動態載入的（`useWsBracketBets()` 的 `onMounted` 裡），
所以**其他頁面一個位元組都不會載**，主 bundle 不受影響。

## 規則就是安全規則

`database.rules.json` 把整個玩法寫成四句話：

1. 沒鎖盤的時候，**任何人都能新增一筆，也能移除任何一筆**。
2. **沒有人能修改已經存在的那一筆**（只能加、只能刪，不能改）。
3. **同一個人在同一隊最多一筆，同一個人全部加起來最多兩筆。**
4. **鎖盤之後，連新增與移除都寫不進去。**

**新增與移除是對稱的，都是純信任。** 沒有登入系統時，硬要分「這是不是你的」
只能靠裝置記憶（localStorage），而那在換手機、清瀏覽器資料、用無痕視窗之後
就失效 —— 結果是「明明是我下的卻刪不掉」，比誰都能刪更糟。防手滑靠的是
彩池表上的兩段式確認。

### 「一人最多兩注」是用固定的槽位擋住的，不是數兒女個數

下注不存在 `bets/{playerId}/{team}` 或隨機的 push key，而是存在
`bets/{playerId}/slot1` 與 `bets/{playerId}/slot2` —— **兩個寫死的鍵名**。

⚠️ **這不是隨便選的設計，是 RTDB 規則語言的限制逼出來的。** 一開始的做法是
用 `newData.parent().numChildren() <= 2` 擋「這個人底下最多兩個子節點」——
`firebase deploy` 直接回傳語法錯誤：**這個規則語言根本沒有 `numChildren()`**
（官方文件列的方法清單裡確實沒有它，先前是憑印象以為有，實測才發現）。
沒有這個方法，唯一能限制「某個節點底下最多幾個子節點」的寫法，就是把可能的
鍵名寫死、其餘一律拒絕（`$other: { ".validate": false }`）。兩個槽位＝上限
兩注，改成三注要嘛在 `shared/schemas/ws-bracket.ts` 的 `BET_SLOTS` 加一個
`'slot3'`、`database.rules.json` 同步加一段幾乎一樣的區塊（規則語言沒有
巨集可以共用片段，重複是唯一的寫法）。

**「同一隊只能一注」因此也不能再靠路徑鍵是球隊代碼來保證** —— 槽位的鍵是
`slot1`／`slot2`，不是球隊代碼。改成寫入時互相比對：寫 `slot1` 要檢查
`slot2` 現在存的球隊代碼是不是同一支，反過來也一樣。`root` 在規則裡看到的
永遠是**這次寫入完成後**的樹，所以這條比對抓得到「兩格押同一隊」。

`shared/schemas/ws-bracket.ts` 的 `nextEmptySlot()` 決定新的一注要寫進哪一格
（永遠挑「還空著的那一格」，不是永遠對著 `slot1`——使用者可能先移除 `slot1`，
下一注就該填回那裡，見那支函式的完整說明）；`hasBetOnTeam()`／
`reachedMaxBets()` 是畫面用的檢查，讓 `place()` 能在打 RTDB 之前先擋下並給
一句看得懂的提示，而不是等安全規則丟回英文的 `PERMISSION_DENIED`。
**真正擋得住的永遠是規則**，這兩層互相對不上時，寫不進去就是寫不進去。

### 鎖盤是唯一不對稱的東西

`ws-bracket/config/lockAt` **沒有 `.write`**，所以前台再怎麼打都改不動它。
唯一的寫入途徑是 BFF（`server/utils/ws-bracket-lock.ts`，service account
不受規則限制），而那支端點擋在 `requireUser()` 後面。

⚠️ **存的是時間，不是一個開關。** 「時間到我會鎖盤」如果真的要靠人在那一秒
按下去，那個人塞車、開會、手機沒電的時候就有人多押了一注 —— 而那一注是在
知道更多資訊之後押的。後台的「立即鎖盤」只是把那個時間設成 `Date.now()`。

⚠️ **邊界要往「鎖住」倒**：規則用 `now < lockAt`，前端的 `isBettingLocked()`
用 `now >= lockAt`，兩邊是同一個方向。反過來的話會出現「畫面說可以按、
資料庫說不行」，而錯誤訊息是英文的 `PERMISSION_DENIED`。

⚠️ **解除鎖盤是把鍵整個移除，不是寫 `0`。** 規則判斷的是「`lockAt` 存不存在」
加上「現在有沒有超過它」，留一個 `0` 在那裡等於「1970 年就鎖了」——
意思剛好相反。

`createdAt` 的規則是 `newData.val() == now`，逼它必須是 `serverTimestamp()`：
下注順序是這份資料唯一的排序依據，交給各自的手機去決定的話，時鐘慢五分鐘的人
下的注就會排到別人前面。

⚠️ **欄位改動要同時改 `shared/schemas/ws-bracket.ts` 的 `wsBetSchema`。**
規則是真正擋得住亂寫的那一層，schema 只擋得住我們自己寫錯（讀回來時會再驗一次，
壞掉的那一筆直接略過，不讓它把整頁的統計弄成 `NaN`）。

## MLB 戰績

`server/utils/mlb.ts` 打 `statsapi.mlb.com` 的公開端點（**不需要金鑰**）：

```
/api/v1/schedule/postseason/series?season=YYYY&sportId=1
```

一次回傳十一支系列賽（4 外卡 + 4 分區 + 2 聯盟冠軍 + 世界大賽）。整張樹狀圖由
`buildBracket()` 從這一份推導，**沒有任何寫死的球隊**——只有樹的骨架
（`SERIES_SHAPE`）是固定的。

結構是打過真 API 確認的（2025 完賽資料 + 2026 賽前資料都驗過），幾個容易錯的地方：

- **對戰組合還沒產生時會塞佔位隊伍**（`HOU/CWS`、`AL Higher Seed`，id 在 2000／5000
  區段）。它們查不到 = 「這一格還沒有人」，不是錯誤。
- **字母 A 的外卡接的是 B 的分區賽**（`F_1 → D_2`、`F_2 → D_1`）。看起來像寫錯，
  但兩季的資料都是這樣。照直覺把 A 接 A 的話，上半區與下半區會整個對調，
  **而畫面上看起來完全正常**。
- **勝場數自己數 `isWinner`，不讀 `leagueRecord.wins`。** 後者是逐場的欄位，
  未完成的比賽也帶著它、值是 `0-0`，挑錯一場就會把 3–1 的系列賽讀成 0–0。
- **第一戰的主隊就是高種子**，四輪通用。種子編號因此不必另外查戰績表。
- **「打完但還沒晉級」不等於淘汰。** 用「有沒有出現在下一輪」判斷的話，
  正在打的球隊會被畫成灰的 —— 它本來就還沒出現在下一輪。

⚠️ 這是一支**沒有服務保證**的端點，所以 `getBracket()` **一定回傳一個
`Bracket`**：抓不到就回上一次成功的結果（最多 24 小時），連上一次都沒有才回
一張全空的樹。畫面上會寫出 `fetchedAt`，舊資料不會被誤認成即時的。
伺服器端快取 5 分鐘，前台想輪詢多快都不會傳導到 MLB 身上。

## 畫面上幾個刻意的決定

- **樹狀圖只有一套版面，橫向靠捲動。** 樹的形狀本身就是資訊 —— 手機上把它折成
  一欄，「誰會碰到誰」這件事就沒了。
- **排版不是照 MLB 宣傳圖一格一格複製的。** 官方那張把聯盟冠軍與世界大賽疊在
  中間的金色長條上，好看但看不出誰接誰；這裡改成標準的左右對開賽程樹，
  每一條連接線都對得上實際的晉級路徑。
- **下注一律「點頭像再點球隊」。** 這條路同時支援滑鼠、觸控與鍵盤，不依賴各手機
  瀏覽器對拖曳與長按圖片的不同實作。
- **被淘汰的球隊不能再押**，灰階 + 刪除線；下注函式還會再次確認，避免戰績輪詢
  更新前後出現不一致。
- **「押中可分」一定寫成預估。** 後面每多一注，已下注的人分到的就變少。
- **分配算的是可分彩池，不是收到的總額。** 一注 $200 只有一半（$100）進彩池，
  另一半是隊費。`payoutPerBet()` 的分母是 `payoutPool` 不是 `pot` ——
  用後者算的話，每注可分的金額會是實際發得出來的兩倍。這個比例從
  `TEAM_DUES_PER_BET`／`PAYOUT_PER_BET` 兩個常數算，改分配比例只需要改
  `shared/schemas/ws-bracket.ts` 的這兩行。
- **移除只開在彩池表，不在樹狀圖上。** 樹狀圖的每一格只擠得下四個頭像
  （其餘收成「+N」），而收起來的那些**點不到** —— 「我的注剛好被收起來」
  是隨時會發生的。開在列出所有人的那張表上，就不會有「有時候刪得掉、
  有時候找不到」的情況。
- **鎖盤之後隊員列整條收起來，不是停用。** 一排點不動的頭像只會讓人一直去戳，
  而「已鎖盤」那條說明反而被擠到看不見的地方。同理，彩池表上的頭像從
  `<button>` 換成 `<span>`：一個點得下去卻什麼都不會發生的東西，比一個
  明顯不能點的東西更讓人困惑。
- **鎖盤的時鐘要會走**（`useNow`），不能只在載入時算一次。開著頁面等截止時間的人
  正是最可能在最後一刻想再押一注的人，而他看到的畫面如果停在「還沒鎖」，
  按下去就會收到一個沒頭沒腦的失敗。
- **下注格的高度必須小於座標表的列距。** 大於的話上面那格的點擊範圍會蓋住
  下面那格的頂端，造成使用者點了預期的球隊卻選到另一格。
  `tests/unit/ws-bracket.test.ts` 的「沒有任何兩格重疊」守著它。

## 四個實測才抓得到的坑

這四個都**不會有任何畫面上的異常**，只會讓功能安靜地半殘（或者像第 4 個那樣，
連 `firebase deploy` 都直接拒絕），所以寫在這裡。

### 1. RTDB 的 SDK 會退回 JSONP 長輪詢，而那需要 `script-src`

WebSocket 連不上時，SDK 會自己改用長輪詢 —— 也就是動態插入
`<script src="https://….firebasedatabase.app/.lp?…">`。那條路吃的是 CSP 的
**`script-src`**，不是 `connect-src`（開 `script-src` 等於允許那個網域執行任意 JS，
不划算）。結果是**有時候會動、有時候不會**：WebSocket 搶先連上就正常，
慢半拍退回長輪詢就整個被擋，而畫面上永遠顯示「共 0 注」——
跟「真的沒有人下注」長得一模一樣。

解法是 `forceWebSockets()`（`useWsBracketBets()` 裡）：關掉退路，連不上就是
連不上，錯誤會被寫到畫面上。

### 2. RTDB 連的不是設定裡那個主機

連線會被導到同一區域的**分片主機**，例如
`s-gke-apse1-nssi4-7.asia-southeast1.firebasedatabase.app` —— 名字是 Google
動態決定的，列不出來。只把設定裡那一個加進 `connect-src` 的話，連線會時好時壞。
所以 `wsBracketOrigins()` 放寬到同區域的萬用字元
（`wss://*.asia-southeast1.firebasedatabase.app`），
`tests/unit/ws-bracket.test.ts` 守著這個推導。

### 3. RTDB 的規則語言沒有 `numChildren()`

「一人最多兩注」原本想用 `newData.parent().numChildren() <= 2` 擋 ——
語法檢查直接失敗：`No such method/property 'numChildren'`。用一個最小規則檔
單獨測過兩次（`newData.parent().numChildren()` 與 `newData.numChildren()`
都試了），確認不是用法問題，是這個方法真的不存在。官方文件列出的
`RuleDataSnapshot` 方法清單裡確實沒有它 —— 之前是憑印象以為有。

改用固定命名的 `slot1`／`slot2`（見上面「規則就是安全規則」那一節）。
教訓是：**RTDB 規則語言的方法清單比想像中短，寫任何非顯而易見的規則之前，
先用一個十行內的最小規則檔單獨 `firebase deploy` 測語法**，不要等到套進
完整規則檔才發現某個方法不存在 —— 那樣連錯誤訊息指到哪一行都要自己算。

## 設定

**正式環境（`hg-baseball`）的資料庫已經建好了**，規則也部署過：

```
https://hg-baseball-default-rtdb.asia-southeast1.firebasedatabase.app
```

要從頭再來一次（或換專案）的話：

1. 建立 Realtime Database。⚠️ **第一個執行個體不能用
   `firebase database:instances:create`**（它會要你先跑互動式的
   `firebase init database`），走 Management API：

   ```bash
   gcloud services enable firebasedatabase.googleapis.com --project <專案>
   curl -X POST \
     "https://firebasedatabase.googleapis.com/v1beta/projects/<專案>/locations/asia-southeast1/instances?databaseId=<專案>-default-rtdb" \
     -H "Authorization: Bearer $(gcloud auth print-access-token)" \
     -H "x-goog-user-project: <專案>" \
     -H "Content-Type: application/json" -d '{"type":"DEFAULT_DATABASE"}'
   ```

   ⚠️ **區域建好之後不能改**，要換只能砍掉重建。

2. 部署安全規則：

   ```bash
   firebase deploy --only database
   ```

   ⚠️ 規則檔裡的註解只能用 `//`，**不能寫成 `"//": "..."` 的鍵** ——
   那會被當成一個叫 `//` 的路徑，而它的值必須是規則物件，部署時直接語法錯誤。

3. 設定環境變數（本機寫進 `.env`，正式環境寫進 `apphosting.yaml`）：

   ```
   NUXT_PUBLIC_WS_BRACKET_DATABASE_URL=https://<你的資料庫>.firebasedatabase.app
   ```

   **只有這一個。** RTDB 唯一需要的設定就是 `databaseURL` —— Firebase Web
   API key 是給 Auth 用的，而這裡從頭到尾沒有任何登入，所以刻意不留那個欄位
   （多一個永遠留空的設定，只會讓下一個人以為自己漏填了什麼）。

   ⚠️ 這個值會送到瀏覽器，**本來就該公開** —— 防線是安全規則，不是把網址藏起來。

   ⚠️ 正式環境記得 `apphosting.yaml` 也要宣告（見 CLAUDE.md 的「部署」章節：
   只建到 Secret Manager 而沒宣告的話，Cloud Run 根本收不到）。這兩個不是機密，
   直接寫 `value:` 即可。

**留空代表下注功能關閉**（樹狀圖與 MLB 戰績照樣顯示），不是「不用設定」。
`server/middleware/10.security-headers.ts` 的 CSP 例外也是從這個變數推出來的 ——
變數一拿掉，例外就跟著消失。

## 拆除清單

活動結束時刪掉這些，主站不受任何影響：

```
app/pages/ws-bracket.vue
app/pages/admin/ws-bracket.vue
app/components/bracket/
app/composables/useWsBracketBets.ts
app/composables/api/useWsBracketApi.ts
app/utils/mlb-logos.ts
app/utils/ws-bracket-layout.ts
app/assets/img/mlb/
shared/schemas/ws-bracket.ts
server/api/ws-bracket/
server/api/admin/ws-bracket/
server/utils/mlb.ts
server/utils/ws-bracket-lock.ts
tests/unit/ws-bracket.test.ts
tests/nuxt/ws-bracket-slot.test.ts
tests/nuxt/ws-bracket-roster.test.ts
database.rules.json
docs/ws-bracket.md
```

還要還原這幾處單行改動：

- `app/layouts/default.vue` — `navLinks` 裡的 `/ws-bracket`
- `app/layouts/admin.vue` — 側邊導覽的「冠軍預測」
- `i18n/locales/*.json` — `nav.wsBracket`
- `nuxt.config.ts` — `runtimeConfig.public.wsBracket`、`runtimeConfig.mlb`
  與 `/ws-bracket` 的 routeRule
- `server/middleware/10.security-headers.ts` — `wsBracketOrigins()` 與 `connect-src`
- `tests/e2e/bff.test.ts`、`tests/e2e/rate-limit.test.ts` — 環境變數的隔離那幾行
- `firebase.json` 的 `database` 區塊；`apphosting.yaml` 與 `.env.example`
  的那一段；`package.json` 的 `firebase`

最後把 Realtime Database 上的 `ws-bracket` 節點刪掉：

```bash
firebase database:remove /ws-bracket --project hg-baseball
```

## 管理者怎麼動資料

前台是純信任（任何人都能加、也能減），但**管理者的身分不受安全規則限制**，
所以下面這些不論鎖盤與否都做得到：

```bash
# 刪掉某一筆（key 從 Firebase Console 或下面那個 curl 看）
firebase database:remove /ws-bracket/bets/<key> --project hg-baseball

# 看目前所有的注
curl -s https://hg-baseball-default-rtdb.asia-southeast1.firebasedatabase.app/ws-bracket/bets.json

# 全部清空重來
firebase database:remove /ws-bracket/bets --project hg-baseball
```

⚠️ **鎖盤時間不要從 Console 手改**，走後台的「冠軍預測」頁 —— 那裡會把
「立即鎖盤」「解除鎖盤」的語意處理好（解除是移除鍵，不是寫 `0`）。
