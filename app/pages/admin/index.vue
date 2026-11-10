<script setup lang="ts">
import type { Game } from '#shared/schemas/game'
import {
  ATTENDANCE_LABELS,
  MAX_GAME_QUERY_LIMIT,
  matchupOrder,
  needsResultUpdate,
} from '#shared/schemas/game'
import { formatLockAt } from '#shared/schemas/attendance'
import { daysUntil, describeCountdown, formatGameDate, formatGameStamp } from '~/utils/format'

/**
 * 後台總覽。
 *
 * 重點不是「有幾筆資料」，而是**有什麼事還沒做**。所以最上面是**下一場比賽**
 * 以及它賽前要備齊的三件事（出席、打線、先發投手），每一件都直接連到那個
 * 分頁；接著是日期已過卻還沒登錄結果的比賽（最容易忘記的那件事）。
 * 資料統計只是一列小字 —— 原本是四張大數字卡排在最上面，但「現役球員 11 人」
 * 不是任何人打開後台時想知道的事。
 *
 * 這一頁的每個數字都是從既有資料推導的，沒有新增任何欄位。
 */
definePageMeta({ layout: 'admin', middleware: 'auth' })

const today = useToday()

const { data: games } = await useGames({ scope: 'all', limit: MAX_GAME_QUERY_LIMIT })
const { data: players } = await usePlayers()
const { data: announcements } = await useAdminAnnouncements()
const { data: settings } = await useSiteSettings()

const teamName = computed(() => settings.value?.teamName || '我隊')

/** 日期已過但仍標記為未開打 —— 需要補登結果。 */
const pendingResults = computed(() =>
  (games.value ?? []).filter((game) => needsResultUpdate(game, today.value)),
)

const upcoming = computed(() =>
  (games.value ?? []).filter((game) => game.status === 'scheduled' && game.date >= today.value),
)

/**
 * 最上面那一場：**今天進行中的**優先，其次是最近的一場未開打。
 *
 * 進行中只認「今天」的：日期已過還掛著「比賽中」的那種是忘了按結束，
 * 它屬於下面的「待補登」，放在這裡會被讀成「現在有比賽」。
 * 列表的排序方向不保證，所以自己依日期與時間排。
 */
const featured = computed<Game | null>(() => {
  const list = games.value ?? []
  const live = list.find((game) => game.status === 'live' && game.date === today.value)
  if (live) return live
  const byStart = (a: Game, b: Game) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)
  return [...upcoming.value].sort(byStart)[0] ?? null
})

/** 賽前要備齊的三件事。每一列都是「現況 + 該去哪裡補」。 */
const checklist = computed(() => {
  const game = featured.value
  if (!game) return []

  const counts = { yes: 0, no: 0, maybe: 0, pending: 0 }
  for (const entry of game.attendance) counts[entry.status]++
  const answered = game.attendance.length - counts.pending

  const pitcher = game.startingPitcher
  return [
    {
      label: '出席',
      tab: 'attendance',
      done: game.attendance.length > 0 && counts.pending === 0,
      value: game.attendance.length
        ? `已回覆 ${answered}／${game.attendance.length}`
        : '尚未建立名單',
      detail: game.attendance.length
        ? (['yes', 'no', 'maybe'] as const)
            .filter((status) => counts[status])
            .map((status) => `${ATTENDANCE_LABELS[status]} ${counts[status]}`)
            .concat(game.attendanceLockAt ? [`${formatLockAt(game.attendanceLockAt)} 截止`] : [])
            .join('、')
        : '',
    },
    {
      label: '打線',
      tab: 'lineup',
      done: game.lineup.length >= 9,
      value: game.lineup.length ? `已排 ${game.lineup.length} 棒` : '尚未安排',
      detail: '',
    },
    {
      label: '先發投手',
      tab: 'lineup',
      done: Boolean(pitcher),
      value: pitcher
        ? [pitcher.number && `#${pitcher.number}`, pitcher.name].filter(Boolean).join(' ')
        : '尚未決定',
      detail: '',
    },
  ]
})

