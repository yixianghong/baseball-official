import { defineApiHandler } from '../../utils/handler'
import { validateBody } from '../../utils/validate'
import { createUserSession } from '../../utils/session'
import { signInWithPassword } from '../../utils/firebase-auth'
import { loginSchema } from '../../../shared/schemas/auth'

/**
 * 後台登入。
 *
 * ```
 * 瀏覽器                    BFF (這裡)                Firebase Identity Toolkit
 *   │  POST /api/auth/login    │                                 │
 *   │  { email, password }     │                                 │
 *   ├─────────────────────────>│                                 │
 *   │                          │  accounts:signInWithPassword    │
 *   │                          ├────────────────────────────────>│
 *   │                          │  { idToken, localId, ... }      │
 *   │                          │<────────────────────────────────┤
 *   │                          │                                 │
 *   │                          │ idToken → 加密 session cookie
 *   │                          │ user    → 回應 body
 *   │  Set-Cookie: app_session=<加密密文>; HttpOnly              │
 *   │  { success: true, data: { id, email, name, roles } }        │
 *   │<─────────────────────────┤                                 │
 * ```
 *
 * **回應 body 裡沒有任何 token**，這是刻意的：前端拿到的只有一個讀不到內容的
 * httpOnly cookie，就算發生 XSS 也偷不走憑證。
 *
 * 帳號的新增、停用與密碼重設全部在 Firebase Console 進行，
 * 所以這個專案不需要（也刻意不做）後台的帳號管理介面。
 *
 * ## 防暴力破解
 * 這支端點被 `30.rate-limit.ts` 保護，Firebase 本身也有連續失敗的節流機制
 * （會回 `TOO_MANY_ATTEMPTS_TRY_LATER`，已對應到 429）。
 */
export default defineApiHandler(async (event) => {
  const credentials = await validateBody(event, loginSchema)

  const { user, idToken, refreshToken, expiresInSeconds } = await signInWithPassword(
    event,
    credentials.email,
    credentials.password,
  )

  await createUserSession(event, {
    user,
    accessToken: idToken,
    refreshToken,
    expiresInSeconds,
  })

  event.context.logger.info({ userId: user.id }, 'admin logged in')

  // 只回傳可公開的使用者資料，token 留在 server 端
  return user
})
