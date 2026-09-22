<script setup lang="ts">
import type { GameStatus } from '#shared/schemas/game'
import {
  GAME_RESULT_LABELS,
  GAME_STATUS_LABELS,
  MAX_GAME_QUERY_LIMIT,
  needsResultUpdate,
} from '#shared/schemas/game'
import { formatGameDate } from '~/utils/format'

/**
 * 賽程與結果管理。
 *
 * 一張表管所有場次。日期已過卻還沒登錄結果的那幾場會被標示出來 ——
 * 這是實際使用時最容易漏掉的事。
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

const filter = ref<'all' | 'scheduled' | 'finished'>('all')

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

useHead({ title: '賽程管理' })
</script>

<template>
  <div>
    <AdminHeader title="賽程與結果" description="管理所有比賽、出席、打線與計分板。">
      <template #actions>
        <UiBaseButton variant="secondary" @click="navigateTo('/admin/games/new?mode=manual')">
          手動新增
        </UiBaseButton>
        <UiBaseButton @click="navigateTo('/admin/games/new')">📷 用賽程圖新增</UiBaseButton>
      </template>
    </AdminHeader>

    <div class="mb-4 flex flex-wrap gap-2" role="group" aria-label="狀態篩選">
      <button
        v-for="option in [
          { value: 'all', label: '全部' },
          { value: 'scheduled', label: '未開打' },
          { value: 'finished', label: '已結束' },
        ]"
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
              <UiBaseBadge :tone="statusTone(game.status)" size="sm">
                {{ GAME_STATUS_LABELS[game.status] }}
              </UiBaseBadge>
              <span v-if="needsResultUpdate(game, today)" class="ml-2 text-xs text-warning">
                待補登
              </span>
            </td>
            <td class="px-4 py-3 tabular-nums">
              <template v-if="game.status === 'finished'">
                {{ game.scoreboard.totals.our.r }} : {{ game.scoreboard.totals.opponent.r }}
                <span v-if="game.result" class="ml-1 text-content-muted">
                  （{{ GAME_RESULT_LABELS[game.result] }}）
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
