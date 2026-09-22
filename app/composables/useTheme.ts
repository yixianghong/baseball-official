import {
  COLOR_MODE_COOKIE,
  COLOR_MODE_MAX_AGE,
  DEFAULT_COLOR_MODE,
  type ColorMode,
} from '#shared/constants/theme'

export type { ColorMode }

/**
 * 深色模式切換。
 *
 * ## 為什麼偏好不能出現在 SSR 產出的 HTML 裡
 * 公開頁面走 CDN 快取（見 `nuxt.config.ts` 的 `routeRules`），**同一份 HTML 會
 * 送給所有訪客**。如果 SSR 依 cookie 決定要不要在 `<html>` 上加 `.dark`，
 * 第一個訪客的偏好就會被快取起來，接下來每個人都拿到他的配色。
 *
 * 更糟的是 `useCookie` 只要給了 `default`，SSR 就會在回應補一個
 * `Set-Cookie` —— 而帶 `Set-Cookie` 的回應 App Hosting 的 CDN 一律不快取，
 * 等於整個快取策略默默失效。所以這裡刻意**不給 default**。
 *
 * ## 那要怎麼不閃白光
 * `<head>` 裡有一段同步的 inline 開機腳本（`COLOR_MODE_BOOTSTRAP`），
 * 在 `<body>` 繪製之前就讀 cookie 把 `.dark` 掛上去。HTML 對所有人一樣，
 * 配色由瀏覽器自己決定，兩件事都成立。
 *
 * ## 元件要怎麼配合
 * 會被快取的頁面裡，**不要用 `isDark` 去決定渲染什麼**（那等於把偏好寫回
 * HTML）。改用 Tailwind 的 `dark:` variant 讓 CSS 決定 —— 例如前台導覽列的
 * 日／月圖示就是兩個都渲染、用 `dark:hidden` 與 `hidden dark:block` 切換。
 * 後台頁面不快取，可以放心直接用 `isDark`。
 *
 * @example
 * ```vue
 * <script setup lang="ts">
 * const { isDark, toggle } = useTheme()
 * </script>
 *
 * <template>
 *   <button aria-label="切換配色模式" @click="toggle">
 *     <SunIcon class="dark:hidden" />
 *     <MoonIcon class="hidden dark:block" />
 *   </button>
 * </template>
 * ```
 */
export function useTheme() {
  // 沒有 default：值維持 undefined 時 Nuxt 不會寫回 cookie，回應就不帶 Set-Cookie
  const mode = useCookie<ColorMode | undefined>(COLOR_MODE_COOKIE, {
    maxAge: COLOR_MODE_MAX_AGE,
    sameSite: 'lax',
    path: '/',
  })

  const isDark = computed(() => (mode.value ?? DEFAULT_COLOR_MODE) === 'dark')

  if (import.meta.client) {
    // 開機腳本已經套過一次，這裡負責的是「之後使用者按了切換」。
    // immediate 是為了讓 hydration 後的狀態與 DOM 對齊（例如 cookie 被外部改掉）。
    watch(isDark, applyColorMode, { immediate: true })
  }

  function applyColorMode(dark: boolean): void {
    const root = document.documentElement
    root.classList.toggle('dark', dark)
    // 讓瀏覽器原生元件（捲軸、表單控制項）也跟著切換配色
    root.style.colorScheme = dark ? 'dark' : 'light'
  }

  function toggle(): void {
    mode.value = isDark.value ? 'light' : 'dark'
  }

  function setMode(next: ColorMode): void {
    mode.value = next
  }

  return { mode, isDark, toggle, setMode }
}
