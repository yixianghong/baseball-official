<script setup lang="ts">
import type { HomeAway } from '#shared/schemas/half-inning'
import { battingSide } from '#shared/schemas/half-inning'
import { describePerson, PLAY_RESULTS, sortPlays, type Play } from '#shared/schemas/play'

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
 *
 * ## 可以只看某一位打者
 * 守備站位要看的是「這個人往哪裡打」，而不是整隊疊在一起。
 *
 * ⚠️ **選單只列「這一場有落點的打者」**，不是整份名單 —— 列出來卻一個點都
 * 沒有的人，使用者會以為圖壞了。只有一位時整個選單不顯示（只有一個選項的
 * 選單是噪音）。
 *
 * ⚠️ **打者的身分要用 `playerId || 背號 || 姓名`。** 對手沒有名冊，
 * 打席上只有背號；我隊才有 `playerId`。只比對 `playerId` 的話，整隊對手會被
 * 併成同一個「空字串」打者，圖上看起來完全正常（點都在），但那是全隊的點。
 *
 * ⚠️ 一場比賽裡一位打者只有三四個打席，所以**這張圖是用來回顧的，不足以
 * 排守備站位** —— 那需要跨場次累計（和「季賽累計」是同一件事，還沒做）。
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

/** 選了哪一位打者。空字串＝全部。 */
const batter = ref('')

// 換一隊就把打者的選擇清掉 —— 兩隊的背號是各自的，留著一定對不到人
watch(side, () => (batter.value = ''))

/**
 * 這一場有落點的打者。
 *
 * 只列有落點的人：列出來卻一個點都沒有，使用者會以為圖壞了。
 * 括號裡的數字是他有幾個落點，挑之前就知道值不值得看。
 */
const batters = computed(() => {
  const seen = new Map<string, { key: string; label: string; count: number }>()
  for (const play of bySide.value[side.value]) {
    if (!play.location) continue
    const key = batterKey(play)
    if (!key) continue
    const found = seen.get(key)
    if (found) found.count += 1
    else seen.set(key, { key, label: describePerson(play.batter), count: 1 })
  }
  return [...seen.values()]
})

const batterOptions = computed(() => [
  { value: '', label: `全部打者（${batters.value.length} 位）` },
  ...batters.value.map((item) => ({ value: item.key, label: `${item.label}（${item.count}）` })),
])

/** 目前這張圖涵蓋的打席（選了打者就只算他的）。 */
const scoped = computed(() =>
  batter.value
    ? bySide.value[side.value].filter((play) => batterKey(play) === batter.value)
    : bySide.value[side.value],
)

const located = computed(() => scoped.value.filter((play) => play.location))

const hasAny = computed(
  () =>
    bySide.value.our.some((play) => play.location) ||
    bySide.value.opponent.some((play) => play.location),
)

/**
 * 打者的身分。
 *
 * ⚠️ **不能只用 `playerId`** —— 對手沒有名冊，打席上只有背號，所有對手打者的
 * `playerId` 都是空字串。只比對它的話整隊會被併成同一個「打者」，而圖上看起來
 * 完全正常（點都在），只是那是全隊的點。
 */
function batterKey(play: Play): string {
  return play.batter.playerId || play.batter.number || play.batter.name
}

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
      ⚠️ 只有一位打者時整個不顯示 —— 只有一個選項的選單是噪音。
      用下拉而不是一排膠囊：一隊十幾個人，膠囊在手機上會排成三行，
      把圖整個擠到螢幕外，而圖才是這一區的重點。
    -->
    <UiBaseSelect
      v-if="batters.length > 1"
      v-model="batter"
      label="看哪一位打者"
      class="max-w-xs"
      :options="batterOptions"
    />

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
      {{ scoped.length }} 個打席裡有 {{ located.length }} 個記了落點（三振、保送沒有落點）。
      <!--
        ⚠️ 一場比賽一位打者只有三四個打席，而排守備站位要看的是「他平常往哪裡打」。
        不講的話，三個點的圖會被當成那個人的打擊傾向。
      -->
      <template v-if="batter">單場的點數本來就少，排守備站位請參考多場。</template>
    </p>
  </section>
</template>
