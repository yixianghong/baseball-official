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
 * ## 為什麼不用 IntersectionObserver
 * 用過，而且踩到了坑：**IO 只在「相交狀態改變」時觸發**。元素在掛載當下位於
 * 視窗下方（不相交），使用者一口氣跳到頁面底部之後它變成在視窗上方 ——
 * 依然是「不相交」，狀態沒有改變，所以**回呼永遠不會再被呼叫**，
 * 那個元素就永遠停在 `opacity: 0`。
 *
 * 這不是假設：錨點連結、按 End、以及**重新整理時瀏覽器還原捲動位置**都會走到
 * 這條路。實測慢慢捲 6 個元素全部正常，一次跳到底則 6 個全部永遠隱形。
 *
 * 改用一個共用的捲動監聽器逐一檢查：任何捲動都會觸發，不管是連續的還是跳躍的。
 * 元素數量是數十個的量級，而且清空之後監聽器就自己移除，成本可以忽略。
 */
const waiting = new Set<HTMLElement>()
const delays = new WeakMap<HTMLElement, number>()
let scheduled = false
let listening = false

/** 元素頂端進到視窗下緣以上就算「看得到了」。留 40px 讓它在完全露出前就開始。 */
function isInView(el: HTMLElement): boolean {
  return el.getBoundingClientRect().top < window.innerHeight - 40
}

function reveal(el: HTMLElement, delay: number): void {
  waiting.delete(el)
  window.setTimeout(() => el.classList.remove('is-pending'), delay)
}

function sweep(): void {
  scheduled = false

  for (const el of waiting) {
    if (!el.isConnected) {
      waiting.delete(el)
      continue
    }
    const rect = el.getBoundingClientRect()
    // 已經捲過去的不必再延遲 —— 那個延遲是為了「依序浮現」，補播沒有意義
    if (rect.bottom < 0) reveal(el, 0)
    else if (isInView(el)) reveal(el, delays.get(el) ?? 0)
  }

  if (waiting.size === 0) stopListening()
}

/** 捲動事件很密集，用 rAF 收斂成每一幀最多算一次，避免反覆觸發版面重算。 */
function onScroll(): void {
  if (scheduled) return
  scheduled = true
  requestAnimationFrame(sweep)
}

function startListening(): void {
  if (listening) return
  listening = true
  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('resize', onScroll, { passive: true })
}

function stopListening(): void {
  if (!listening) return
  listening = false
  window.removeEventListener('scroll', onScroll)
  window.removeEventListener('resize', onScroll)
}

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.directive('reveal', {
    mounted(el: HTMLElement, binding: { value?: number }) {
      // 使用者要求減少動態效果時就不做任何事，內容維持直接可見
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return

      // 一進來就看得到的東西不需要動畫，硬做只會先閃一下
      if (isInView(el)) return

      el.classList.add('is-pending')
      delays.set(el, Number(binding.value ?? 0))
      waiting.add(el)
      startListening()
    },

    unmounted(el: HTMLElement) {
      waiting.delete(el)
      delays.delete(el)
      if (waiting.size === 0) stopListening()
    },
  })
})
