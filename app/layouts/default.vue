<script setup lang="ts">
/**
 * 前台版面。
 *
 * ## 視覺結構
 * ```
 * ┌────────┬─────────────────────────────────┬──────────┐
 * │ 隊徽   │        導覽（置中）              │ 社群圖示 │  ← 深藍實心列
 * ├────────┴─────────────────────────────────┴──────────┤
 * │                    頁面內容（滿版）                   │
 * ```
 * 左上角的隊徽區塊比導覽列高一階、用更深的底色，形成一個「徽章座」——
 * 這是職業球團官網常見的作法，讓隊徽成為整個頁面的視覺錨點。
 *
 * ## 隊名與隊徽從後台來
 * 標題列顯示的是 `siteSettings` 的內容，不是寫死的字串或環境變數。
 * `useSiteSettings()` 用固定的 key，所以版面與頁面同時呼叫它時，
 * 一次 SSR 只會實際請求一次。
 */
const { isLoggedIn, logout } = useAuth()
const { toggle: toggleTheme } = useTheme()
const { t } = useI18n()
const config = useRuntimeConfig()

const { data: settings } = await useSiteSettings()
const teamName = computed(() => settings.value?.teamName || config.public.appName)

const mobileMenuOpen = ref(false)

const breakpoints = useBreakpoints({ xs: 480, sm: 640, md: 768, lg: 1024, xl: 1280 })
const isDesktop = breakpoints.greaterOrEqual('lg')

// 切換到桌機寬度時自動收起手機選單，避免狀態殘留造成版面錯亂
watch(isDesktop, (desktop) => {
  if (desktop) mobileMenuOpen.value = false
})

const route = useRoute()
watch(
  () => route.fullPath,
  () => (mobileMenuOpen.value = false),
)

const navLinks = computed(() => [
  { to: '/', label: t('nav.home') },
  { to: '/schedule', label: t('nav.schedule') },
  { to: '/results', label: t('nav.results') },
  { to: '/players', label: t('nav.players') },
  { to: '/news', label: t('nav.news') },
])

useHead({
  meta: [{ name: 'description', content: () => settings.value?.intro || t('meta.description') }],
})
</script>

