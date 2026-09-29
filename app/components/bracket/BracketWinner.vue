<script setup lang="ts">
import type { BracketSeries } from '#shared/schemas/ws-bracket'
import { describeSeries } from '#shared/schemas/ws-bracket'
import { mlbLogo } from '~/utils/mlb-logos'

/**
 * 晉級者的格子（限期活動，見 `docs/ws-bracket.md`）。
 *
 * 還沒打完是金色的「?」，打完就換成晉級那一隊的隊徽。**這一格不能下注** ——
 * 押的是「誰拿下世界大賽冠軍」，押一個還不知道是誰的格子沒有意義。
 *
 * 底下永遠寫一行現況（「2–1 領先」「休士頓太空人 3–1 晉級」），因為菱形本身
 * 只說得出「誰贏了」，說不出「打到第幾場」—— 而季後賽最常被問的就是後者。
 */
const props = defineProps<{
  series: BracketSeries
  cx: number
  cy: number
  size: number
}>()

const winner = computed(() => props.series.sides.find((s) => s.team?.code === props.series.winner))
const logo = computed(() => mlbLogo(winner.value?.team?.code))
const status = computed(() => describeSeries(props.series))

const WIDTH = 132
</script>

<template>
  <div
    class="pointer-events-none absolute flex flex-col items-center"
    :style="{
      left: `${cx - WIDTH / 2}px`,
      top: `${cy - size / 2}px`,
      width: `${WIDTH}px`,
    }"
  >
    <BracketDiamond :size="size" :tone="winner ? 'advanced' : 'pending'">
      <!--
        ⚠️ 三種狀態要分清楚，**不能**把「沒有隊徽」和「還沒分出勝負」畫成同一個
        東西。隊徽只有今年進季後賽的十二支有（`app/assets/img/mlb/`），所以
        改制、補賽或明年再辦一次的時候，一支已經晉級的球隊照樣可能沒有圖 ——
        退回「?」的話，**一個打完的系列賽看起來像還沒打**，而底下那行
        「多倫多藍鳥 4–3 晉級」就跟菱形自相矛盾了。沒有圖就寫代碼。
      -->
      <img
        v-if="logo"
        :src="logo"
        :alt="winner!.team!.name"
        draggable="false"
        class="rounded-full object-contain"
        :style="{ width: `${Math.round(size * 0.5)}px`, height: `${Math.round(size * 0.5)}px` }"
      />
      <span
        v-else-if="winner"
        class="font-black text-content"
        :style="{ fontSize: `${Math.round(size * 0.22)}px` }"
      >
        {{ winner.team!.code }}
      </span>
      <span
        v-else
        class="font-black text-ink"
        :style="{ fontSize: `${Math.round(size * 0.42)}px` }"
        aria-hidden="true"
      >
        ?
      </span>
    </BracketDiamond>

    <p class="mt-0.5 text-center text-[10px] leading-tight font-semibold text-content-muted">
      {{ status }}
    </p>
  </div>
</template>
