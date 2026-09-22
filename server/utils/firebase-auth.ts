import type { H3Event } from 'h3'
import { createExternalClient, extractResponseBody, extractStatus } from './external'
import { AppError, ERROR_CODE } from './errors'
import { getDb, isFirebaseConfigured } from './firebase'
import { publicUserSchema, type PublicUser } from '../../shared/schemas/auth'
import { logger } from './logger'

/**
 * 後台帳密驗證 —— 走 Firebase Identity Toolkit，但 token 不進瀏覽器。
 *
 * ## 為什麼不用前端的 Firebase SDK
 * 前端 SDK 的做法是瀏覽器直接跟 Firebase 換 idToken，然後把 token 存在
 * IndexedDB / localStorage。那等於把憑證交到 XSS 拿得到的地方。
 *
 * 這裡改成：
 * ```
 * 瀏覽器 ──(email/password)──> BFF ──> Identity Toolkit
 *                               │ 驗證通過
 *                               │ 改發「樣板自己的」加密 httpOnly session
 *   <──(Set-Cookie: 密文)───────┘
 * ```
 * 前端從頭到尾沒有 Firebase token，session 也讀不到內容。
 * 帳號的增刪改、密碼重設全部在 Firebase Console 操作，不需要後台管理介面。
 *
 * ## 角色
 * 從 Firebase 使用者的 custom claims 讀 `roles`（陣列）或 `role`（字串）。
 * 沒有設定任何 claim 的使用者一律視為 `admin` —— 能登入後台就是管理員，
 * 需要更細的權限時在 Console 設 custom claims 即可，程式碼不用改。
 */

/** Identity Toolkit 的 REST 客戶端。 */
const identityToolkit = createExternalClient({
  name: 'firebase-auth',
  baseUrl: () => 'https://identitytoolkit.googleapis.com/v1',
})

interface SignInResponse {
  localId: string
  email: string
  displayName?: string
  idToken: string
  refreshToken?: string
  expiresIn?: string
}

/** Identity Toolkit 的錯誤碼 → 對使用者說的話。 */
const AUTH_ERROR_MESSAGES: Record<string, string> = {
  EMAIL_NOT_FOUND: '帳號或密碼錯誤',
  INVALID_PASSWORD: '帳號或密碼錯誤',
  INVALID_LOGIN_CREDENTIALS: '帳號或密碼錯誤',
  USER_DISABLED: '此帳號已被停用',
  TOO_MANY_ATTEMPTS_TRY_LATER: '嘗試次數過多，請稍後再試',
}

export interface SignInResult {
  user: PublicUser
  idToken: string
  refreshToken?: string
  expiresInSeconds?: number
}

/**
 * 以 email／密碼登入。
 *
 * @throws {AppError} 帳密錯誤為 `UNAUTHORIZED`，上游異常為 `UPSTREAM_ERROR`
 */
export async function signInWithPassword(
  event: H3Event,
  email: string,
  password: string,
): Promise<SignInResult> {
  const config = useRuntimeConfig(event)
  const apiKey = config.firebase.webApiKey

  // 沒有設定 Web API key 時走開發用登入，讓專案在還沒接上 Firebase 前就能進後台。
  // production 缺少這項設定會在啟動階段被 `00.env-validate.ts` 擋下，走不到這裡。
  if (!apiKey) {
    return devSignIn(email, password)
  }

  let result: SignInResponse
  try {
    result = await identityToolkit<SignInResponse>(event, '/accounts:signInWithPassword', {
      method: 'POST',
      query: { key: apiKey },
      body: { email, password, returnSecureToken: true },
      // 認證失敗不該重試 —— 重試只會加速觸發帳號鎖定
      retries: 0,
    })
  } catch (err) {
    throw mapSignInError(err)
  }

  const roles = await resolveRoles(result.localId)

  return {
    user: publicUserSchema.parse({
      id: result.localId,
      email: result.email,
      name: result.displayName || result.email.split('@')[0] || '管理員',
      roles,
    }),
    idToken: result.idToken,
    refreshToken: result.refreshToken,
    expiresInSeconds: result.expiresIn ? Number(result.expiresIn) : undefined,
  }
}

/**
 * 從 Firebase 使用者的 custom claims 取角色。
 *
 * Admin SDK 不可用（記憶體模式）或查詢失敗時退回 `['admin']` ——
 * 帳密已經驗證通過了，不該因為讀不到 claims 就把人擋在門外。
 */
async function resolveRoles(uid: string): Promise<string[]> {
  if (!isFirebaseConfigured()) return ['admin']

  try {
    const { getAuth } = await import('firebase-admin/auth')
    const { getApps } = await import('firebase-admin/app')

    // 直接沿用 firebase.ts 初始化好的 app，兩邊各自 initializeApp 會重複建立
    await getDb()
    const app = getApps()[0]
    if (!app) return ['admin']

    const record = await getAuth(app).getUser(uid)
    const claims = record.customClaims ?? {}

    if (Array.isArray(claims.roles)) return claims.roles.map(String)
    if (typeof claims.role === 'string') return [claims.role]
    return ['admin']
  } catch (err) {
    logger.warn({ err, uid }, 'failed to read custom claims, defaulting to admin role')
    return ['admin']
  }
}

/** 把 Identity Toolkit 的錯誤轉成對使用者有意義的訊息。 */
function mapSignInError(err: unknown): AppError {
  const status = extractStatus(err)
  const body = extractResponseBody(err) as { error?: { message?: string } } | undefined
  const upstreamCode = body?.error?.message?.split(' ')[0] ?? ''

  if (upstreamCode && AUTH_ERROR_MESSAGES[upstreamCode]) {
    const code =
      upstreamCode === 'TOO_MANY_ATTEMPTS_TRY_LATER'
        ? ERROR_CODE.RATE_LIMITED
        : ERROR_CODE.UNAUTHORIZED
    return new AppError(code, AUTH_ERROR_MESSAGES[upstreamCode], { cause: err })
  }

  // 400 但不是已知的認證錯誤碼，多半是設定問題（API key 錯了、專案未啟用密碼登入）
  if (status === 400) {
    logger.error({ body }, 'identity toolkit rejected the request')
    return new AppError(ERROR_CODE.UPSTREAM_ERROR, '登入服務設定有誤，請聯絡管理員', {
      cause: err,
    })
  }

  return err instanceof AppError
    ? err
    : new AppError(ERROR_CODE.UPSTREAM_ERROR, undefined, { cause: err })
}

/**
 * 開發用登入。
 *
 * 只在「沒有設定 Firebase Web API key」時生效，讓剛 clone 下來的專案可以
 * 直接進後台看畫面。production 缺這項設定會直接無法啟動，所以不會有
 * 「正式環境不小心留著萬用密碼」的風險。
 */
function devSignIn(email: string, password: string): SignInResult {
  logger.warn('未設定 NUXT_FIREBASE_WEB_API_KEY，使用開發模式登入')

  if (password !== DEV_PASSWORD) {
    throw new AppError(ERROR_CODE.UNAUTHORIZED, '帳號或密碼錯誤')
  }

  return {
    user: publicUserSchema.parse({
      id: 'dev-admin',
      email,
      name: email.split('@')[0] || '管理員',
      roles: ['admin'],
    }),
    idToken: 'dev-id-token',
    expiresInSeconds: 3600,
  }
}

/** 開發模式登入用的密碼。接上 Firebase 之後這個常數就不再有任何作用。 */
export const DEV_PASSWORD = 'password1234'
