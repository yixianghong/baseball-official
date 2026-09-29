<script setup lang="ts">
import type { Bracket, BetTally, BracketSide, TeamTally } from '#shared/schemas/ws-bracket'
import { describeSeries, teamStanding } from '#shared/schemas/ws-bracket'
import type { TeamSlotSpot } from '~/utils/ws-bracket-layout'
import {
  CANVAS,
  CHAMPION_SPOT,
  CONNECTIONS,
  ROUND_TAGS,
  TEAM_SLOTS,
  WINNER_SPOTS,
  connectorPath,
  spotByKey,
} from '~/utils/ws-bracket-layout'
import { mlbLogo } from '~/utils/mlb-logos'

/**
 * 季後賽樹狀圖（限期活動，見 `docs/ws-bracket.md`）。
 *
 * 一張固定尺寸的畫布（座標表在 `app/utils/ws-bracket-layout.ts`），
 * **橫向捲動由外層負責**，手機使用者可左右查看完整賽程。
 */
const props = defineProps<{
  bracket: Bracket
  tally: BetTally
  photos: Record<string, string>
  /** 有人被點選起來了，所有可下注的格子要亮起來。 */
  armed: boolean
  /** 已鎖盤：每一格都不再是落點。 */
  locked: boolean
}>()

const emit = defineEmits<{ place: [team: string] }>()

/**
 * 把座標表與資料在 script 裡先併好。
 *
 * 不在 template 裡直接寫 `bracket.series[spot.series].sides[spot.side]` ——
 * 那一串在六個屬性上各出現一次，改一個地方就要記得改六次。
 */
interface Slot {
  spot: TeamSlotSpot
  side: BracketSide
  standing: 'alive' | 'eliminated' | 'champion'
  tally: TeamTally | undefined
}

const slots = computed<Slot[]>(() =>
  TEAM_SLOTS.map((spot) => {
    const side = props.bracket.series[spot.series].sides[spot.side]
    const code = side.team?.code
    return {
      spot,
      side,
      standing: code ? teamStanding(props.bracket, code) : 'alive',
      tally: code ? props.tally.byTeam[code] : undefined,
    }
  }),
)

const connectors = computed(() =>
  CONNECTIONS.map(([from, to]) => connectorPath(spotByKey(from), spotByKey(to))),
)

const champion = computed(() => props.bracket.champion)
const championLogo = computed(() => mlbLogo(champion.value?.code))
const finalStatus = computed(() => describeSeries(props.bracket.series.W_1))
</script>

<template>
  <div
    class="relative mx-auto"
    :style="{ width: `${CANVAS.width}px`, height: `${CANVAS.height}px` }"
  >
    <!--
      連接線。`pointer-events-none` 不能省：它蓋在整張畫布上，少了這一行，
      它蓋在整張畫布上，不能擋住底下球隊按鈕的點選。
    -->
    <svg
      class="pointer-events-none absolute inset-0"
      :viewBox="`0 0 ${CANVAS.width} ${CANVAS.height}`"
      fill="none"
      aria-hidden="true"
    >
      <path
        v-for="(d, i) in connectors"
        :key="i"
        :d="d"
        class="stroke-border"
        stroke-width="2"
        stroke-linejoin="round"
      />
    </svg>

    <!-- 輪次標題 -->
    <p
      v-for="tag in ROUND_TAGS"
      :key="`${tag.text}:${tag.cx}`"
      class="absolute -translate-x-1/2 -translate-y-1/2 text-center text-xs font-black tracking-[0.2em] text-content-muted uppercase"
      :style="{ left: `${tag.cx}px`, top: `${tag.cy}px` }"
    >
      {{ tag.text }}
    </p>

    <!-- 晉級者（唯讀） -->
    <BracketWinner
      v-for="spot in WINNER_SPOTS"
      :key="spot.series"
      :series="bracket.series[spot.series]"
      :cx="spot.cx"
      :cy="spot.cy"
      :size="spot.size"
    />

    <!-- 世界大賽。冠軍出來之前它就是最大的那個「?」 -->
    <div
      class="pointer-events-none absolute flex w-32 -translate-x-1/2 flex-col items-center"
      :style="{
        left: `${CHAMPION_SPOT.cx}px`,
        top: `${CHAMPION_SPOT.cy - CHAMPION_SPOT.size / 2}px`,
      }"
    >
      <BracketDiamond :size="CHAMPION_SPOT.size" tone="champion">
        <!-- 沒有隊徽時寫代碼，不要退回「?」也不要送 src=""（那會畫成破圖） -->
        <img
          v-if="championLogo"
          :src="championLogo"
          :alt="champion!.name"
          draggable="false"
          class="size-14 rounded-full object-contain"
        />
        <span v-else-if="champion" class="text-2xl font-black text-ink">{{ champion.code }}</span>
        <span v-else class="text-5xl font-black text-ink" aria-hidden="true">?</span>
      </BracketDiamond>
      <p class="mt-1 text-center text-xs font-black text-content">
        {{ champion ? `${champion.name} 奪冠` : '世界大賽冠軍' }}
      </p>
      <p class="text-center text-[10px] leading-tight text-content-muted">{{ finalStatus }}</p>
    </div>

    <!-- 下注位置 -->
    <BracketSlot
      v-for="slot in slots"
      :key="slot.spot.key"
      :spot="slot.spot"
      :side="slot.side"
      :standing="slot.standing"
      :tally="slot.tally"
      :photos="photos"
      :armed="armed"
      :locked="locked"
      @place="slot.side.team && emit('place', slot.side.team.code)"
    />
  </div>
</template>
