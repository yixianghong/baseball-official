/**
 * 註冊 Service Worker。
 *
 * ## 為什麼是 `.client.ts`
 * `navigator.serviceWorker` 只存在於瀏覽器。這裡跟 `app/plugins/reveal.ts`
 * 的情況剛好相反 —— reveal 註冊的是 Vue 指令，SSR 解析不到會讓元件整個渲染成空；
 * 這支不參與渲染，只是掛副作用，所以 client-only 是對的。
 *
 * ## 開發模式不註冊
 * SW 會攔截請求，跟 Vite 的 HMR 打架，而且一旦註冊就會留在瀏覽器裡，
 * 之後即使關掉也還在。要驗證 SW 請用正式建置：`pnpm build && pnpm start`。
 */
export default defineNuxtPlugin(() => {
  if (import.meta.dev) return
  if (!('serviceWorker' in navigator)) return

  function register(): void {
    navigator.serviceWorker
      .register('/sw.js', {
        scope: '/',
        // 不要讓 HTTP 快取決定何時抓新的 sw.js，一律問伺服器
        updateViaCache: 'none',
      })
      .catch((error) => {
        // 註冊失敗不影響網站本身，記錄就好
        console.error('[pwa] Service Worker 註冊失敗', error)
      })
  }

  /*
   * 等頁面載完再註冊：SW 的下載與安裝不該跟首屏的資源搶頻寬。
   *
   * ⚠️ 但**不能只掛 `load` 監聽器**。Nuxt plugin 是在 hydration 階段執行的，
   * 那時 `load` 事件常常已經發生過了 —— 監聽器就永遠不會被呼叫，SW 安靜地
   * 沒有註冊，而且沒有任何錯誤訊息。所以要先問現在的 `readyState`。
   */
  if (document.readyState === 'complete') register()
  else window.addEventListener('load', register, { once: true })

  /**
   * 新版 SW 接手之後，**下一次換頁**改成整頁載入。
   *
   * SW 裡用了 `skipWaiting()` + `clients.claim()`，新版會立刻接管 ——
   * 但當下這個頁面是舊版送出來的，它引用的 `_nuxt` 檔名可能已經不存在了，
   * 接下來的路由切換會載入失敗。
   *
   * ⚠️ 原本這裡是**當場** `location.reload()`。那會在任何時候把頁面砍掉：
   * 錄影錄到一半（整段消失）、後台表單的自動儲存還在 debounce（那幾個字消失）。
   * 使用者什麼都沒按，畫面就自己重新載入了。
   *
   * 現在只記一個旗標，等使用者自己換頁時才用整頁載入取代 SPA 導覽 ——
   * 那是他本來就要離開這一頁的時機。元件自己的 `onBeforeRouteLeave`
   * （上傳中的確認、自動儲存的 flush）會在全域守衛之前跑完，不受影響。
   */
  let stale = false
  /*
   * 第一次安裝時 `clients.claim()` 也會觸發 `controllerchange`（從「沒有 SW」
   * 變成「有」）。那不是換版，這一頁的資源本來就是最新的，不需要整頁載入。
   */
  let controlled = !!navigator.serviceWorker.controller
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!controlled) {
      controlled = true
      return
    }
    stale = true
  })

  useRouter().beforeEach((to) => {
    if (!stale) return
    window.location.assign(to.fullPath)
    return false
  })
})
