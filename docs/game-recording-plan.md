# 棒球賽事分段錄影功能規格

> 本文件取代 `live-streaming-plan.md`（WebRTC 即時推流）作為實作依據。
> 該方案評估後不採用，理由見第 1 節。
> 標註「待確認」的項目需實機驗證，不要自行假設。

## 1. 背景與已排除的方案

需求是**錄影**，不是即時推流：每局錄一段、上傳、在比賽進行中陸續出現在前台。

- **WebRTC + LiveKit SFU（`live-streaming-plan.md` 方案 B）：不採用。**
  它解的是 1 秒延遲的即時推流，需要媒體伺服器、權杖、Webhook、SSE 與 Redis；
  前端 `livekit-client` 實測 142 KB gzip，而本站目前**全部**前端 JS 才 271 KB。
  LiveKit Cloud 免費額度為 5,000 WebRTC 分鐘 + 50 GB 下行／月，大約只夠一個月一場，
  之後按 $0.12/GB 計費且無支出上限。本專案不需要這個延遲等級。
- **YouTube Live 直接開播**：手機 App 開播需頻道滿 50 訂閱，且無法指定超廣角鏡頭。
  作為備援方案保留，不整合進產品。
- **採用：瀏覽器 `getUserMedia()` + `MediaRecorder` 分段錄影**，
  片段由瀏覽器直接上傳 YouTube，本站只存 `videoId`。

**為什麼是分段而不是一次錄完**：手機瀏覽器分頁一旦進背景，`MediaRecorder` 就會停。
分段代表最壞情況只損失半局，不是整場。乙組賽制七局、一場約兩小時，
**每半局約 6～8 分鐘**，攻守交換就是天然的切點 —— 換邊的時候本來就該停機。
一場最多 14 段。

## 2. 技術棧

| 層             | 技術                                                        |
| -------------- | ----------------------------------------------------------- |
| 錄影           | 瀏覽器原生 `getUserMedia()` + `MediaRecorder`（零新增相依） |
| 前端           | Nuxt 4（現有專案）                                          |
| BFF            | Nitro（現有專案）                                           |
| 影片儲存與播放 | YouTube（resumable upload，瀏覽器直傳）                     |
| 中繼資料       | Firestore，內嵌在現有的 `games` 文件                        |
| 比分           | **沿用現有實作**，不做任何改動                              |

**檔案完全不經過我們的伺服器**，所以沒有 Storage 費用、沒有流量費用，
也不必處理 Cloud Run 的記憶體與逾時。

## 3. 架構

```
手機瀏覽器 /admin/record/:gameId
   │
   ├─① POST /api/admin/youtube/upload-token ──> BFF（refresh token 在 Secret Manager）
   │                                    <── 1 小時效期的 access token
   ├─② resumable upload（檔案直傳，不經過我們）──> YouTube
   │
   └─③ POST /api/admin/games/:id/clips { inning, videoId } ──> BFF ──> Firestore

前台 /games/:id ──> 縮圖（i.ytimg.com）──點擊──> youtube-nocookie.com 嵌入播放器
```

## 4. 流程

1. **賽前**：後台把比賽狀態切「比賽中」（現有功能），開啟 `/admin/record/:gameId`。
2. **選鏡頭**：先 `getUserMedia()` 取得權限 → `enumerateDevices()` 列出後鏡頭 →
   使用者挑一個（通常是超廣角）→ 以 `deviceId` 重新取流，套用 1920×1080 constraints。
3. **每半局**：按「開始」→ `MediaRecorder.start()`；攻守交換時按「結束」→ `stop()`
   → 得到 Blob。錄完自動推進到下一個半局（上半 → 同局下半 → 下一局上半），
   場邊的人整場不必碰局數選擇器。
4. **上傳**：Blob 進佇列，背景上傳 YouTube（可與下一局錄影並行），
   成功後把 `videoId` 回報給 BFF。
5. **前台**：比賽頁的「本場影片」區塊依局數與上下半列出片段。
6. **賽後**：狀態切「比賽結束」（現有功能），同一批片段成為賽事回放。

**延遲**＝一局（12～15 分）＋上傳（4～8 分）＋ YouTube 轉檔（數分鐘）
≈ **15～25 分鐘**。這不是直播，UI 上不要這樣稱呼，叫「本場影片」並標局數。
比分仍是即時的，兩者並存。

