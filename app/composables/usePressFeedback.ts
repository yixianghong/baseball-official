/**
 * 「按下去的那一刻」就要看得到。
 *
 * ## 為什麼需要它
 * 逐局紀錄在球場邊實測時，使用者反應「按了有時候沒反應，不確定是自己沒按到，
 * 還是按了在等伺服器」。登錄本身是樂觀更新（`usePlayLog` 先寫畫面與
 * IndexedDB 才送伺服器），所以**從來沒有在等 response** —— 真正缺的是
 * 「我這一下按到了」這個瞬間的回饋。陽光下看一顆沒有任何變化的按鈕，
 * 按到和沒按到長得一模一樣。
 *
 * ## ⚠️ 為什麼不用 CSS 的 `:active`
 * iOS Safari 只有在元素（或祖先）綁了 touch 事件、或元素自己帶
 * `cursor: pointer` 時才套用 `:active`，而 Tailwind v4 的 preflight
 * **不再**給 `button` 預設 `cursor: pointer` —— 兩個條件剛好都不成立。
 * 而這個球隊的登錄裝置正是 iPhone 加到主畫面的 PWA，也就是說整個回饋
 * 會在**唯一真正會用到它的裝置上**安靜地沒有效果，而在開發用的桌機
 * Chrome 上完全正常。
 *
 * 用 pointer 事件自己記就不必依賴那條規則，而且測得到。
 *
 * `pointercancel` 一定要接：手指按在按鈕上往下捲時瀏覽器會接管手勢並送出它，
 * 少了它那顆按鈕會一直停在「按下去」的樣子。
 */
export function usePressFeedback() {
  const pressed = ref<string | null>(null)

  /** `v-on="press.on(key)"`：綁在按鈕上的那一組事件。 */
  function on(key: string) {
    return {
      pointerdown: () => (pressed.value = key),
      pointerup: () => (pressed.value = null),
      pointerleave: () => (pressed.value = null),
      pointercancel: () => (pressed.value = null),
    }
  }

  function is(key: string): boolean {
    return pressed.value === key
  }

  return { pressed, on, is }
}
