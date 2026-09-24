# 棒球賽事直播功能規格（方案 B：手機瀏覽器 WebRTC 開播）

> 本文件整理自前期技術討論，供開發時參考。實作前請先比對現有專案結構，
> 標註「待確認」的項目需先與開發者確認，不要自行假設。

## 1. 背景與已排除的方案

- **Insta360 GO Ultra：不採用。** 官方 App 只能推到指定平台（僅見抖音），無自訂 RTMP；
  官方 FAQ 表示不能當 webcam；SDK 僅 Android 版支援 GO 系列，且 `startLive` 是否支援
  GO Ultra 未確認。
- **手機推流 App（Larix → RTMP）**：可作為備援方案，但不整合進產品。
- **採用方案 B**：主播用手機瀏覽器開啟本站開播頁，透過 WebRTC 推流，整合在自家產品內。

## 2. 技術棧

| 層                | 技術                                      |
| ----------------- | ----------------------------------------- |
| 前端              | Nuxt.js（現有專案）                       |
| BFF               | Node.js（現有專案）                       |
| 媒體伺服器（SFU） | LiveKit（先用 LiveKit Cloud，之後可自架） |
| 前端 SDK          | `livekit-client`                          |
| 後端 SDK          | `livekit-server-sdk`                      |
| 比分推播          | SSE（多台 BFF 時經 Redis pub/sub）        |
| 錄影 / 大量觀眾   | LiveKit Egress → HLS + CDN（第三階段）    |
| 資料庫            | 待確認（沿用現有專案）                    |

## 3. 架構

```
[比分後台 Nuxt] ──> [Node BFF] <── Webhook ── [LiveKit SFU] ──> [Egress → HLS/CDN]
[主播手機 /broadcast] ──權杖──> BFF；──WebRTC 推流──> SFU
[觀眾 /live] ──權杖/狀態/SSE──> BFF；──WebRTC 訂閱──> SFU
BFF ──> 資料庫 + Redis
```

## 4. 流程

1. **建立賽事**：後台建立比賽 → BFF 寫入 DB，產生 `matchId`，room 名稱為 `match_{id}`，設定開播權限。
2. **主播開播**：開啟 `/broadcast/:matchId` 並登入 → 向 BFF 取得 publish-only 權杖
   → 取得後鏡頭與麥克風 → 連線 SFU 推流 → SFU Webhook 通知 BFF → 狀態改為 `live`。
3. **觀眾觀看**：開啟 `/live/:matchId` → 向 BFF 取得狀態與 subscribe-only 權杖（或 HLS 網址）
   → 播放 → 訂閱比分 SSE。
4. **比分更新**：後台送出 → BFF 寫入 Redis 並廣播 → 觀看頁更新 HTML 疊加層（比分不燒進影像）。
5. **結束與回放**：`room_finished` / `egress_ended` Webhook → BFF 更新狀態、儲存錄影網址 → 賽事頁轉為回放。

賽事狀態：`scheduled` → `live` → `ended`（→ `replay_ready`）

## 5. BFF API

| 方法 | 路由                         | 說明                           | 權限            |
| ---- | ---------------------------- | ------------------------------ | --------------- |
| POST | `/matches`                   | 建立賽事                       | 管理者          |
| POST | `/matches/:id/publish-token` | 發開播權杖（canPublish only）  | 該場主播        |
| GET  | `/matches/:id/view`          | 回傳狀態 + 觀看權杖或 HLS 網址 | 公開或依設定    |
| POST | `/matches/:id/score`         | 更新比分                       | 管理者 / 記錄員 |
| GET  | `/matches/:id/score/stream`  | SSE 比分推播                   | 公開            |
| POST | `/webhooks/livekit`          | 接收 SFU 事件，須驗證簽章      | LiveKit         |

權杖範例：

```js
import { AccessToken } from 'livekit-server-sdk'

export async function createToken({ room, identity, canPublish }) {
  const at = new AccessToken(process.env.LK_API_KEY, process.env.LK_API_SECRET, {
    identity,
    ttl: '4h',
  })
  at.addGrant({ room, roomJoin: true, canPublish, canSubscribe: !canPublish })
  return await at.toJwt()
}
```

Webhook 使用 `WebhookReceiver` 驗證，需處理：`room_started`、`track_published`、`room_finished`、`egress_ended`。

## 6. 比分資料模型（棒球，提案，待確認）

```ts
interface Scoreboard {
  matchId: string
  inning: number // 局數
  half: 'top' | 'bottom' // 上 / 下半局
  home: { name: string; runs: number; hits: number; errors: number }
  away: { name: string; runs: number; hits: number; errors: number }
  balls: number // 0–3
  strikes: number // 0–2
  outs: number // 0–2
  bases: [boolean, boolean, boolean] // 一、二、三壘有無跑者
  updatedAt: string
}
```

## 7. Nuxt 前端注意事項

- WebRTC 相關元件只在客戶端執行：使用 `<ClientOnly>` 或 `.client.vue`，`livekit-client` 動態 import。
- 必須 HTTPS，否則無法取得相機權限（本機開發用 localhost 或 HTTPS tunnel 以便手機測試）。
- 開播設定：`facingMode: 'environment'`，先用 720p30，開啟 simulcast。
- 使用 Wake Lock API 防止螢幕休眠（iOS 16.4+），並在 UI 提示「請勿切換 App 或鎖定螢幕」
  （瀏覽器分頁進背景時相機會被停止）。
- 監聽 `Reconnecting` / `Disconnected`，顯示連線狀態；必要時重新取得權杖重連。
- 觀看頁：比分為 HTML 疊加層，由 SSE 驅動。
- LiveKit API Secret 只能存在 BFF，不得出現在前端。

## 8. 環境變數

```
LIVEKIT_URL=wss://xxx.livekit.cloud
LK_API_KEY=
LK_API_SECRET=
REDIS_URL=            # 第二階段
```

## 9. 開發階段與驗收條件

**階段 1：最小可運作**

- [ ] BFF：`publish-token`、`view` 兩支 API
- [ ] `/broadcast/:matchId`：手機可開播，顯示本機預覽與連線狀態
- [ ] `/live/:matchId`：另一台裝置可看到畫面與聲音
- 驗收：手機開播，電腦觀看延遲約 1 秒內

**階段 2：賽事與比分**

- [ ] 賽事 CRUD 與狀態機
- [ ] LiveKit Webhook（驗證簽章、更新狀態）
- [ ] 比分後台 + SSE + 觀看頁疊加層

**階段 3：錄影與規模化**

- [ ] Egress 錄影、回放頁
- [ ] HLS + CDN 交付，依觀眾數或設定切換

## 10. 待確認事項

- 現有專案的登入 / 權限機制，主播與記錄員角色如何對應
- 現有資料庫與 ORM
- 部署環境（BFF 與 Nuxt 是否同機、是否有 Redis）
- 觀看是否需要登入或付費
