<script setup lang="ts">
/**
 * 前台頁面上的「去後台編輯這一筆」入口。**只有登入過的人看得到。**
 *
 * 後台的比賽頁已經有一顆「前台預覽」，這是回程的那一半 —— 在前台看到哪裡
 * 不對，可以直接跳去改，不必回到後台列表再找一次那一場。
 *
 * ## ⚠️ 為什麼這是 CDN 安全的
 * 公開頁面走 CDN 快取，同一份 HTML 會送給所有訪客，所以**登入狀態不能出現
 * 在 SSR 輸出裡**（見 CLAUDE.md「公開頁面走 CDN 快取」）。這裡沒有做任何
 * 額外處理就成立，因為 `app/app.vue` 已經決定好：公開頁面的 SSR **一律**
 * 渲染成未登入，進了瀏覽器才問 `/api/auth/me`。
 *
 * 所以這個連結在 SSR 與 hydration 的第一幀都不存在（兩邊一致，不會
 * mismatch），`/api/auth/me` 回來之後才由 reactivity 補上。
 *
 * ⚠️ **不要為了「少閃一下」而在 SSR 還原登入狀態**：那會讓管理者的版本被
 * 快取起來送給所有訪客。
 *
 * ## 藏一個連結不是權限控制
 * `v-if` 只是介面上的整潔。真正的檢查在後台路由的 middleware 與 BFF 的
 * `requireUser()` —— 沒登入的人自己打網址進去，照樣會被擋下來。
 */
defineProps<{
  /** 後台的網址，例如 `/admin/games/g3`。 */
  to: string
  label?: string
}>()

const { isLoggedIn } = useAuth()
</script>

<template>
  <NuxtLink
    v-if="isLoggedIn"
    :to="to"
    class="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-border px-3 text-fluid-sm text-content-muted transition hover:border-brand-600 hover:text-brand-600"
  >
    <span aria-hidden="true">✎</span>
    {{ label ?? '後台編輯' }}
  </NuxtLink>
</template>
