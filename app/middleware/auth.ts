/**
 * 路由守衛：要求登入。
 *
 * ## 使用方式
 * 在需要保護的頁面加上：
 * ```vue
 * <script setup lang="ts">
 * definePageMeta({ middleware: 'auth' })
 * </script>
 * ```
 *
 * ## 為什麼要在這裡 await initAuth()
 * route middleware 跑在**根元件 `app.vue` 的 setup 之前** —— 所以不能假設
 * 登入狀態已經還原好了。少了下面那一行 await，已登入的使用者重新整理
 * 後台頁面時會這樣：
 *
 * ```
 * 1. SSR 跑 middleware：store 還是空的 → 判定未登入 → 導向 /admin/login
 * 2. SSR 渲染登入頁：app.vue 的 initAuth() 這時才執行 → 讀到有效 session
 * 3. 登入頁發現已登入 → 導回 /admin
 * 4. 回到第 1 步 … ERR_TOO_MANY_REDIRECTS
 * ```
 *
 * `initAuth()` 內部用 `callOnce` 與 `store.initialized` 短路，所以每次導航
 * 都呼叫它並不會重複打 API —— 第一次之後就只是讀一個旗標。
 *
 * ## ⚠️ 這只是使用者體驗，不是安全機制
 * 路由守衛跑在**用戶端可控的環境**中，攻擊者可以繞過它。
 * 真正的權限檢查必須在 BFF 做（`requireUser()` / `requireRole()`），
 * 這裡只是避免使用者看到一個註定會失敗的空白頁面。
 */
export default defineNuxtRouteMiddleware(async (to) => {
  const { isLoggedIn, initAuth } = useAuth()

  // 先確保登入狀態已從 session 還原，再做判斷
  await initAuth()

  if (isLoggedIn.value) return

  // 登入頁路徑由 runtimeConfig 集中管理（`public.loginPath`），
  // 各專案建立自己的登入頁後改設定即可，不需要動這個檔案。
  const { public: publicConfig } = useRuntimeConfig()

  // 記下原本要去的頁面，登入成功後導回去
  return navigateTo({
    path: publicConfig.loginPath,
    query: { redirect: to.fullPath },
  })
})
