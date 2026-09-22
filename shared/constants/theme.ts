/**
 * 配色模式的共用常數。
 *
 * 這裡的值同時被三個地方使用，所以不能各寫各的：
 * - `app/composables/useTheme.ts`（前端狀態）
 * - `nuxt.config.ts` 注入的開機腳本（首次繪製前就決定 `<html class="dark">`）
 * - `tests/e2e/bff.test.ts`（驗證 SSR 輸出不含使用者偏好）
 */
export const COLOR_MODE_COOKIE = 'color_mode'

export type ColorMode = 'light' | 'dark'

/** 沒有 cookie 時的預設。球隊識別本身就是深色，深底才是這組配色的原生樣貌。 */
export const DEFAULT_COLOR_MODE: ColorMode = 'dark'

/** cookie 保存一年，讓使用者切換過的偏好持續生效。 */
export const COLOR_MODE_MAX_AGE = 60 * 60 * 24 * 365

/**
 * 在首次繪製前套用配色的開機腳本。
 *
 * ## 為什麼配色不能由 SSR 決定
 * 公開頁面要讓 CDN 快取，同一份 HTML 會送給所有訪客 —— 只要 SSR 把
 * `class="dark"` 寫進 HTML，第一個訪客的偏好就會被快取起來塞給其他人。
 *
 * 所以 HTML 對所有人都一樣，配色改由這段同步腳本在瀏覽器端套用。
 * 它是阻塞式的 inline script，跑在 `<body>` 繪製之前，所以不會閃白光（FOUC）。
 *
 * 讀 cookie 而不是 localStorage 的原因：cookie 的值在後台（不快取的頁面）
 * SSR 時也讀得到，兩邊共用同一個來源。
 */
export const COLOR_MODE_BOOTSTRAP = `(function(){try{var m=document.cookie.match(/(?:^|;\\s*)${COLOR_MODE_COOKIE}=(light|dark)/);var d=m?m[1]==="dark":${DEFAULT_COLOR_MODE === 'dark'};var r=document.documentElement;r.classList.toggle("dark",d);r.style.colorScheme=d?"dark":"light"}catch(e){}})()`
