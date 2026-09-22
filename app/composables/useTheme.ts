/**
 * 深色模式切換（SSR 無閃爍）。
 *
 * ## 為什麼不直接用 VueUse 的 useColorMode
 * `useColorMode` 把偏好存在 `localStorage`。SSR 期間 Node 讀不到 localStorage，
 * 只能先渲染亮色，等瀏覽器 hydration 後才切成深色 —— 使用者會看到明顯的白光一閃
 * （FOUC，flash of unstyled content）。
 *
 * 這裡改用 **cookie**：瀏覽器每次請求都會自動帶上，所以 SSR 階段就知道該渲染
 * 哪個模式，`<html class="dark">` 從第一個位元組開始就是對的。
 *
 * @example
 * ```vue
 * <script setup lang="ts">
 * const { isDark, toggle } = useTheme()
 * </script>
 *
 * <template>
 *   <button :aria-label="isDark ? '切換至亮色模式' : '切換至深色模式'" @click="toggle">
 *     {{ isDark ? '🌙' : '☀️' }}
 *   </button>
 * </template>
 * ```
 */
export type ColorMode = 'light' | 'dark'

export function useTheme() {
  const mode = useCookie<ColorMode>('color_mode', {
    // 預設深色：球隊識別本身就是深海軍藍配 teal 與金色，深色底才是這組配色的
    // 原生樣貌（主視覺、資訊帶、導覽列本來就是深色）。使用者切成亮色後會記在
    // cookie 裡，之後都照他選的走。
    default: () => 'dark',
    // 一年後過期，讓使用者的偏好持續生效
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
    path: '/',
  })

  const isDark = computed(() => mode.value === 'dark')

  // 把 class 掛到 <html> 上，SSR 產出的 HTML 就已經帶著正確的 class
  useHead({
    htmlAttrs: {
      class: computed(() => (isDark.value ? 'dark' : '')),
    },
    meta: [
      // 讓瀏覽器的原生元件（捲軸、表單控制項）也跟著切換配色
      { name: 'color-scheme', content: computed(() => (isDark.value ? 'dark' : 'light')) },
    ],
  })

  function toggle(): void {
    mode.value = isDark.value ? 'light' : 'dark'
  }

  function setMode(next: ColorMode): void {
    mode.value = next
  }

  return { mode, isDark, toggle, setMode }
}
