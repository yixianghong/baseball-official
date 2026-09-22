<script setup lang="ts">
import { MAX_GAME_QUERY_LIMIT, needsResultUpdate } from '#shared/schemas/game'
import { formatGameDate } from '~/utils/format'

/**
 * 後台總覽。
 *
 * 重點不是「有幾筆資料」，而是**有什麼事還沒做**：日期已經過了卻還沒登錄
 * 結果的比賽排在最上面，那是最容易忘記的一件事。
 */
definePageMeta({ layout: 'admin', middleware: 'auth' })

const today = useToday()

const { data: games } = await useGames({ scope: 'all', limit: MAX_GAME_QUERY_LIMIT })
const { data: players } = await usePlayers()
const { data: announcements } = await useAdminAnnouncements()
const { data: settings } = await useSiteSettings()

/** 日期已過但仍標記為未開打 —— 需要補登結果。 */
const pendingResults = computed(() =>
  (games.value ?? []).filter((game) => needsResultUpdate(game, today.value)),
)

const upcoming = computed(() =>
  (games.value ?? []).filter((game) => game.status === 'scheduled' && game.date >= today.value),
)

const stats = computed(() => [
  { label: '待打賽程', value: upcoming.value.length, to: '/admin/games' },
  {
    label: '已登錄結果',
    value: (games.value ?? []).filter((g) => g.status === 'finished').length,
    to: '/admin/games',
  },
  {
    label: '現役球員',
    value: (players.value ?? []).filter((p) => p.status === 'active').length,
    to: '/admin/players',
  },
  {
    label: '已發布公告',
    value: (announcements.value ?? []).filter((a) => a.status === 'published').length,
    to: '/admin/announcements',
  },
])

const draftCount = computed(
  () => (announcements.value ?? []).filter((a) => a.status === 'draft').length,
)

useHead({ title: '後台總覽' })
</script>

<template>
  <div class="space-y-8">
    <AdminHeader title="總覽" :description="`${settings?.teamName ?? '球隊'}的網站管理後台`" />

    <!-- ── 待辦 ───────────────────────────────────────────────── -->
    <section v-if="pendingResults.length" aria-labelledby="todo-heading">
      <h2 id="todo-heading" class="mb-3 text-fluid-lg font-bold">
        待補登結果
        <UiBaseBadge tone="warning" size="sm">{{ pendingResults.length }}</UiBaseBadge>
      </h2>

      <ul class="space-y-2">
        <li
          v-for="game in pendingResults"
          :key="game.id"
          class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/40 bg-warning/5 px-4 py-3"
        >
          <div>
            <p class="font-medium">{{ formatGameDate(game.date) }} vs {{ game.opponent }}</p>
            <p class="text-fluid-sm text-content-muted">比賽日期已過，但還沒登錄比分與打線。</p>
          </div>
          <UiBaseButton
            variant="secondary"
            size="sm"
            @click="navigateTo(`/admin/games/${game.id}`)"
          >
            去登錄
          </UiBaseButton>
        </li>
      </ul>
    </section>

    <!-- ── 統計 ───────────────────────────────────────────────── -->
    <section aria-labelledby="stats-heading">
      <h2 id="stats-heading" class="sr-only">資料統計</h2>
      <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <NuxtLink
          v-for="stat in stats"
          :key="stat.label"
          :to="stat.to"
          class="rounded-xl border border-border bg-surface p-5 transition hover:border-brand-400"
        >
          <p class="text-fluid-sm text-content-muted">{{ stat.label }}</p>
          <p class="mt-1 text-fluid-2xl font-bold tabular-nums">{{ stat.value }}</p>
        </NuxtLink>
      </div>
    </section>

    <!-- ── 快速動作 ───────────────────────────────────────────── -->
    <section aria-labelledby="actions-heading">
      <h2 id="actions-heading" class="mb-3 text-fluid-lg font-bold">快速操作</h2>
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <NuxtLink
          to="/admin/games/new"
          class="rounded-xl border border-border bg-surface p-5 transition hover:border-brand-400"
        >
          <p class="font-medium">📷 用賽程圖新增比賽</p>
          <p class="mt-1 text-fluid-sm text-content-muted">
            上傳官方賽程公告圖，自動辨識出我隊的場次。
          </p>
        </NuxtLink>

        <NuxtLink
          to="/admin/players"
          class="rounded-xl border border-border bg-surface p-5 transition hover:border-brand-400"
        >
          <p class="font-medium">🧢 管理球員名單</p>
          <p class="mt-1 text-fluid-sm text-content-muted">新增隊員、更新背號與守備位置。</p>
        </NuxtLink>

        <NuxtLink
          to="/admin/announcements"
          class="rounded-xl border border-border bg-surface p-5 transition hover:border-brand-400"
        >
          <p class="font-medium">📣 發布公告</p>
          <p class="mt-1 text-fluid-sm text-content-muted">
            {{ draftCount ? `有 ${draftCount} 則草稿尚未發布。` : '通知隊員練習與賽事異動。' }}
          </p>
        </NuxtLink>
      </div>
    </section>
  </div>
</template>