const stats = computed(() => [
  { label: '待打賽程', value: upcoming.value.length, to: '/admin/games?status=scheduled' },
  {
    label: '已登錄結果',
    value: (games.value ?? []).filter((g) => g.status === 'finished').length,
    to: '/admin/games?status=finished',
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
  <div class="max-w-4xl space-y-8">
    <AdminHeader title="總覽" :description="`${settings?.teamName ?? '球隊'}的網站管理後台`" />

    <!-- ── 下一場比賽 ─────────────────────────────────────────── -->
    <section
      v-if="featured"
      aria-labelledby="featured-heading"
      class="rounded-xl border border-border bg-surface"
    >
      <div class="flex flex-wrap items-start justify-between gap-4 p-5">
        <div class="min-w-0">
          <h2 id="featured-heading" class="flex flex-wrap items-center gap-2 text-sm">
            <GameLiveBadge v-if="featured.status === 'live'" size="sm" />
            <span v-else class="text-content-muted">下一場比賽</span>
            <span
              v-if="featured.status !== 'live'"
              class="font-medium text-brand-700 dark:text-brand-300"
            >
              {{ describeCountdown(daysUntil(featured.date, today)) }}
            </span>
          </h2>
          <p class="mt-1 text-fluid-xl font-bold [overflow-wrap:anywhere]">
            {{ matchupOrder(featured.homeAway, teamName, featured.opponent).join(' vs ') }}
          </p>
          <p class="mt-1 text-fluid-sm text-content-muted">
            <!-- 接成一個字串：拆成兩段的話，換行縮排會在逗號前面多出一個空白 -->
            {{
              [formatGameStamp(featured.date, featured.time), featured.venue]
                .filter(Boolean)
                .join('，')
            }}
          </p>
        </div>

        <div class="flex flex-wrap gap-2">
          <UiBaseButton variant="secondary" @click="navigateTo(`/admin/record/${featured.id}`)">
            <AdminIcon name="video" />
            現場錄影
          </UiBaseButton>
          <UiBaseButton
            @click="
              navigateTo(
                featured.status === 'live'
                  ? `/admin/games/${featured.id}?tab=innings`
                  : `/admin/games/${featured.id}`,
              )
            "
          >
            {{ featured.status === 'live' ? '去登錄逐局' : '開啟這場' }}
          </UiBaseButton>
        </div>
      </div>

      <!--
        賽前要備齊的三件事。整列都是連結，直接打開那個分頁 ——
        看到「打線：尚未安排」的下一個動作一定是去排，不該再從列表點進去、
        再切分頁。還沒備齊的用警示色，備齊了就退成一般的文字。
      -->
      <ul class="border-t border-border">
        <li
          v-for="item in checklist"
          :key="item.label"
          class="border-b border-border last:border-b-0"
        >
          <NuxtLink
            :to="`/admin/games/${featured.id}?tab=${item.tab}`"
            class="flex min-h-12 flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2.5 transition-colors hover:bg-surface-muted focus-visible:-outline-offset-2"
          >
            <span class="w-20 shrink-0 text-fluid-sm text-content-muted">{{ item.label }}</span>
            <span
              class="inline-flex items-center gap-1.5 font-medium"
              :class="item.done ? '' : 'text-warning'"
            >
              <AdminIcon v-if="item.done" name="check" class="size-4 text-success" />
              {{ item.value }}
            </span>
            <span v-if="item.detail" class="text-fluid-sm text-content-muted">
              {{ item.detail }}
            </span>
          </NuxtLink>
        </li>
      </ul>
    </section>

    <UiBaseEmpty
      v-else
      title="目前沒有排定的比賽"
      description="上傳官方賽程公告圖，自動建立接下來的場次。"
    >
      <template #icon><AdminIcon name="baseball" class="size-8" /></template>
      <UiBaseButton @click="navigateTo('/admin/games/new')">用賽程圖新增</UiBaseButton>
    </UiBaseEmpty>

    <!-- ── 待補登 ─────────────────────────────────────────────── -->
    <section v-if="pendingResults.length" aria-labelledby="todo-heading">
      <h2 id="todo-heading" class="mb-3 flex items-center gap-2 text-fluid-lg font-bold">
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

    <!-- ── 快速操作 ───────────────────────────────────────────── -->
    <section aria-labelledby="actions-heading">
      <h2 id="actions-heading" class="mb-3 text-fluid-lg font-bold">快速操作</h2>
      <div class="grid gap-3 sm:grid-cols-3">
        <NuxtLink
          to="/admin/games/new"
          class="rounded-xl border border-border bg-surface p-4 transition-colors hover:border-brand-400"
        >
          <p class="flex items-center gap-2 font-medium">
            <AdminIcon name="camera" class="size-5 text-brand-600 dark:text-brand-300" />
            用賽程圖新增比賽
          </p>
          <p class="mt-1 text-fluid-sm text-content-muted">
            上傳官方賽程公告圖，自動辨識出我隊的場次。
          </p>
        </NuxtLink>

        <NuxtLink
          to="/admin/players"
          class="rounded-xl border border-border bg-surface p-4 transition-colors hover:border-brand-400"
        >
          <p class="flex items-center gap-2 font-medium">
            <AdminIcon name="users" class="size-5 text-brand-600 dark:text-brand-300" />
            管理球員名單
          </p>
          <p class="mt-1 text-fluid-sm text-content-muted">新增隊員、更新背號與守備位置。</p>
        </NuxtLink>

        <NuxtLink
          to="/admin/announcements"
          class="rounded-xl border border-border bg-surface p-4 transition-colors hover:border-brand-400"
        >
          <p class="flex items-center gap-2 font-medium">
            <AdminIcon name="megaphone" class="size-5 text-brand-600 dark:text-brand-300" />
            發布公告
          </p>
          <p class="mt-1 text-fluid-sm text-content-muted">
            {{ draftCount ? `有 ${draftCount} 則草稿尚未發布。` : '通知隊員練習與賽事異動。' }}
          </p>
        </NuxtLink>
      </div>
    </section>

    <!--
      ── 統計 ────────────────────────────────────────────────

      降成一列小字：數字有用（點下去就是那個篩選），但它們不是打開後台時
      要先看到的東西。`tabular-nums` 在後台有效 —— 後台用的是系統黑體，
      不是沒有等寬數字的 Oswald。
    -->
    <section aria-labelledby="stats-heading">
      <h2 id="stats-heading" class="sr-only">資料統計</h2>
      <ul class="flex flex-wrap gap-x-6 gap-y-2 text-fluid-sm">
        <li v-for="stat in stats" :key="stat.label">
          <NuxtLink
            :to="stat.to"
            class="inline-flex items-baseline gap-1.5 rounded-lg text-content-muted hover:text-content"
          >
            {{ stat.label }}
            <strong class="font-bold text-content tabular-nums">{{ stat.value }}</strong>
          </NuxtLink>
        </li>
      </ul>
    </section>
  </div>
</template>
