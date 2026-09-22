import tailwindcss from '@tailwindcss/vite'
import { COLOR_MODE_BOOTSTRAP } from './shared/constants/theme'

/**
 * Nuxt 設定 —— 球隊官網。
 *
 * 架構沿用樣板的三層切分，但把最下游從「外部 API」換成 Firebase：
 *
 * ```
 * 瀏覽器 → Nuxt 前端 (app/) → BFF / Nitro (server/) → Firestore / Storage / Gemini
 * ```
 *
 * - `app/`    前端（Vue 3 + Tailwind 4），只認得 `/api/*`
 * - `server/` BFF（Nitro / h3 v1），唯一持有 Firebase 憑證與 Gemini 金鑰的地方
 * - `shared/` 前後端共用的型別、錯誤碼、zod schema
 *
 * 前端**完全不載入 Firebase SDK**，也拿不到任何 Firebase token —— 這是
 * 選擇 BFF 架構最直接的收穫。
 */
/**
 * 公開頁面的快取指示。詳細理由寫在下方 `nitro.routeRules` 的註解。
 * 瀏覽器不留（`max-age=0`）、CDN 留 60 秒、過期後還能先用舊的撐 10 分鐘。
 */
const PUBLIC_CACHE = 'public, max-age=0, s-maxage=60, stale-while-revalidate=600'

/** 後台與認證相關端點：任何共用快取都不准碰。 */
const PRIVATE_CACHE = 'private, no-store'

/**
 * Service Worker 本體。
 *
 * **絕對不能讓它被長時間快取。** SW 是所有更新的源頭，它自己被 CDN 或瀏覽器
 * 抓住不放，使用者的裝置就會永遠停在舊版，而且沒有任何辦法從伺服器端補救。
 */
const NO_CACHE = 'public, max-age=0, must-revalidate'

/** 圖示與 manifest：不含內容雜湊，所以留一段可接受的時間就好。 */
const ICON_CACHE = 'public, max-age=3600, s-maxage=86400'

