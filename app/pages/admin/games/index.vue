<script setup lang="ts">
import type { GameStatus } from '#shared/schemas/game'
import {
  GAME_RESULT_LABELS,
  GAME_STATUS_LABELS,
  MAX_GAME_QUERY_LIMIT,
  gameResult,
  hasScore,
  needsResultUpdate,
} from '#shared/schemas/game'
import { formatGameDate } from '~/utils/format'

/**
 * 賽事管理。
 *
 * 一張表管所有場次。日期已過卻還停在「尚未開始」或「比賽中」的那幾場會被
 * 標示出來 —— 這是實際使用時最容易漏掉的事，而忘了按「比賽結束」的場次
 * 會在前台一直掛著 LIVE。
 */
definePageMeta({ layout: 'admin', middleware: 'auth' })

const today = useToday()
const {
  data: games,
  refresh,
  pending,
  error,
} = await useGames({
  scope: 'all',
  limit: MAX_GAME_QUERY_LIMIT,
})
const { removeGame, loading: deleting } = useGameActions()

const filter = ref<'all' | GameStatus>('all')

const filterOptions = [
  { value: 'all', label: '全部' },
  { value: 'scheduled', label: GAME_STATUS_LABELS.scheduled },
  { value: 'live', label: GAME_STATUS_LABELS.live },
  { value: 'finished', label: GAME_STATUS_LABELS.finished },
] as const

/** 狀態對應的標籤色：延賽要看得出是「出事了」，取消則是中性的結束。 */
function statusTone(status: GameStatus) {
  if (status === 'finished') return 'success' as const
  if (status === 'postponed') return 'warning' as const
  if (status === 'canceled') return 'neutral' as const
  return 'brand' as const
}

const filtered = computed(() => {
  const list = games.value ?? []
  if (filter.value === 'all') return list
  return list.filter((game) => game.status === filter.value)
})

async function handleDelete(id: string) {
  await removeGame(id)
  await refresh()
}

useHead({ title: '賽事管理' })
</script>

<template>
  <div>
    <AdminHeader title="賽事管理" description="管理所有比賽、出席、打線與計分板。">
      <template #actions>
        <UiBaseButton variant="secondary" @click="navigateTo('/admin/games/new?mode=manual')">
          手動新增
        </UiBaseButton>
        <UiBaseButton @click="navigateTo('/admin/games/new')">📷 用賽程圖新增</UiBaseButton>
      </template>
    </AdminHeader>

    <div class="mb-4 flex flex-wrap gap-2" role="group" aria-label="狀態篩選">
      <button
        v-for="option in filterOptions"
        :key="option.value"
        type="button"
        class="min-h-9 rounded-full border px-4 text-fluid-sm font-medium transition"
        :class="
          filter === option.value
            ? 'border-brand-600 bg-brand-600 text-white'
            : 'border-border text-content-muted hover:bg-surface'
        "
        :aria-pressed="filter === option.value"
        @click="filter = option.value as typeof filter"
      >
        {{ option.label }}
      </button>
    </div>

    <UiBaseSpinner v-if="pending" />

    <UiBaseError v-else-if="error" :error="error" @retry="refresh" />

    <div
      v-else-if="filtered.length"
      class="overflow-x-auto rounded-xl border border-border bg-surface"
    >
      <table class="w-full min-w-max border-collapse text-fluid-sm">
        <thead>
          <tr class="bg-surface-muted text-left">
            <th scope="col" class="px-4 py-3 font-semibold">日期</th>
            <th scope="col" class="px-4 py-3 font-semibold">對手</th>
            <th scope="col" class="px-4 py-3 font-semibold">場地</th>
            <th scope="col" class="px-4 py-3 font-semibold">狀態</th>
            <th scope="col" class="px-4 py-3 font-semibold">比數</th>
            <th scope="col" class="px-4 py-3 text-right font-semibold">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="game in filtered"
            :key="game.id"
            class="border-t border-border"
            :class="needsResultUpdate(game, today) ? 'bg-warning/5' : ''"
          >
            <td class="px-4 py-3 whitespace-nowrap tabular-nums">
              {{ formatGameDate(game.date) }}
              <span class="ml-1 text-content-muted">{{ game.time }}</span>
            </td>
            <td class="px-4 py-3 font-medium">{{ game.opponent }}</td>
            <td class="px-4 py-3 text-content-muted">{{ game.venue || '—' }}</td>
            <td class="px-4 py-3">
              <!-- 進行中的那一場在整張表裡要最先被看到，所以用和前台一樣的 LIVE -->
              <GameLiveBadge v-if="game.status === 'live'" size="sm" />
              <UiBaseBadge v-else :tone="statusTone(game.status)" size="sm">
                {{ GAME_STATUS_LABELS[game.status] }}
              </UiBaseBadge>
              <span v-if="needsResultUpdate(game, today)" class="ml-2 text-xs text-warning">
                待補登
              </span>
            </td>
            <td class="px-4 py-3 tabular-nums">
              <template v-if="hasScore(game)">
                {{ game.scoreboard.totals.our.r }} : {{ game.scoreboard.totals.opponent.r }}
                <!-- 勝敗是推導的，而且只有結束的比賽才有 —— 領先不等於贏了 -->
                <span v-if="gameResult(game)" class="ml-1 text-content-muted">
                  （{{ GAME_RESULT_LABELS[gameResult(game)!] }}）
                </span>
              </template>
              <span v-else class="text-content-muted">—</span>
            </td>
            <td class="px-4 py-3">
              <div class="flex justify-end gap-1">
                <UiBaseButton
                  variant="ghost"
                  size="sm"
                  @click="navigateTo(`/admin/games/${game.id}`)"
                >
                  編輯
                </UiBaseButton>
                <AdminDeleteButton :loading="deleting" @confirm="handleDelete(game.id)" />
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <UiBaseEmpty
      v-else
      title="還沒有比賽資料"
      description="可以上傳官方賽程公告圖自動建立，或手動新增一場。"
      icon="⚾"
    >
      <UiBaseButton @click="navigateTo('/admin/games/new')">用賽程圖新增</UiBaseButton>
    </UiBaseEmpty>
  </div>
</template>