## 5. BFF API

| 方法   | 路由                                  | 說明                    | 權限            |
| ------ | ------------------------------------- | ----------------------- | --------------- |
| POST   | `/api/admin/youtube/upload-token`     | 回傳短效 access token   | `requireUser()` |
| POST   | `/api/admin/games/:id/clips`          | 登錄一支片段            | `requireUser()` |
| POST   | `/api/admin/games/:id/clips/refresh`  | 同步 YouTube 上的可見度 | `requireUser()` |
| DELETE | `/api/admin/games/:id/clips/:videoId` | 移除誤傳的片段          | `requireUser()` |

- `upload-token` 只回傳 token 與到期時間，不回傳 refresh token。
- `clips` 端點走 repository 新增的 `addGameClip()`，比照現有的 `markReminderSent()`：
  只動這一個欄位，不會蓋掉管理者同時在別處編輯的內容。
- 刪除只移除本站的紀錄，不刪 YouTube 上的影片（避免誤按造成不可逆的損失）。
- `clips/refresh` 用 `videos.list?part=status` 一次問完這一場所有片段的可見度
  （配額 1 單位）。**這是 B 方案的關鍵一步**：管理者在 YouTube Studio 批次改成
  公開之後，回後台按一下，前台才知道哪幾段可以顯示。

## 6. 資料模型

內嵌在現有的 `games` 文件，不另開 collection：

```ts
export const gameClipSchema = z.object({
  inning: z.number().int().min(1).max(20),
  half: gameHalfSchema, // 'top' | 'bottom'
  // 會變成前台 iframe 的網址，所以驗格式而不是照單全收
  videoId: z.string().regex(/^[\w-]{11}$/, '不是有效的 YouTube 影片 ID'),
  createdAt: z.string(),
})
```

**⚠️ 這裡存 `top`／`bottom`，而計分板存 `our`／`opponent` —— 看起來矛盾，
但兩者記的是不同的事實。** 計分板記「我隊這局得幾分」，分數天生屬於某一隊，
上下半局由 `homeAway` 推導；影片片段記「這段拍的是第幾局的哪半局」，
那是拍攝當下的物理事實。差別在 `homeAway` 填錯又改回來的時候才看得出來：
計分板會跟著修正（正確），影片標籤不會跟著變（也正確 —— 你當時拍的就是上半局）。
誰在打擊由 `battingSide(half, homeAway)` 推導（客隊先攻）。

⚠️ **和 `remindersSent` 一樣，`clips` 刻意不放進 `gameInputSchema`。**
它是系統寫入的狀態，不是人填的欄位 —— 放進 input schema 的話，後台編輯表單每次
存檔都會把它一起送上來，漏帶一次就等於把整場影片清空。

## 7. Nuxt 前端注意事項

- **錄影頁是獨立路由 `app/pages/admin/record/[id].vue`，而且 `layout: false`。**
  這是在球場邊、單手、太陽底下操作的畫面：大按鈕、深色、不要後台側欄。
  放在 `/admin/record/` 底下也避開與 `pages/admin/games/[id].vue` 的路由衝突。
- **橫向是主要的使用姿勢**（拍球場要最寬的畫面），而且需要**另一套版面**。
  實測：直向的垂直堆疊總高 855px，橫向的可用高度只有 320px 上下
  （iPhone 橫向 390 再扣掉 Safari 的上下列）—— 照搬過去的話錄影鈕會在畫面外
  459px，等於要一邊端著手機對準球場一邊捲頁面。
  用 Tailwind 的 `landscape:` variant 切成兩欄：預覽靠**高度**撐滿在左邊
  （橫向不能再用 `w-full`，16:9 會算出比視窗還高的高度），控制項收成右邊一欄，
  **錄影鈕放在捲動區外面**，永遠看得到。
- **高度用 `dvh` 不用 `vh`**：`100vh` 含會收起的工具列，橫向只有 320px 還跟著跳。
- **左右要留 `env(safe-area-inset-left/right)`**：橫向時瀏海吃的是側邊而不是下緣。
  （`viewport-fit=cover` 已經設在 `nuxt.config.ts`，直向時這兩個值是 0。）