<template>
  <div class="flex min-h-screen flex-col bg-surface text-content">
    <!-- 跳過導覽：鍵盤使用者按第一次 Tab 就能直接跳到主內容 -->
    <a
      href="#main"
      class="sr-only-focusable absolute left-4 top-4 z-50 rounded bg-brand-600 px-4 py-2 text-white"
    >
      跳至主要內容
    </a>

    <header class="sticky top-0 z-40 bg-ink text-white">
      <div class="flex min-h-16 items-stretch lg:min-h-20">
        <!-- 隊徽座：比導覽列更深的方塊，整個頁面的視覺錨點 -->
        <!--
          隊徽座的寬度跟著圖走，不寫死 —— 方形徽章與橫式字標的寬度差很多，
          固定寬度只能配合其中一種。
        -->
        <NuxtLink
          to="/"
          class="flex shrink-0 items-center gap-3 bg-ink-deep px-5 transition hover:bg-ink-soft lg:px-7"
        >
          <CommonTeamLogo
            :name="teamName"
            :logo-url="settings?.logoUrl"
            :plate="settings?.logoPlate"
            size="md"
            on-dark
          />
          <!-- 有字標時隊名就不必再寫一次（字標本身就是隊名），只留給螢幕閱讀器 -->
          <span class="font-bold" :class="settings?.logoUrl ? 'sr-only' : 'lg:sr-only'">
            {{ teamName }}
          </span>
        </NuxtLink>

        <!-- 桌機：導覽置中 -->
        <nav
          class="hidden flex-1 items-center justify-center gap-1 lg:flex"
          :aria-label="t('nav.primary')"
        >
          <NuxtLink
            v-for="link in navLinks"
            :key="link.to"
            :to="link.to"
            class="relative flex min-h-11 items-center px-5 text-fluid-sm font-semibold tracking-wider text-white/80 transition hover:text-white"
            active-class="text-white after:absolute after:inset-x-4 after:bottom-3 after:h-0.5 after:bg-white"
          >
            {{ link.label }}
          </NuxtLink>
        </nav>

        <div class="ml-auto flex items-center gap-1 px-3 lg:px-6">
          <!-- 社群連結：後台設定了才會出現 -->
          <a
            v-for="social in settings?.socialLinks ?? []"
            :key="social.url"
            :href="social.url"
            target="_blank"
            rel="noopener noreferrer"
            class="hidden size-10 items-center justify-center rounded text-white/70 transition hover:bg-white/10 hover:text-white sm:flex"
            :title="social.label"
          >
            <CommonSocialIcon :label="social.label" />
            <span class="sr-only">{{ social.label }}</span>
          </a>

          <!--
            用 inline SVG 而不是 emoji：emoji 的長相由作業系統的字型決定，
            Windows、macOS、Android 各畫各的，某些環境（含無頭瀏覽器）甚至
            完全不渲染。圖示是介面的一部分，不該交給字型決定它長什麼樣。
          -->
          <!--
            圖示由 CSS 的 `dark:` variant 決定，不是 `v-if="isDark"`。

            這個頁面會被 CDN 快取：同一份 HTML 送給所有訪客，所以 SSR 輸出
            不能依使用者的配色偏好而不同。兩個圖示都渲染、讓 `<html>` 上的
            `.dark` 去挑一個顯示，HTML 就對每個人都一樣了。
            aria-label 同理，用不隨狀態改變的說法。
          -->
          <button
            type="button"
            class="flex size-10 items-center justify-center rounded text-white/70 transition hover:bg-white/10 hover:text-white"
            :aria-label="t('theme.toggle')"
            @click="toggleTheme"
          >
            <svg
              class="hidden size-5 dark:block"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                d="M21.64 13a1 1 0 0 0-1.05-.14 8.05 8.05 0 0 1-3.37.73 8.15 8.15 0 0 1-8.14-8.1 8.6 8.6 0 0 1 .25-2A1 1 0 0 0 8 2.36a10.14 10.14 0 1 0 14 11.69 1 1 0 0 0-.36-1.05Z"
              />
            </svg>
            <svg
              class="size-5 dark:hidden"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                d="M12 18a6 6 0 1 1 0-12 6 6 0 0 1 0 12Zm0-16a1 1 0 0 1 1 1v1a1 1 0 0 1-2 0V3a1 1 0 0 1 1-1Zm0 18a1 1 0 0 1 1 1v1a1 1 0 0 1-2 0v-1a1 1 0 0 1 1-1ZM4.22 5.64a1 1 0 0 1 1.42-1.42l.7.71a1 1 0 0 1-1.41 1.41ZM17.66 19.07a1 1 0 0 1 1.41-1.41l.71.7a1 1 0 0 1-1.42 1.42ZM2 12a1 1 0 0 1 1-1h1a1 1 0 0 1 0 2H3a1 1 0 0 1-1-1Zm18 0a1 1 0 0 1 1-1h1a1 1 0 0 1 0 2h-1a1 1 0 0 1-1-1ZM4.93 19.07a1 1 0 0 1 0-1.41l.71-.71a1 1 0 0 1 1.41 1.41l-.7.71a1 1 0 0 1-1.42 0ZM18.36 5.64a1 1 0 0 1 0-1.42l.71-.7a1 1 0 1 1 1.41 1.41l-.7.71a1 1 0 0 1-1.42 0Z"
              />
            </svg>
          </button>

          <!-- 登入後才顯示後台入口。這只是介面上的整潔，
               真正的權限檢查在 BFF 的 requireUser()。 -->
          <NuxtLink
            v-if="isLoggedIn"
            to="/admin"
            class="hidden min-h-10 items-center rounded border border-white/30 px-4 text-fluid-sm transition hover:bg-white/10 lg:flex"
          >
            後台
          </NuxtLink>

          <button
            type="button"
            class="flex size-10 items-center justify-center rounded text-white transition hover:bg-white/10 lg:hidden"
            :aria-expanded="mobileMenuOpen"
            aria-controls="mobile-menu"
            :aria-label="t('nav.toggleMenu')"
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
        </div>
      </div>

      <!-- 手機選單 -->
      <nav
        v-show="mobileMenuOpen"
        id="mobile-menu"
        class="border-t border-white/10 bg-ink-deep lg:hidden"
        :aria-label="t('nav.mobile')"
      >
        <div class="flex flex-col py-2">
          <NuxtLink
            v-for="link in navLinks"
            :key="link.to"
            :to="link.to"
            class="flex min-h-12 items-center px-5 text-fluid-sm font-semibold text-white/80 transition hover:bg-white/10 hover:text-white"
            active-class="text-white"
          >
            {{ link.label }}
          </NuxtLink>

          <template v-if="isLoggedIn">
            <hr class="my-2 border-white/10" />
            <NuxtLink
              to="/admin"
              class="flex min-h-12 items-center px-5 text-fluid-sm font-semibold text-white/80 transition hover:bg-white/10"
            >
              後台管理
            </NuxtLink>
            <button
              type="button"
              class="flex min-h-12 items-center px-5 text-left text-fluid-sm text-white/80 transition hover:bg-white/10"
              @click="logout()"
            >
              {{ t('auth.logout') }}
            </button>
          </template>

          <div v-if="settings?.socialLinks?.length" class="flex gap-1 px-4 py-3 sm:hidden">
            <a
              v-for="social in settings.socialLinks"
              :key="social.url"
              :href="social.url"
              target="_blank"
              rel="noopener noreferrer"
              class="flex size-10 items-center justify-center rounded text-white/70 transition hover:bg-white/10"
            >
              <CommonSocialIcon :label="social.label" />
              <span class="sr-only">{{ social.label }}</span>
            </a>
          </div>
        </div>
      </nav>
    </header>

    <main id="main" class="flex-1">
      <slot />
    </main>

    <footer class="mt-16 bg-ink py-12 text-white">
      <div
        class="container-content flex flex-col gap-8 md:flex-row md:items-start md:justify-between"
      >
        <div class="space-y-3">
          <div class="flex items-center gap-3">
            <CommonTeamLogo
              :name="teamName"
              :logo-url="settings?.logoUrl"
              :plate="settings?.logoPlate"
              size="lg"
              on-dark
            />
            <p v-if="!settings?.logoUrl" class="text-fluid-lg font-bold">{{ teamName }}</p>
          </div>
          <p v-if="settings?.slogan" class="text-fluid-sm text-white/70">{{ settings.slogan }}</p>
          <p v-if="settings?.homeField" class="text-fluid-sm text-white/70">
            主場：{{ settings.homeField }}
          </p>
          <p v-if="settings?.contactEmail" class="text-fluid-sm text-white/70">
            聯絡信箱：{{ settings.contactEmail }}
          </p>
        </div>

        <nav class="flex flex-col gap-2" aria-label="頁尾導覽">
          <NuxtLink
            v-for="link in navLinks"
            :key="link.to"
            :to="link.to"
            class="text-fluid-sm text-white/70 transition hover:text-white"
          >
            {{ link.label }}
          </NuxtLink>
        </nav>

        <ul v-if="settings?.socialLinks?.length" class="flex flex-wrap gap-2">
          <li v-for="social in settings.socialLinks" :key="social.url">
            <a
              :href="social.url"
              target="_blank"
              rel="noopener noreferrer"
              class="flex size-11 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
              :title="social.label"
            >
              <CommonSocialIcon :label="social.label" />
              <span class="sr-only">{{ social.label }}</span>
            </a>
          </li>
        </ul>
      </div>

      <div class="container-content mt-10 border-t border-white/15 pt-6">
        <!--
          推播訂閱放在頁尾，而且只在瀏覽器支援時才會出現。
          `<ClientOnly>` 是必要的：這一塊的內容取決於通知權限與既有訂閱，
          那是每台裝置各自的狀態。公開頁面會被 CDN 快取送給所有人，
          任何「因裝置而異」的東西都不能進 SSR 輸出。
        -->
        <ClientOnly>
          <div class="mb-6 flex justify-center">
            <CommonPushToggle />
          </div>
        </ClientOnly>

        <p class="text-center text-fluid-sm text-white/60">
          © {{ new Date().getFullYear() }} {{ teamName }}
        </p>
      </div>
    </footer>
  </div>
</template>
