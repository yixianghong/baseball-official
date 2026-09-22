import type { Firestore } from 'firebase-admin/firestore'
import type { Storage } from 'firebase-admin/storage'
import { logger } from './logger'

/**
 * Storage bucket 的型別。
 *
 * 直接 `import type { Bucket } from '@google-cloud/storage'` 會失敗 ——
 * 它是 firebase-admin 的相依，pnpm 不會把它提升到頂層 node_modules。
 * 從 firebase-admin 自己的型別推導出來就沒有這個問題。
 */
type Bucket = ReturnType<Storage['bucket']>

/**
 * Firebase Admin SDK 的單一入口。
 *
 * ## 它在架構中的位置
 * 樣板原本的最下游是「外部 API」（`upstream.ts`），這個專案換成 Firebase。
 * 不變的是那條鐵則：**憑證只存在 Node 層**。前端完全不載入 Firebase SDK，
 * 也拿不到任何 token，所有資料存取都必須經過 `server/api/*` 這道門。
 *
 * ## 兩種存取方式
 * 本機開發用 `.env` 裡的 service account；部署在 App Hosting／Cloud Run 上時
 * 只要設 `projectId`，Admin SDK 會用執行環境本身的身分（ADC）—— 不需要把
 * 私鑰放進雲端的任何地方。
 *
 * ## 沒有憑證時會發生什麼
 * `isFirebaseConfigured()` 回 false 時，各 repository 會改用
 * `server/utils/memory-store.ts` 的記憶體資料（含示範內容）。
 * 這讓專案 clone 下來、還沒去 Firebase Console 開專案就能 `pnpm dev`
 * 看到完整畫面，e2e 測試也不必依賴 emulator。
 *
 * 記憶體模式只適合開發與測試：資料重啟即失，多實例之間也不共用。
 * production 缺少憑證會在啟動時被 `00.env-validate.ts` 擋下。
 *
 * ## 為什麼用動態 import
 * `firebase-admin` 體積大且含原生相依。記憶體模式下完全不需要它，
 * 延後到真的要用時才載入，開發模式的啟動速度差很多。
 */

/**
 * 存取 Firebase 的兩種方式。
 *
 * - `service-account`：本機開發用。憑證從 `.env` 讀，明確而且不依賴環境。
 * - `adc`：部署在 Google Cloud（App Hosting／Cloud Run）時用。執行環境的
 *   服務帳戶本身就有權限，不需要把私鑰放進任何地方 —— 少一份要保管的機密，
 *   就少一個外洩的途徑。
 */
interface FirebaseCredentials {
  mode: 'service-account' | 'adc'
  projectId: string
  clientEmail: string
  privateKey: string
  storageBucket: string
}

let cached: { db: Firestore; bucket: Bucket | null } | null = null
let initPromise: Promise<{ db: Firestore; bucket: Bucket | null }> | null = null

/**
 * 讀取並正規化 Firebase 憑證設定。
 *
 * `projectId` 是最低要求。有 service account 就用它；沒有的話，只要跑在
 * Google Cloud 上就能用執行環境本身的身分（ADC）。兩者都沒有才算未設定。
 */
export function getFirebaseCredentials(): FirebaseCredentials | null {
  const config = useRuntimeConfig()
  const { projectId, clientEmail, privateKey, storageBucket } = config.firebase

  if (!projectId) return null

  const hasServiceAccount = Boolean(clientEmail && privateKey)

  return {
    mode: hasServiceAccount ? 'service-account' : 'adc',
    projectId,
    clientEmail,
    // .env 無法直接寫多行，私鑰的換行一律以字面 \n 保存，這裡還原回真正的換行。
    privateKey: privateKey.replace(/\\n/g, '\n'),
    storageBucket,
  }
}

/** 是否具備連線 Firebase 的條件。repository 用它決定走真實資料或記憶體資料。 */
export function isFirebaseConfigured(): boolean {
  return getFirebaseCredentials() !== null
}

/**
 * 取得 Firestore 與 Storage bucket。
 *
 * 用 promise 快取而非旗標，避免併發請求同時觸發初始化
 * （Firebase Admin 對同名 app 重複 `initializeApp` 會拋錯）。
 */
async function ensureInitialized(): Promise<{ db: Firestore; bucket: Bucket | null }> {
  if (cached) return cached
  if (initPromise) return initPromise

  initPromise = (async () => {
    const credentials = getFirebaseCredentials()
    if (!credentials) {
      throw new Error('Firebase 未設定，請改用記憶體模式（呼叫端應先檢查 isFirebaseConfigured）')
    }

    const { getApps, initializeApp, cert } = await import('firebase-admin/app')
    const { getFirestore } = await import('firebase-admin/firestore')

    const existing = getApps()
    const app =
      existing.length > 0 && existing[0]
        ? existing[0]
        : initializeApp({
            // ADC 模式不傳 credential —— Admin SDK 會自動取用執行環境的身分
            ...(credentials.mode === 'service-account'
              ? {
                  credential: cert({
                    projectId: credentials.projectId,
                    clientEmail: credentials.clientEmail,
                    privateKey: credentials.privateKey,
                  }),
                }
              : {}),
            projectId: credentials.projectId,
            storageBucket: credentials.storageBucket || undefined,
          })

    const db = getFirestore(app)
    // 讓 Firestore 回傳的 undefined 欄位不會讓寫入整個失敗
    try {
      db.settings({ ignoreUndefinedProperties: true })
    } catch {
      // settings() 只能在第一次操作前呼叫一次，熱更新時重複呼叫會拋錯，忽略即可
    }

    let bucket: Bucket | null = null
    if (credentials.storageBucket) {
      const { getStorage } = await import('firebase-admin/storage')
      bucket = getStorage(app).bucket()
    }

    logger.info(
      { projectId: credentials.projectId, mode: credentials.mode },
      'firebase admin initialized',
    )
    cached = { db, bucket }
    return cached
  })()

  try {
    return await initPromise
  } catch (err) {
    // 初始化失敗就清掉 promise，下次請求可以重試（例如憑證剛修好）
    initPromise = null
    throw err
  }
}

/** 取得 Firestore 實例。呼叫前請先確認 `isFirebaseConfigured()`。 */
export async function getDb(): Promise<Firestore> {
  const { db } = await ensureInitialized()
  return db
}

/** 取得 Storage bucket。未設定 bucket 時回傳 null。 */
export async function getBucket(): Promise<Bucket | null> {
  const { bucket } = await ensureInitialized()
  return bucket
}

/** 測試用：清掉快取的連線，讓下一次呼叫重新初始化。 */
export function resetFirebaseForTests(): void {
  cached = null
  initPromise = null
}
