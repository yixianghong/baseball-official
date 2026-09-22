import { z } from 'zod'
import { logger } from '../utils/logger'

/**
 * 啟動時驗證設定（fail-fast）。
 *
 * ## 為什麼要在啟動時檢查
 * 設定漏了一項，最糟的情況不是「啟動失敗」，而是「啟動成功、跑了三小時、
 * 直到某個使用者剛好走到那條路徑才 500」。那時錯誤訊息離真正的原因已經很遠。
 *
 * 在程序啟動時就把設定檢查完，缺什麼立刻明確地說出來並拒絕啟動 ——
 * 容器編排系統會直接標記部署失敗並回滾，問題在上線前就被攔下。
 *
 * ## 這個專案特別重要的一點
 * 缺少 Firebase 憑證時，repository 會退回記憶體模式（示範資料、重啟即失），
 * 缺少 Firebase Web API key 時，登入會退回開發模式（萬用密碼）。
 * 這兩件事在開發時很方便，在 production 則是災難 —— 所以它們都列為
 * production 必填，缺一個就拒絕啟動，絕不會悄悄跑在後備模式上。
 */

const isProduction = process.env.NODE_ENV === 'production'

/**
 * 允許 production 建置跑在記憶體資料與開發模式登入上。
 *
 * ## 這是給端對端測試的例外，不是設定的捷徑
 * `pnpm test:e2e` 跑的是 production 建置，但測試不該依賴真的 Firestore
 * （慢、要憑證、而且測試會把正式資料改壞）。這個開關讓那唯一的場景能運作。
 *
 * 開著它部署上線，等於網站跑在示範資料上、後台用萬用密碼就能登入 ——
 * 所以它必須是一個要「刻意設定」的環境變數，而且啟動時會印出明顯的警告。
 */
const allowMemoryStore = process.env.ALLOW_MEMORY_STORE === 'true'

/** 正式環境的必填設定 schema。 */
const productionConfigSchema = z.object({
  sessionPassword: z
    .string()
    .min(32, 'sessionPassword 至少需要 32 個字元（用於加密 session cookie）'),
  firebase: z.object({
    projectId: z.string().min(1, '缺少 NUXT_FIREBASE_PROJECT_ID，否則會退回記憶體模式'),
    // service account 是選填：部署在 App Hosting／Cloud Run 上時用執行環境
    // 本身的身分（ADC），不需要也不應該把私鑰放進雲端的環境變數
    clientEmail: z.string(),
    privateKey: z.string(),
    storageBucket: z.string(),
    webApiKey: z.string().min(1, '缺少 NUXT_FIREBASE_WEB_API_KEY，否則後台登入會退回開發模式'),
  }),
  gemini: z.object({
    apiKey: z.string(),
    model: z.string().min(1),
    timeoutMs: z.number().int().positive(),
  }),
  sessionMaxAge: z.number().int().positive(),
  upstreamTimeoutMs: z.number().int().positive(),
  rateLimitMax: z.number().int().positive(),
  rateLimitWindowMs: z.number().int().positive(),
  maxBodyBytes: z.number().int().positive(),
  maxUploadBytes: z.number().int().positive(),
})

export default defineNitroPlugin(() => {
  const config = useRuntimeConfig()

  if (isProduction && allowMemoryStore) {
    logger.warn(
      '⚠️ ALLOW_MEMORY_STORE=true：資料使用記憶體示範內容、登入使用開發模式。' +
        '這只應該出現在端對端測試中，正式部署請移除這個環境變數。',
    )
    return
  }

  if (isProduction) {
    const result = productionConfigSchema.safeParse(config)

    if (!result.success) {
      const issues = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      logger.fatal(
        { issues: result.error.issues },
        '設定驗證失敗，服務無法啟動。請檢查環境變數（見 .env.example）',
      )
      // 用 console 再輸出一次，確保即使 log 收集尚未就緒也看得到
      console.error('\n[FATAL] 設定驗證失敗：\n' + issues.join('\n') + '\n')
      process.exit(1)
    }

    // Gemini 沒設定不算致命 —— 網站其他功能都能用，只是後台的圖片辨識按鈕會回報無法使用
    if (!config.gemini?.apiKey) {
      logger.warn('未設定 NUXT_GEMINI_API_KEY，後台的圖片辨識功能將無法使用')
    }

    logger.info('configuration validated')
    return
  }

  // --- 開發環境：只警告，不改動設定 ---
  //
  // ⚠️ 這裡刻意「只讀不寫」。Nuxt 在開發模式會把 runtimeConfig 凍結成唯讀物件，
  // 任何指派都會拋出 TypeError，而且發生在 Nitro plugin 初始化階段。
  if (!config.sessionPassword || config.sessionPassword.length < 32) {
    logger.warn(
      '未設定 NUXT_SESSION_PASSWORD，將使用本次啟動產生的臨時密鑰。' +
        '重啟後既有的登入狀態會失效。請複製 .env.example 為 .env 並設定它。',
    )
  }

  // 用 optional chaining 而不是直接取值：這支 plugin 的存在意義就是「設定不完整時
  // 給出清楚的訊息」，若它自己因為讀不到巢狀欄位而拋 TypeError，
  // 使用者看到的會是一個與 session 完全無關的堆疊，反而更難追。
  if (
    !config.firebase?.projectId ||
    !config.firebase?.clientEmail ||
    !config.firebase?.privateKey
  ) {
    logger.warn(
      '未設定 Firebase 憑證，資料將使用記憶體中的示範內容（重啟即失）。' +
        '設定方式見 README 的「Firebase 設定」。',
    )
  }

  if (!config.firebase?.webApiKey) {
    logger.warn(
      '未設定 NUXT_FIREBASE_WEB_API_KEY，後台登入使用開發模式（任何 email + password1234）',
    )
  }

  if (!config.gemini?.apiKey) {
    logger.warn('未設定 NUXT_GEMINI_API_KEY，後台的圖片辨識功能將無法使用')
  }
})