export default defineNuxtConfig({
  // 鎖定 Nitro 的行為基準日，升級 Nuxt 時不會被預設值變動偷襲
  compatibilityDate: '2025-07-15',

  devtools: { enabled: true },

  modules: ['@nuxt/eslint', '@pinia/nuxt', '@vueuse/nuxt', '@nuxtjs/i18n'],

  css: ['~/assets/css/main.css'],

  // Tailwind v4 走 CSS-first：主題定義全部在 app/assets/css/main.css 的 @theme 區塊
  vite: {
    plugins: [tailwindcss()],
  },

  /**
   * 打開巢狀 composable 掃描，讓 `app/composables/api/` 底下的檔案也能自動匯入。
   */
  imports: {
    dirs: ['composables/**'],
  },

  typescript: {
    strict: true,
    typeCheck: false,
  },

  /**
   * ## runtimeConfig
   *
   * 頂層的值**只存在於 server 端**，前端 bundle 永遠不會包含它們 ——
   * Firebase service account 私鑰與 Gemini API key 能放在這裡的原因。
   * `public` 底下的值會送到瀏覽器，只能放非機密設定。
   *
   * 執行期用環境變數覆寫，命名規則是 `NUXT_` + 大寫底線化：
   * - `sessionPassword`      ← `NUXT_SESSION_PASSWORD`
   * - `firebase.projectId`   ← `NUXT_FIREBASE_PROJECT_ID`
   * - `public.appName`       ← `NUXT_PUBLIC_APP_NAME`
   *
   * 完整清單見 `.env.example`；缺漏必填項會在啟動時由
   * `server/plugins/00.env-validate.ts` 直接讓程序 crash。
   */
  runtimeConfig: {
    // --- Session / 認證 ---
    /** 加密 session cookie 的密鑰，至少 32 字元。正式環境務必改掉。 */
    sessionPassword: '',
    /** session 有效秒數，預設 8 小時。 */
    sessionMaxAge: 60 * 60 * 8,

    // --- Firebase（BFF 專用，永遠不進前端 bundle）---
    firebase: {
      /** Firebase 專案 ID。 */
      projectId: '',
      /** service account 的 client email。 */
      clientEmail: '',
      /** service account 的私鑰。.env 中換行請寫成 \n。 */
      privateKey: '',
      /** Storage bucket 名稱，例如 my-team.firebasestorage.app。 */
      storageBucket: '',
      /**
       * Firebase Web API key。用於在 server 端呼叫 Identity Toolkit
       * 驗證後台帳密。這把 key 本身不是祕密（前端 SDK 也會帶它），
       * 但這個專案裡它只在 BFF 使用，所以不放在 public。
       */
      webApiKey: '',
    },

    // --- Gemini（圖片辨識）---
    gemini: {
      /** Google AI Studio 產生的 API key。 */
      apiKey: '',
      /** 使用的模型。換模型不需要改程式碼。 */
      model: 'gemini-2.5-flash',
      /** 單次辨識的逾時毫秒數。視覺推理比一般 API 慢，給寬一點。 */
      timeoutMs: 60_000,
    },

    // --- 中央氣象署（比賽當天的天氣預報）---
    cwa: {
      /**
       * 氣象資料開放平臺的授權碼。
       * 申請：https://opendata.cwa.gov.tw/user/authkey
       *
       * 留空時天氣功能整個關閉（後台的縣市欄位還在，只是前台不顯示天氣），
       * 網站其餘功能不受影響。
       */
      apiKey: '',
    },

    // --- 推播（Web Push / VAPID）---
    /**
     * VAPID 是「我們是誰」的簽章，推送服務用它驗證發送方。
     * 公鑰在 `public.vapidPublicKey`（瀏覽器訂閱時要用），私鑰只留在這裡。
     *
     * 產生方式：`npx web-push generate-vapid-keys`
     * **換掉私鑰等於讓所有既有訂閱失效**，所有人都要重新訂閱。
     */
    vapid: {
      /** base64url 私鑰。 */
      privateKey: '',
      /** 聯絡方式，推送服務出問題時會用它找我們。格式是 `mailto:` 或 https 網址。 */
      subject: '',
    },

    // --- 外部呼叫共用 ---
    /** 呼叫外部服務（Gemini、Identity Toolkit）的預設逾時毫秒數。 */
    upstreamTimeoutMs: 10_000,

    // --- 斷路器 ---
    /** 連續失敗幾次後跳閘。 */
    circuitBreakerThreshold: 5,
    /** 跳閘後多久進入 half-open 試探。 */
    circuitBreakerResetMs: 30_000,

    // --- 資安 ---
    /** CORS 允許的來源，多個以逗號分隔。留空表示只允許同源。 */
    corsOrigins: '',
    /** 單一 IP 在時間窗內的最大請求數。 */
    rateLimitMax: 100,
    /** 流量限制的時間窗（毫秒）。 */
    rateLimitWindowMs: 60_000,
    /** 一般請求 body 大小上限（bytes），預設 1MB。 */
    maxBodyBytes: 1_048_576,
    /**
     * 上傳與圖片辨識路由的 body 上限（bytes），預設 8MB。
     * 這些路由帶的是圖片，用一般上限會直接被 `40.body-guard.ts` 擋掉。
     */
    maxUploadBytes: 8_388_608,

    public: {
      /** 顯示用的網站名稱。實際隊名以後台「網站設定」為準，這裡是後備值。 */
      appName: '球隊官網',
      /** 前端呼叫 BFF 的基底路徑。前端**只能**打這個前綴底下的路由。 */
      apiBase: '/api',
      /** 後台登入頁路徑。`middleware/auth.ts` 與 `useAuth().logout()` 都讀它。 */
      loginPath: '/admin/login',
      /** 網站正式網址，供 SEO 與絕對連結使用。 */
      siteUrl: 'http://localhost:3000',
      /**
       * VAPID 公鑰。**這個值本來就該公開** —— 瀏覽器呼叫
       * `pushManager.subscribe()` 時必須帶上它。留空代表推播功能關閉，
       * 前端的訂閱按鈕會整個不顯示。
       */
      vapidPublicKey: '',
    },
  },

  nitro: {
    // 目標為容器化部署（Docker + K8s / Cloud Run）
    preset: 'node-server',

    /**
     * 兜底錯誤處理。任何沒被 `defineApiHandler` 接到的錯誤（404、middleware 拋錯）
     * 都會走到這裡，確保 `/api/*` 永遠回傳統一的 JSON 錯誤格式而非 HTML 錯誤頁。
     */
    errorHandler: '~~/server/error',

    /**
     * `firebase-admin` 內含原生模組與動態 require，被 Rollup 打包會在執行期炸開。
     * 標成 external 讓它留在 node_modules 由 Node 直接載入。
     */
    externals: {
      external: ['firebase-admin'],
    },

    /**
     * KV 儲存。預設 memory driver 只適用單機。
     * 多實例部署時改成 Redis，業務程式碼一行都不用動。
     */
    storage: {
      ratelimit: { driver: 'memory' },
      cache: { driver: 'memory' },
    },

    /**
     * ## 路由規則
     *
     * ### 公開頁面走 CDN 快取
     * App Hosting 的 CDN **只有在回應帶 `max-age` 或 `s-maxage` 時才會快取**，
     * 預設什麼都不快取（每一次瀏覽都要叫醒 Cloud Run，冷啟動約 2.7 秒）。
     * 這裡替公開頁面補上快取指示：
     *
     * - `s-maxage=60`：CDN 保存 60 秒。後台改完資料，最慢一分鐘後前台換新。
     * - `stale-while-revalidate=600`：過期後 CDN 先把舊的送出去，同時在背景
     *   向來源要新的。**冷啟動因此離開了使用者的等待路徑** —— 這才是重點，
     *   不是省那幾次請求。
     * - `max-age=0`：瀏覽器自己不留快取，重新整理一定會去問 CDN。
     *
     * ### 會被快取就代表「對所有人都一樣」
     * 同一份 HTML 會送給每個訪客，所以公開頁面的 SSR 輸出不能包含任何個人狀態：
     * 配色偏好改由開機腳本在瀏覽器端套用（見 `shared/constants/theme.ts`），
     * 登入狀態改由瀏覽器端還原（見 `app/app.vue`），i18n 的語言偵測 cookie
     * 也關掉了 —— **回應只要帶 `Set-Cookie`，CDN 就完全不會快取**。
     *
     * ### 沒有清除快取的手段
     * App Hosting 沒有提供 CDN purge API，過期只能靠 TTL。60 秒是「後台改完
     * 馬上想看到」與「快取有效」之間的折衷，不要隨手調大。
     *
     * ### API 刻意不快取
     * SSR 取資料走的是 Nitro 內部呼叫，根本不經過 CDN，快取 API 對首屏沒有幫助；
     * 而後台讀的是同一批端點，快取只會讓「我明明存檔了」變成客訴。
     * 例外是 `/api/media/[id]`，它在 handler 內自己設了長一點的快取。
     */
    routeRules: {
      // 移除會洩漏技術棧的預設 header
      '/api/**': {
        headers: {
          'x-powered-by': '',
        },
      },

      // 後台：絕對不能進任何共用快取
      '/admin': { headers: { 'cache-control': PRIVATE_CACHE } },
      '/admin/**': { headers: { 'cache-control': PRIVATE_CACHE } },
      '/api/auth/**': { headers: { 'cache-control': PRIVATE_CACHE } },
      '/api/admin/**': { headers: { 'cache-control': PRIVATE_CACHE } },

      // PWA：SW 永遠重新驗證，圖示與 manifest 可以放久一點
      '/sw.js': { headers: { 'cache-control': NO_CACHE } },
      '/manifest.webmanifest': { headers: { 'cache-control': ICON_CACHE } },
      '/icon-192.png': { headers: { 'cache-control': ICON_CACHE } },
      '/icon-512.png': { headers: { 'cache-control': ICON_CACHE } },
      '/apple-touch-icon.png': { headers: { 'cache-control': ICON_CACHE } },
      '/favicon.svg': { headers: { 'cache-control': ICON_CACHE } },

      // 公開頁面
      '/': { headers: { 'cache-control': PUBLIC_CACHE } },
      '/schedule': { headers: { 'cache-control': PUBLIC_CACHE } },
      '/results': { headers: { 'cache-control': PUBLIC_CACHE } },
      '/news': { headers: { 'cache-control': PUBLIC_CACHE } },
      '/players': { headers: { 'cache-control': PUBLIC_CACHE } },
      '/players/**': { headers: { 'cache-control': PUBLIC_CACHE } },
      '/games/**': { headers: { 'cache-control': PUBLIC_CACHE } },
    },
  },

  /**
   * i18n。本站內容以繁體中文為主，英文語系檔只保留介面骨架用的最小詞條。
   */
  i18n: {
    defaultLocale: 'zh-TW',
    strategy: 'prefix_except_default',
    locales: [
      { code: 'zh-TW', language: 'zh-TW', name: '繁體中文', file: 'zh-TW.json' },
      { code: 'en', language: 'en-US', name: 'English', file: 'en.json' },
    ],
    /**
     * 關閉瀏覽器語言偵測。
     *
     * 它會在每個回應帶上 `Set-Cookie: i18n_locale=...`，而帶 `Set-Cookie`
     * 的回應 App Hosting 的 CDN 一律不快取 —— 為了一個只維護 zh-TW 的網站，
     * 這個代價不划算。內容本來就只有繁體中文，偵測也沒有東西可切。
     */
    detectBrowserLanguage: false,
  },

  app: {
    head: {
      htmlAttrs: { lang: 'zh-TW' },
      /**
       * 配色開機腳本。必須是 `<head>` 裡的同步 inline script，
       * 才能趕在 `<body>` 繪製之前把 `.dark` 掛上去。
       */
      script: [{ innerHTML: COLOR_MODE_BOOTSTRAP, tagPosition: 'head', tagPriority: 'critical' }],
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        /*
         * 瀏覽器介面的顏色。固定用墨藍，不隨深淺色模式改變 ——
         * 導覽列與主視覺本來就永遠是深色的，跟著切反而會接不起來。
         */
        { name: 'theme-color', content: '#071221' },
        // iOS 加到主畫面後以獨立視窗開啟（不顯示 Safari 的網址列）
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
        { name: 'apple-mobile-web-app-title', content: 'MERCS' },
      ],
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'manifest', href: '/manifest.webmanifest' },
        // iOS 不看 manifest 的 icons，安裝到主畫面時只認這個
        { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
      ],
    },
  },

  future: {
    compatibilityVersion: 4,
  },
})
