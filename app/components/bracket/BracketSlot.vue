<script setup lang="ts">
import type { BracketSide, TeamTally } from '#shared/schemas/ws-bracket'
import type { TeamSlotSpot } from '~/utils/ws-bracket-layout'
import { DIAMOND } from '~/utils/ws-bracket-layout'
import { mlbLogo } from '~/utils/mlb-logos'

/**
 * 一個下注位置：樹狀圖上的一支球隊（限期活動，見 `docs/ws-bracket.md`）。
 *
 * 整塊（菱形 + 代碼 + 頭像列）都是同一個按鈕，讓手機上能輕鬆點選。
 */
const props = defineProps<{
  spot: TeamSlotSpot
  side: BracketSide
  standing: 'alive' | 'eliminated' | 'champion'
  tally: TeamTally | undefined
  /** `playerId → 照片網址`，從現役名冊即時查。 */
  photos: Record<string, string>
  /** 有人被點選起來了，這一格可接受下注。 */
  armed: boolean
  /** 已鎖盤：整格不再是落點。 */
  locked: boolean
}>()

const emit = defineEmits<{ place: [] }>()

const WIDTH = 108
/**
 * 高度要**小於**座標表的列距（140），否則上面那格的點擊範圍會蓋住下面那格的
 * 頂端，否則兩個按鈕的可點選範圍會重疊。
 * `tests/unit/ws-bracket.test.ts` 的「沒有任何兩格重疊」守著這件事。
 */
const HEIGHT = 136

const team = computed(() => props.side.team)
const logo = computed(() => mlbLogo(team.value?.code))
/**
 * 能不能當落點。
 *
 * ⚠️ `locked` 一定要算進來，否則鎖盤後按鈕仍能點，最後只會收到安全規則的
 * 英文 `PERMISSION_DENIED`。
 */
const disabled = computed(() => !team.value || props.standing === 'eliminated' || props.locked)

const tone = computed(() => {
  if (props.standing === 'champion') return 'champion' as const
  if (props.standing === 'eliminated') return 'eliminated' as const
  return 'team' as const
})

/** 頭像列最多排四個，其餘收成「+N」—— 再多就會擠到隔壁那一格。 */
const VISIBLE_BETTORS = 4
const bettors = computed(() => props.tally?.bettors ?? [])
const shown = computed(() => bettors.value.slice(0, VISIBLE_BETTORS))
const overflow = computed(() => Math.max(0, bettors.value.length - VISIBLE_BETTORS))

const label = computed(() => {
  if (!team.value) return '待定'
  const seat = props.side.seed ? `第 ${props.side.seed} 種子` : ''
  const count = props.tally?.count ?? 0
  const state = props.standing === 'eliminated' ? '已淘汰' : ''
  return [team.value.name, seat, state, `目前 ${count} 注`].filter(Boolean).join('，')
})
</script>

<template>
  <button
    type="button"
    :disabled="disabled"
    :aria-label="armed ? `下注給 ${label}` : label"
    class="absolute flex flex-col items-center rounded-2xl pt-2 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed"
    :class="[armed && !disabled ? 'cursor-pointer bg-brand-500/10 ring-2 ring-brand-500/40' : '']"
    :style="{
      left: `${spot.cx - WIDTH / 2}px`,
      top: `${spot.cy - DIAMOND / 2 - 8}px`,
      width: `${WIDTH}px`,
      height: `${HEIGHT}px`,
    }"
    @click="emit('place')"
  >
    <div class="relative">
      <BracketDiamond :size="DIAMOND" :tone="tone">
        <img
          v-if="logo"
          :src="logo"
          :alt="team!.name"
          draggable="false"
          class="size-11 rounded-full object-contain"
          :class="standing === 'eliminated' ? 'opacity-40 grayscale' : ''"
        />
        <span v-else class="text-sm font-black text-content-muted">
          {{ team?.code ?? '?' }}
        </span>
      </BracketDiamond>

      <!-- 種子序號。放在菱形的左／右頂點外側，蓋不到隊徽 -->
      <span
        v-if="side.seed"
        class="absolute top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-full bg-ink text-[11px] font-black text-white shadow"
        :class="spot.stack === 'left' ? '-left-2' : '-right-2'"
      >
        {{ side.seed }}
      </span>
    </div>

    <span
      class="mt-0.5 text-[11px] font-black tracking-wide"
      :class="standing === 'eliminated' ? 'text-content-muted line-through' : 'text-content'"
    >
      {{ team?.code ?? '待定' }}
    </span>

    <!--
      下注的頭像。沒有人押就留白，不要畫一個「0 注」—— 十二個 0 只是雜訊。
      ⚠️ 這裡**只印頭像，不印名字** —— 格子只有 108px 寬，加名字會直接爆版；
      要看名字去彩池表（`BracketPot.vue`），那裡才是列完整名單的地方。
    -->
    <span v-if="tally?.count" class="mt-1 flex items-center">
      <span class="flex -space-x-2">
        <BracketAvatar
          v-for="bettor in shown"
          :key="bettor.playerId"
          :name="bettor.name"
          :number="bettor.number"
          :photo-url="photos[bettor.playerId] ?? ''"
          size="sm"
        />
      </span>
      <span
        v-if="overflow"
        class="ml-1 rounded-full bg-ink px-1.5 py-0.5 text-[10px] font-bold text-white"
      >
        +{{ overflow }}
      </span>
    </span>
  </button>
</template>
