<script setup lang="ts">
import type { Player } from '#shared/schemas/player'
import { describeHands, POSITION_LABELS } from '#shared/schemas/player'

/**
 * 球員卡片。
 *
 * 沒有照片時顯示背號作為替代 —— 比放一張灰色人形剪影好看，
 * 也更符合球隊的語彙。
 */
const props = defineProps<{ player: Player }>()

const positionText = computed(() =>
  props.player.positions.map((position) => POSITION_LABELS[position]).join('／'),
)

const handText = computed(() => describeHands(props.player.throws, props.player.bats))
</script>

<template>
  <NuxtLink
    :to="`/players/${player.id}`"
    class="surface-card lift group flex flex-col overflow-hidden rounded-xl border border-border bg-surface-raised hover:border-brand-400"
  >
    <div class="relative aspect-4/5 overflow-hidden bg-ink">
      <img
        v-if="player.photoUrl"
        :src="player.photoUrl"
        :alt="`${player.name} 的照片`"
        loading="lazy"
        class="size-full object-cover transition duration-300 group-hover:scale-105"
      />
      <div v-else class="field-pattern flex size-full items-center justify-center">
        <span class="text-5xl font-black text-white/70 tabular-nums">
          {{ player.number || '—' }}
        </span>
      </div>

      <span
        v-if="player.status === 'inactive'"
        class="absolute left-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-xs font-semibold text-white"
      >
        非現役
      </span>
    </div>

    <div class="flex flex-1 flex-col gap-1 p-4">
      <div class="flex items-baseline gap-2">
        <span class="text-fluid-lg font-bold tabular-nums text-brand-600 dark:text-brand-300">
          {{ player.number || '—' }}
        </span>
        <span class="text-fluid-base font-semibold">{{ player.name }}</span>
      </div>
      <p class="text-fluid-sm text-content-muted">{{ positionText }}</p>
      <p class="text-xs text-content-muted">{{ handText }}</p>
    </div>
  </NuxtLink>
</template>