- **不能用程式鎖定方向**：`screen.orientation.lock()` 要先進全螢幕，而 iPhone 對
  非 video 元素的 Fullscreen API 長期不支援（Safari 17.2／17.4 才開始出現）。
  只能用 CSS 回應方向，並在直向時提示「轉成橫的」。全螢幕留作日後的漸進增強。
- 相機邏輯集中在 `app/composables/useGameRecorder.ts`，頁面只負責畫面。
- **必須 HTTPS**：`getUserMedia()` 在非安全來源一律失敗。手機連本機 dev server
  要用 tunnel 或 `--https`，`localhost` 不適用（手機連的是區網 IP）。
- **`MediaRecorder` 的容器依裝置而異**：Safari 出 mp4、Chrome 預設出 webm。
  必須用 `MediaRecorder.isTypeSupported()` 逐一試，**優先選 mp4** ——
  Android 錄的 webm，iPhone 觀眾播不動。（上傳到 YouTube 後由它轉檔，
  所以這個問題只影響「下載到手機」的階段 1。）
- **deviceId 每次都會變**，不能存「上次選的鏡頭」，每場都要重挑。
  而且要先 `getUserMedia()` 拿到權限，`enumerateDevices()` 才看得到鏡頭 label。
- **⚠️ 畫面是橫的，錄出來可能是直的。** 各家瀏覽器對「裝置轉動時 video track
  的寬高要不要跟著交換」處理並不一致，所以會發生**預覽看起來好好的、存下來卻是
  1080×1920** 的情況 —— 在球場上完全看不出來，回家打開才發現一整場都是直的。
  修不了（那是瀏覽器的行為），但偵測得到：`track.getSettings()` 的
  `width < height` 就是直的，此時在預覽上壓一條紅色警告。注意 `getSettings()`
  **不是響應式的**，轉動時要自己重讀（見 `useGameRecorder` 的 `settingsVersion`）。
- Wake Lock API 防螢幕休眠，並在 UI 明確提示「請勿切換 App 或鎖定螢幕」。
- 前台**預設只渲染縮圖**（`https://i.ytimg.com/vi/<id>/hqdefault.jpg`），
  點擊才換成 iframe —— 七個 iframe 會把手機拖垮。現有的 CSP `img-src` 已含 `https:`。
- 元件自動匯入名稱是「目錄名 + 檔名」：`components/game/GameClips.vue` → `GameClips`。
  寫錯不會報錯，只會渲染成 `<!---->`。

## 8. 安全標頭（`server/middleware/10.security-headers.ts`）

三處都是放寬，每一處都要在程式碼裡寫清楚理由：

| 項目                 | 現況                                             | 需改成                                    |
| -------------------- | ------------------------------------------------ | ----------------------------------------- |
| `Permissions-Policy` | `camera=(), microphone=()`                       | `camera=(self), microphone=(self)`        |
| CSP `frame-src`      | **沒有此指令**，fallback 到 `default-src 'self'` | `'self' https://www.youtube-nocookie.com` |
| CSP `connect-src`    | `'self'`                                         | 加 `https://www.googleapis.com`           |

⚠️ **`Permissions-Policy` 是第一個硬阻擋。** 不改這一行，`getUserMedia()`
在任何瀏覽器都拿不到相機，而且錯誤訊息不會告訴你是這個標頭造成的。

## 9. 環境變數

```
NUXT_YOUTUBE_CLIENT_ID=
NUXT_YOUTUBE_CLIENT_SECRET=     # Secret Manager
NUXT_YOUTUBE_REFRESH_TOKEN=     # Secret Manager，一次性 OAuth 取得
```

refresh token 用 `pnpm youtube:auth` 取得（`scripts/youtube-auth.mjs`）。
授權時要用**放影片的那個帳號**登入 —— Client ID 代表「哪一個應用程式」，
refresh token 代表「代表哪一個帳號」，兩者屬於不同的 Google 帳號是正常的。

⚠️ **OAuth 同意畫面的發布狀態必須是「正式版」。** 停在「測試中」的話
refresh token **7 天就過期**，功能每週壞一次。未通過驗證沒關係（授權時
點「進階」→「前往…」略過警告即可），但發布狀態一定要切過去。

