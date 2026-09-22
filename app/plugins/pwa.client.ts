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
   * 新版 SW 接手之後重新整理一次。
   *
   * SW 裡用了 `skipWaiting()` + `clients.claim()`，新版會立刻接管 ——
   * 但當下這個頁面是舊版 SW 送出來的，它引用的 `_nuxt` 檔名可能已經不存在了。
   * 不重整的話，接下來的路由切換會載入失敗。
   *
   * `refreshing` 這個旗標不能省：`controllerchange` 在某些情況會連續觸發，
   * 少了它就是無窮重整。
   */
  let refreshing = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return
    refreshing = true
    window.location.reload()
  })
})
