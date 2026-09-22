<script setup lang="ts">
/**
 * 應用程式根元件。
 *
 * 這裡只做三件全域的事，畫面結構交給 `layouts/`：
 * 1. 還原登入狀態
 * 2. 掛上配色模式的切換邏輯
 * 3. 設定全站預設的 SEO meta
 */
const { initAuth } = useAuth()
const route = useRoute()
useTheme()

/**
 * 登入狀態要在哪裡還原，取決於這個頁面會不會被 CDN 快取。
 *
 * **公開頁面會被快取**（見 `nuxt.config.ts` 的 `routeRules`），同一份 HTML 送給
 * 所有訪客。如果 SSR 就把登入狀態畫進去，導覽列的「後台」入口會被快取起來
 * 跟著送給每個人；反過來，管理者拿到的是別人（未登入）的快取版本，
 * 前端會誤以為自己沒登入。所以公開頁面一律渲染成未登入，
 * 進了瀏覽器再問一次 `/api/auth/me`。
 *
 * **後台頁面不快取**，維持原本的 SSR 還原 —— `middleware/auth.ts` 在渲染前就
 * 需要知道身分，否則會跟登入頁互相導向（這個坑踩過一次了）。
 *
 * 客戶端這裡刻意不 `await`：首次渲染要跟 SSR 的輸出一致才不會 hydration
 * mismatch，狀態回來之後由 reactivity 自己補上畫面。
 */
const isAdminRoute = route.path === '/admin' || route.path.startsWith('/admin/')

if (import.meta.server) {
  if (isAdminRoute) await initAuth()
} else {
  void initAuth()
}

const config = useRuntimeConfig()
const { t } = useI18n()

useHead({
  titleTemplate: (title) => (title ? `${title} | ${config.public.appName}` : config.public.appName),
  meta: [{ name: 'description', content: () => t('meta.description') }],
})
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
