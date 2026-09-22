/**
 * `v-reveal` —— 元素捲進視窗時淺入。
 *
 * ## 為什麼不是 `.client.ts`
 * 指令必須在**伺服器端也註冊**。client-only plugin 註冊的指令在 SSR 期間不存在，
 * Vue 解析不到它，整個使用該指令的元件會渲染成空 —— 公告卡片就曾經因此在
 * 前台完全消失，而 API、資料、payload 全都正常，非常難查。
 *
 * 指令的 `mounted` 本來就只在瀏覽器執行，所以把 plugin 寫成同構的沒有副作用。
 *
 * ## 預設可見，JS 只負責「先藏起來再淺入」
 * 反過來做（CSS 預設 `opacity: 0`，等 JS 加 class 才顯示）代表**內容的可見性
 * 依賴 JavaScript 成功執行** —— plugin 沒載入、JS 出錯、使用者關掉 JS，
 * 公告就永遠是一片空白。這裡改成：JS 沒跑，內容照樣看得見；JS 跑了，
 * 才把還在視窗外的元素暫時藏起來做淺入。
 *
 * 已經在視窗內的元素完全不處理，避免「顯示 → 藏起來 → 再淺入」的閃爍。
 *
 * @example
 * ```vue
 * <article v-reveal class="reveal">…</article>
 * <article v-reveal="120" class="reveal">延遲 120ms 再浮現</article>
 * ```
 */
export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.directive('reveal', {
    mounted(el: HTMLElement, binding: { value?: number }) {
      // 使用者要求減少動態效果時就不做任何事，內容維持直接可見
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
      if (typeof IntersectionObserver === 'undefined') return

      const rect = el.getBoundingClientRect()
      const alreadyVisible = rect.top < window.innerHeight && rect.bottom > 0
      // 一進來就看得到的東西不需要動畫，硬做只會先閃一下
      if (alreadyVisible) return

      const delay = Number(binding.value ?? 0)
      el.classList.add('is-pending')

      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue
            window.setTimeout(() => el.classList.remove('is-pending'), delay)
            // 只播一次：捲回去再捲下來不該重播，那會很吵
            observer.unobserve(entry.target)
          }
        },
        // 元素露出約 12% 就開始，比等到完全進入視窗自然得多
        { threshold: 0.12, rootMargin: '0px 0px -40px 0px' },
      )

      observer.observe(el)
      ;(el as HTMLElement & { _revealObserver?: IntersectionObserver })._revealObserver = observer
    },

    unmounted(el: HTMLElement) {
      const target = el as HTMLElement & { _revealObserver?: IntersectionObserver }
      target._revealObserver?.disconnect()
      delete target._revealObserver
    },
  })
})
