<script setup lang="ts">
import { ApiError } from '~/utils/api-error'

/**
 * 後台登入。
 *
 * 帳號由 Firebase Authentication 管理 —— 新增帳號、停用、重設密碼都在
 * Firebase Console 操作，這個專案刻意不做帳號管理介面。
 *
 * 密碼送到 BFF 之後由伺服器端向 Firebase 驗證，瀏覽器拿到的只有一個
 * httpOnly 的加密 session cookie，沒有任何 Firebase token。
 */
definePageMeta({ layout: 'blank' })

const { login, loading, error, isLoggedIn } = useAuth()
const route = useRoute()
const config = useRuntimeConfig()
const { data: settings } = await useSiteSettings()

const form = reactive({ email: '', password: '' })
const message = ref('')

/** 登入後要去哪：優先回到原本想去的頁面（由 `middleware/auth` 帶上）。 */
const redirectTo = computed(() => {
  const target = route.query.redirect
  return typeof target === 'string' && target.startsWith('/') ? target : '/admin'
})

// 已登入的人不需要看到登入頁
watchEffect(() => {
  if (isLoggedIn.value) navigateTo(redirectTo.value)
})

async function submit() {
  message.value = ''
  try {
    await login({ email: form.email, password: form.password })
    await navigateTo(redirectTo.value)
  } catch (err) {
    message.value = ApiError.from(err).message
  }
}

useHead({ title: '後台登入' })
</script>

<template>
  <div class="flex min-h-screen items-center justify-center px-4 py-12">
    <div class="w-full max-w-sm">
      <div class="mb-8 text-center">
        <span
          class="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-ink text-2xl font-black text-accent-400"
          aria-hidden="true"
        >
          ⚾
        </span>
        <h1 class="text-fluid-xl font-bold">{{ settings?.teamName || config.public.appName }}</h1>
        <p class="mt-1 text-fluid-sm text-content-muted">後台管理登入</p>
      </div>

      <form
        class="space-y-4 rounded-2xl border border-border bg-surface-raised p-6"
        @submit.prevent="submit"
      >
        <UiBaseInput
          v-model="form.email"
          label="電子郵件"
          type="email"
          autocomplete="username"
          required
          :error="error?.fieldErrors.email?.[0]"
        />

        <UiBaseInput
          v-model="form.password"
          label="密碼"
          type="password"
          autocomplete="current-password"
          required
          hint="至少 8 個字元"
          :error="error?.fieldErrors.password?.[0]"
        />

        <p
          v-if="message"
          class="rounded-lg bg-danger/10 px-3 py-2 text-fluid-sm text-danger"
          role="alert"
        >
          {{ message }}
        </p>

        <UiBaseButton type="submit" :loading="loading" class="w-full">登入</UiBaseButton>
      </form>

      <p class="mt-6 text-center text-fluid-sm text-content-muted">
        <NuxtLink to="/" class="hover:text-brand-600">← 回到官網</NuxtLink>
      </p>
    </div>
  </div>
</template>
