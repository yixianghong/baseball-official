<script setup lang="ts">
import type { HomeAway } from '#shared/schemas/half-inning'
import { battingSide } from '#shared/schemas/half-inning'
import { PLAY_RESULTS, sortPlays, type Play } from '#shared/schemas/play'

/**
 * 落點圖：這一場每一球打到哪裡。
 *
 * 底圖與點都和後台的拖曳登錄共用（`GameFieldBase`、`GameSprayMarker`），
 * 座標來自同一支 `shared/schemas/field.ts` —— 登錄時放在游擊方向的球，
 * 這裡一定也畫在游擊方向。
 *
 * ## 兩隊分開看
 * 我隊的圖看「我們打向哪裡」；對手的圖看「他們打向哪裡」—— 後者可以拿來
 * 參考下一次交手時的守備站位。兩隊疊在一張圖上的話，兩種用途都看不出來。
 *
 * ## 只畫有落點的打席
 * 三振、保送本來就沒有落點；用按鈕或語音登錄的打席也沒有。圖下方會講出
 * 「N 個打席裡有 M 個有落點」—— 少了這一句，一張只登了五個落點的圖看起來
 * 就像那一場只打了五球。
 */
const props = defineProps<{
  plays: Play[]
  homeAway: HomeAway
  ourName: string
  opponentName: string
}>()

type Side = 'our' | 'opponent'

const side = ref<Side>('our')

const bySide = computed(() => {
  const groups: Record<Side, Play[]> = { our: [], opponent: [] }
  for (const play of sortPlays(props.plays)) {
    if (!PLAY_RESULTS[play.result].plateAppearance) continue
    groups[battingSide(play.half, props.homeAway)].push(play)
  }
  return groups
})

const located = computed(() => bySide.value[side.value].filter((play) => play.location))

const hasAny = computed(
  () =>
    bySide.value.our.some((play) => play.location) ||
    bySide.value.opponent.some((play) => play.location),
)

const tabs = computed(() => [
  { key: 'our' as const, label: props.ourName },
  { key: 'opponent' as const, label: props.opponentName || '對手' },
])
</script>

<template>
  <section v-if="hasAny" aria-labelledby="spray-heading" class="space-y-3">
    <div class="flex flex-wrap items-baseline justify-between gap-2">
      <h2 id="spray-heading" class="text-fluid-xl font-bold">擊球落點</h2>

      <div class="flex gap-1" role="tablist" aria-label="看哪一隊的落點">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          type="button"
          role="tab"
          :aria-selected="side === tab.key"
          class="min-h-10 rounded-full border px-4 text-fluid-sm transition"
          :class="
            side === tab.key
              ? 'border-brand-600 bg-brand-600 text-white'
              : 'border-border text-content-muted hover:bg-surface-muted'
          "
          @click="side = tab.key"
        >
          {{ tab.label }}
        </button>
      </div>
    </div>

    <!--
      寬度綁著：落點圖放大之後點與點的距離不變、只是更稀疏，並不會更好讀。
      這個尺寸在手機上是滿版，在桌機上和出賽名單圖卡差不多寬。
    -->
    <div class="max-w-xl overflow-hidden rounded-xl border border-border">
      <GameFieldBase>
        <GameSprayMarker v-for="(play, index) in located" :key="index" :play="play" />
      </GameFieldBase>
    </div>

    <!--
      圖例：形狀＝擊球類型，紅色實心＝安打。安打除了顏色還有「實心」可以辨認
      （色弱的人分不出紅和其他顏色），所以不必再寫空心代表什麼。
    -->
    <ul class="flex flex-wrap gap-x-4 gap-y-1 text-fluid-sm text-content-muted">
      <li>● 滾地</li>
      <li>■ 平飛</li>
      <li>▲ 高飛</li>
      <li><span class="text-danger" aria-hidden="true">●</span> 實心＝安打</li>
    </ul>

    <p class="text-xs text-content-muted">
      {{ bySide[side].length }} 個打席裡有 {{ located.length }} 個記了落點（三振、保送沒有落點）。
    </p>
  </section>
</template>
