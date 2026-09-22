<script setup lang="ts">
import type { LineupEntry } from '#shared/schemas/game'
import { POSITION_LABELS } from '#shared/schemas/player'

/**
 * 打線表。
 *
 * 同時服務兩種情境：已結束比賽的「當天打線」與未來比賽的「預計先發」，
 * 差別只有標題，資料形狀完全一樣。
 *
 * 球員姓名存的是當下的快照，但仍保留 `playerId` —— 有 ID 的就做成連結
 * 可以點進個人頁，臨時支援的球員（沒有 ID）就只顯示名字。
 */
defineProps<{
  entries: LineupEntry[]
  /** 未來場次的先發是「預計」，已結束的是既成事實，語氣要分開。 */
  tentative?: boolean
}>()
</script>

<template>
  <div class="overflow-hidden rounded-xl border border-border">
    <table class="w-full border-collapse text-fluid-sm">
      <thead>
        <tr class="bg-surface-muted text-left">
          <th scope="col" class="w-14 px-3 py-2.5 text-center font-semibold">棒次</th>
          <th scope="col" class="px-3 py-2.5 font-semibold">球員</th>
          <th scope="col" class="w-24 px-3 py-2.5 font-semibold">守備</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="entry in entries" :key="entry.order" class="border-t border-border">
          <td
            class="px-3 py-2.5 text-center font-bold tabular-nums text-brand-600 dark:text-brand-300"
          >
            {{ entry.order }}
          </td>
          <td class="px-3 py-2.5">
            <NuxtLink
              v-if="entry.playerId"
              :to="`/players/${entry.playerId}`"
              class="font-medium hover:text-brand-600"
            >
              <span v-if="entry.number" class="mr-1.5 text-content-muted tabular-nums">
                #{{ entry.number }}
              </span>
              {{ entry.name }}
            </NuxtLink>
            <span v-else class="font-medium">
              <span v-if="entry.number" class="mr-1.5 text-content-muted tabular-nums">
                #{{ entry.number }}
              </span>
              {{ entry.name }}
            </span>
          </td>
          <td class="px-3 py-2.5 text-content-muted">
            {{ POSITION_LABELS[entry.position] }}
          </td>
        </tr>
      </tbody>
    </table>

    <p
      v-if="tentative"
      class="border-t border-border bg-surface-muted px-3 py-2 text-xs text-content-muted"
    >
      先發陣容為預計名單，實際出賽以當天為準。
    </p>
  </div>
</template>