要的範圍是 `youtube.upload` + `youtube.readonly`。第二個是為了把影片的
可見度讀回來 —— 見下一節。刻意不要整個 `youtube` 範圍（那還包含修改與刪除）。

三項缺任何一項就關閉上傳功能（錄影與下載仍可用），比照現有的 VAPID 與天氣。
`apphosting.yaml` 的機密一律用 `NUXT_` 開頭的變數名，CLI 問「要不要加進
apphosting.yaml」時選 **No**（理由見該檔案的註解）。

⚠️ **記得回 `tests/e2e/bff.test.ts` 開頭把 `NUXT_YOUTUBE_*` 一起清成空字串** ——
`.env` 一旦有真憑證，e2e 會真的去打 YouTube 的 API。

## 10. 開發階段與驗收條件

**階段 1：先證明相機這段在真機上可行（完全不碰上傳）**

唯一目的是回答「超廣角選不選得到、錄出來多大、電量撐不撐得住」。

- [x] 放寬 `Permissions-Policy`
- [x] 錄影頁：列鏡頭、選鏡頭、1080p 預覽、上下半局選擇、開始／結束、
      **錄完直接下載到手機**
- [x] 橫向專屬版面（兩欄、不捲動）、直式影像警告、`dvh` 與左右安全區
- [ ] 驗收：iPhone 與 Android 各錄一個完整半局（6～8 分），確認畫面範圍、檔案大小、
      格式、**中途沒有換鏡頭**、手機沒有過熱降頻

  程式碼已完成，剩下的驗收**只能用真手機做** —— macOS 的無頭 Chrome 取不到相機
  （OS 層的權限，不是程式的問題）。要測的四個數字是：實際解析度、一局的檔案大小、
  錄出來的容器（mp4 還是 webm）、以及兩小時後手機的電量與溫度。

**階段 2：自動上傳與前台**

- [x] YouTube OAuth 一次性設定（`pnpm youtube:auth`），refresh token 進 Secret Manager
- [x] `gameClipSchema`、四支端點（`upload-token` / `clips` / `clips/refresh` / 刪除）
- [x] 上傳佇列（錄下一個半局的同時傳上一段，含進度與重試）
- [x] 前台「本場影片」區塊（只渲染非私人的片段，預設只載縮圖）
- [x] 後台的片段清單與「更新影片狀態」
- [ ] 驗收：實際跑一場七局，確認片段在一個半局之後陸續出現在前台

  ⚠️ 上傳這條路**只能用真憑證實測** —— e2e 一律把 `NUXT_YOUTUBE_*` 清空，
  所以測到的是「沒設定時不會爆」，而不是「真的傳得上去」。第一次務必先用
  一兩段短片試，確認影片有進到對的頻道、標題格式正確。

**階段 3：視實際使用情況**

- [ ] 上傳失敗的重試（球場網路不穩是常態）
- [ ] 位元率選項（在畫質與上傳時間之間取捨）

## 11. 查證過的事實

| 事實                                                   | 影響                                                       |
| ------------------------------------------------------ | ---------------------------------------------------------- |
| iOS 16.3+ 起 `enumerateDevices()` 會列出所有後鏡頭     | 超廣角選得到                                               |
| iOS 有已知的鏡頭自動切換行為（WebKit #253186 起）      | 長片段可能中途換鏡頭，**只能實機驗證**                     |
| `videos.insert` 自 2026/06 起有獨立額度桶、每天 100 支 | 一場七局完全在免費額度內（舊資料說每天僅 6 支，已過時）    |
| YouTube **未驗證頻道單支影片上限 15 分鐘**             | 改成分上下半之後每段只有 6～8 分鐘，**這個限制不再是風險** |
| 1080p30 每半局約 85～140 MB，一場 14 段約 1.2～2.0 GB  | 上傳一段約 2～4 分鐘，來得及在下一個半局結束前傳完         |
| 一場 14 支上傳，`videos.insert` 每天 100 支            | 一天最多七場，遠超過實際需求                               |

## 12. 待確認事項

- 影片標題要不要帶上下半局（例如「第 3 局上 vs 藍鷹」）
- 影片預設要 `unlisted` 還是 `public`
- 實際錄影裝置的機型（決定超廣角選不選得到）
- 球場的行動網路上傳頻寬（決定位元率設定）
- 是否需要在片段標題自動帶入對戰組合與日期
