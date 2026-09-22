<script setup lang="ts">
import { MAX_GAME_QUERY_LIMIT } from '#shared/schemas/game'
/**
 * 近期賽程。
 *
 * 只顯示尚未開打且日期未過的場次，由近到遠（排序在 BFF 做，見
 * `server/repositories/games.ts`）。點進去可以看預計出席與先發陣容。
 */
const today = useToday()
const { data: settings } = await useSiteSettings()
const {
  data: games,
  pending,
  error,
  refresh,
} = await useGames({ scope: 'upcoming', limit: MAX_GAME_QUERY_LIMIT })

const teamName = computed(() => settings.value?.teamName ?? '')

useHead({ title: '近期賽程' })
</script>

<template>
  <div>
    <CommonPageHero
      en="SCHEDULE"
      zh="近期賽程"
      description="點擊任一場比賽可查看預計出席名單與先發陣容。"
    />

    <div class="container-content py-12 md:py-16">
      <UiBaseSpinner v-if="pending" label="賽程載入中…" />

      <UiBaseError v-else-if="error" :error="error" @retry="refresh" />

      <div v-else-if="games?.length" class="grid gap-4 md:grid-cols-2">
        <GameCard
          v-for="game in games"
          :key="game.id"
          :game="game"
          :our-name="teamName"
          :today="today"
        />
      </div>

      <UiBaseEmpty
        v-else
        title="目前沒有安排中的賽程"
        description="新的賽程公布後會顯示在這裡，也可以先看看過去的比賽結果。"
        icon="📅"
      >
        <NuxtLink
          to="/results"
          class="text-fluid-sm text-brand-600 hover:underline dark:text-brand-300"
        >
          查看比賽結果 →
        </NuxtLink>
      </UiBaseEmpty>
    </div>
  </div>
</template>
