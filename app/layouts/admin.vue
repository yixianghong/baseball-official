<script setup lang="ts">
/**
 * 後台版面。
 *
 * 與前台分開的理由不只是視覺：後台是工具，密度要高、導覽要固定在側邊、
 * 不需要 SEO 也不需要主視覺。混在同一個版面裡只會兩邊都彆扭。
 *
 * ⚠️ 這裡的登入判斷（以及 `middleware/auth`）都只是**體驗**。
 * 真正的權限檢查在 BFF 的 `requireUser()`，每一支 `/api/admin/**` 都有。
 */
const { displayName, logout } = useAuth()
const { isDark, toggle: toggleTheme } = useTheme()
const { data: settings } = await useSiteSettings()

const route = useRoute()
const mobileMenuOpen = ref(false)

watch(
  () => route.fullPath,
  () => (mobileMenuOpen.value = false),
)

const links = [
  { to: '/admin', label: '總覽', icon: '📊', exact: true },
  { to: '/admin/games', label: '賽事管理', icon: '⚾' },
  { to: '/admin/players', label: '球員名單', icon: '🧢' },
  { to: '/admin/announcements', label: '公告', icon: '📣' },
  { to: '/admin/push', label: '推播通知', icon: '🔔' },
  { to: '/admin/settings', label: '網站設定', icon: '⚙️' },
]

/**
 * 自行判斷是否為目前頁面。
 *
 * 不用 `active-class` 的原因：`/admin` 是所有後台頁面的前綴，交給
 * NuxtLink 判斷會讓「總覽」在每一頁都亮著。`exact` 的項目要完全相符。
 */
function isActive(link: (typeof links)[number]): boolean {
  return link.exact ? route.path === link.to : route.path.startsWith(link.to)
}
</script>

<template>
  <div class="min-h-screen bg-surface-muted text-content">
    <div class="mx-auto flex max-w-[100rem] flex-col md:flex-row">
      <!--
        ── 側邊導覽 ───────────────────────────────────────────

        `pt-[env(safe-area-inset-top)]` 不能省 —— 和前台的 header 是同一個理由
        （見 `layouts/default.vue`）：head 裡設了
        `apple-mobile-web-app-status-bar-style: black-translucent`，加到主畫面
        之後網頁內容會**延伸到狀態列底下**。少了這個內距，手機版的隊名與選單鈕
        就會被瀏海／動態島直接壓住。

        `box-sizing: border-box`（Tailwind preflight）讓這個內距算在
        `md:h-screen` 之內，所以桌機的側欄不會被撐高。
        瀏覽器分頁裡這個值是 0，一般瀏覽不受影響。
      -->
      <header
        class="sticky top-0 z-40 border-b border-border bg-surface pt-[env(safe-area-inset-top)] md:h-screen md:w-60 md:shrink-0 md:border-b-0 md:border-r"
      >
        <!--
          ⚠️ 手機版要 `flex-wrap`。

          這個容器在手機上是一橫列（隊名 ｜ 漢堡鈕），而 `<nav>` 是它的
          **第三個 flex item** —— 沒有 wrap 的話，選單一展開就會被
          `justify-between` 推到右邊，變成三個東西並排。桌機因為
          `md:flex-col` 是直排所以看不出問題。
          配合 `<nav>` 上的 `w-full`，展開時它會自己換到下一整行。
        -->
        <div
          class="flex flex-wrap items-center justify-between gap-2 px-4 py-3 md:flex-col md:flex-nowrap md:items-stretch md:gap-4 md:px-4 md:py-5"
        >
          <NuxtLink to="/admin" class="flex items-center gap-2">
            <span
              class="flex size-8 items-center justify-center rounded-lg bg-brand-600 text-white"
              aria-hidden="true"
            >
              ⚾
            </span>
            <span class="min-w-0">
              <span class="block truncate text-fluid-sm font-bold">
                {{ settings?.teamName || '球隊官網' }}
              </span>
              <span class="block text-xs text-content-muted">後台管理</span>
            </span>
          </NuxtLink>

          <button
            type="button"
            class="flex size-10 items-center justify-center rounded-lg transition hover:bg-surface-muted md:hidden"
            :aria-expanded="mobileMenuOpen"
            aria-controls="admin-menu"
            aria-label="開啟或關閉選單"
            @click="mobileMenuOpen = !mobileMenuOpen"
          >
            <svg
              class="size-6"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              aria-hidden="true"
            >
              <template v-if="mobileMenuOpen">
                <path d="M6 6l12 12" />
                <path d="M18 6L6 18" />
              </template>
              <template v-else>
                <path d="M4 7h16" />
                <path d="M4 12h16" />
                <path d="M4 17h16" />
              </template>
            </svg>
          </button>

          <nav
            id="admin-menu"
            class="w-full flex-col gap-1 md:flex md:w-auto"
            :class="mobileMenuOpen ? 'flex' : 'hidden'"
            aria-label="後台導覽"
          >
            <NuxtLink
              v-for="link in links"
              :key="link.to"
              :to="link.to"
              class="flex min-h-11 items-center gap-2.5 rounded-lg px-3 text-fluid-sm font-medium transition"
              :class="
                isActive(link)
                  ? 'bg-brand-600 text-white'
                  : 'text-content-muted hover:bg-surface-muted hover:text-content'
              "
            >
              <span aria-hidden="true">{{ link.icon }}</span>
              {{ link.label }}
            </NuxtLink>

            <hr class="my-2 border-border" />

            <NuxtLink
              to="/"
              class="flex min-h-11 items-center gap-2.5 rounded-lg px-3 text-fluid-sm text-content-muted transition hover:bg-surface-muted"
            >
              <span aria-hidden="true">🏠</span>
              回到前台
            </NuxtLink>

            <button
              type="button"
              class="flex min-h-11 items-center gap-2.5 rounded-lg px-3 text-left text-fluid-sm text-content-muted transition hover:bg-surface-muted"
              @click="toggleTheme"
            >
              <span aria-hidden="true">{{ isDark ? '🌙' : '☀️' }}</span>
              {{ isDark ? '深色模式' : '亮色模式' }}
            </button>

            <div class="mt-2 border-t border-border pt-3">
              <p class="truncate px-3 text-xs text-content-muted">{{ displayName }}</p>
              <button
                type="button"
                class="mt-1 flex min-h-11 w-full items-center gap-2.5 rounded-lg px-3 text-left text-fluid-sm text-content-muted transition hover:bg-surface-muted"
                @click="logout()"
              >
                <span aria-hidden="true">🚪</span>
                登出
              </button>
            </div>
          </nav>
        </div>
      </header>

      <!-- ── 主要內容 ─────────────────────────────────────────── -->
      <main class="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">
        <slot />
      </main>
    </div>
  </div>
</template>
