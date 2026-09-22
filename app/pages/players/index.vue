<script setup lang="ts">
import { POSITIONS, POSITION_LABELS, type Position } from '#shared/schemas/player'

/**
 * 球員名單。
 *
 * 前台只顯示現役球員（`status=active`）—— 已退隊的仍留在資料庫裡，
 * 歷史比賽的打線才連結得到他們的個人頁。
 */
const selectedPosition = ref<Position | ''>('')

const { data: players, pending } = await usePlayers({ status: 'active' })

const filtered = computed(() => {
  const list = players.value ?? []
  if (!selectedPosition.value) return list
  return list.filter((player) => player.positions.includes(selectedPosition.value as Position))
})

/** 只列出名單中真的有人守的位置，避免一排用不到的篩選按鈕。 */
const availablePositions = computed(() => {
  const used = new Set((players.value ?? []).flatMap((player) => player.positions))
  return POSITIONS.filter((position) => used.has(position))
})

useHead({ title: '球員名單' })
</script>

<template>
  <div>
    <CommonPageHero
      en="ROSTER"
      zh="球員名單"
      :description="`共 ${players?.length ?? 0} 位現役球員，點擊查看個人資料與出賽紀錄。`"
    />

    <div class="container-content py-12 md:py-16">
      <div
        v-if="availablePositions.length"
        class="mb-8 flex flex-wrap gap-2"
        role="group"
        aria-label="守備位置篩選"
      >
        <button
          type="button"
          class="min-h-9 rounded-full border px-4 text-fluid-sm font-medium transition"
          :class="
            selectedPosition === ''
              ? 'border-brand-600 bg-brand-600 text-white'
              : 'border-border text-content-muted hover:bg-surface-muted'
          "
          :aria-pressed="selectedPosition === ''"
          @click="selectedPosition = ''"
        >
          全部
        </button>
        <button
          v-for="position in availablePositions"
          :key="position"
          type="button"
          class="min-h-9 rounded-full border px-4 text-fluid-sm font-medium transition"
          :class="
            selectedPosition === position
              ? 'border-brand-600 bg-brand-600 text-white'
              : 'border-border text-content-muted hover:bg-surface-muted'
          "
          :aria-pressed="selectedPosition === position"
          @click="selectedPosition = position"
        >
          {{ POSITION_LABELS[position] }}
        </button>
      </div>

      <UiBaseSpinner v-if="pending" label="名單載入中…" />

      <!-- 大螢幕 5 張、中尺寸 4 張、手機 2 張一排 -->
      <div v-else-if="filtered.length" class="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-5">
        <PlayerCard
          v-for="(player, index) in filtered"
          :key="player.id"
          v-reveal="(index % 5) * 60"
          class="reveal"
          :player="player"
        />
      </div>

      <UiBaseEmpty
        v-else
        title="沒有符合條件的球員"
        :description="selectedPosition ? '換一個守備位置試試。' : '球員名單建立後會顯示在這裡。'"
        icon="🧢"
      />
    </div>
  </div>
</template>
