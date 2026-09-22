<script setup lang="ts">
import type { AttendanceEntry } from '#shared/schemas/game'
import { ATTENDANCE_LABELS } from '#shared/schemas/game'

/**
 * 出席名單（前台唯讀）。
 *
 * 依狀態分組而不是列成一長串：教練最想知道的是「幾個人會到」，
 * 分組之後這個數字一眼就看得到，不用自己數。
 */
const props = defineProps<{ entries: AttendanceEntry[] }>()

const GROUPS = [
  { status: 'yes' as const, tone: 'success' as const },
  { status: 'maybe' as const, tone: 'warning' as const },
  { status: 'no' as const, tone: 'danger' as const },
  { status: 'pending' as const, tone: 'neutral' as const },
]

const groups = computed(() =>
  GROUPS.map((group) => ({
    ...group,
    label: ATTENDANCE_LABELS[group.status],
    members: props.entries.filter((entry) => entry.status === group.status),
  })).filter((group) => group.members.length > 0),
)

const confirmedCount = computed(() => props.entries.filter((e) => e.status === 'yes').length)
</script>

<template>
  <div class="space-y-4">
    <p class="text-fluid-sm text-content-muted">
      目前確定出席
      <strong class="text-fluid-lg font-bold text-brand-600 tabular-nums dark:text-brand-300">
        {{ confirmedCount }}
      </strong>
      人，共 {{ entries.length }} 位隊員回報中。
    </p>

    <div v-for="group in groups" :key="group.status" class="space-y-2">
      <div class="flex items-center gap-2">
        <UiBaseBadge :tone="group.tone" size="sm">{{ group.label }}</UiBaseBadge>
        <span class="text-xs text-content-muted tabular-nums">{{ group.members.length }} 人</span>
      </div>

      <ul class="flex flex-wrap gap-2">
        <li
          v-for="member in group.members"
          :key="member.playerId || member.name"
          class="rounded-lg border border-border bg-surface px-3 py-1.5 text-fluid-sm"
        >
          <span v-if="member.number" class="mr-1 text-content-muted tabular-nums">
            #{{ member.number }}
          </span>
          {{ member.name }}
          <span v-if="member.note" class="ml-1 text-xs text-content-muted"
            >（{{ member.note }}）</span
          >
        </li>
      </ul>
    </div>
  </div>
</template>
