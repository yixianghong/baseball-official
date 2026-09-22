<script setup lang="ts">
import type { WeatherResult } from '#shared/schemas/weather'
import { FORECAST_HORIZON_DAYS } from '#shared/schemas/weather'

/**
 * 比賽當天的天氣預報。
 *
 * ## 三種密度，同一份資料
 * ```
 * inline  主視覺的資訊列    天氣現象 + 溫度 +（雨機率高時）提醒
 * mini    首頁的賽程小卡    只有溫度，位置窄到放不下別的
 * block   獨立區塊（備用）  帶標題與資料來源
 * ```
 * 拆成三個元件會讓「哪些狀態要顯示、怎麼措辭」散在三個地方，遲早不一致。
 *
 * ## 每一種「沒有資料」都要講得出原因
 * 查不到的原因不只一種，而且最常見的那種（賽程排在一週以後）**完全正常**。
 * 全部塌成「查無資料」等於沒說，使用者會以為壞了。
 *
 * 但空間不夠時（`mini`）只能取捨：沒有資料就整塊不顯示，
 * 在一張 130px 寬的小卡上塞一句解釋，反而把真正的資訊擠掉。
 */
const props = withDefaults(
  defineProps<{
    weather: WeatherResult | null
    pending?: boolean
    variant?: 'inline' | 'mini' | 'block'
  }>(),
  { variant: 'inline' },
)

const forecast = computed(() => (props.weather?.status === 'ok' ? props.weather.forecast : null))

/** 沒有指定縣市、或站台沒設定授權碼 —— 那是設定問題，不該讓訪客看到。 */
const hidden = computed(
  () =>
    props.weather?.status === 'no-city' ||
    props.weather?.status === 'not-configured' ||
    // 小卡只有空間放結果，沒有結果就不佔位
    (props.variant === 'mini' && !forecast.value),
)

/** 降雨機率到多少該提醒帶傘。氣象署的用語是「有機會降雨」，30% 是常見的分界。 */
const RAIN_ALERT = 30

const rainy = computed(
  () => forecast.value?.rainChance !== null && (forecast.value?.rainChance ?? 0) >= RAIN_ALERT,
)

const temperature = computed(() =>
  forecast.value ? `${forecast.value.minTemp}–${forecast.value.maxTemp}°C` : '',
)
</script>

<template>
  <!-- ══ 小卡：只有溫度 ═══════════════════════════════════════ -->
  <p
    v-if="!hidden && variant === 'mini'"
    class="text-xs tabular-nums"
    :class="rainy ? 'text-warning' : 'text-content-muted'"
  >
    <span v-if="rainy" aria-hidden="true" class="mr-0.5">☂</span>
    {{ temperature }}
  </p>

  <!-- ══ 行內：主視覺的資訊列 ═════════════════════════════════ -->
  <template v-else-if="!hidden && variant === 'inline'">
    <span v-if="pending" class="opacity-60">查詢中…</span>

    <template v-else-if="forecast">
      {{ forecast.description }}
      <span class="tabular-nums">{{ temperature }}</span>
      <span v-if="rainy" class="ml-1 whitespace-nowrap text-warning">
        <span aria-hidden="true">☂</span> 降雨 {{ forecast.rainChance }}%
      </span>
    </template>

    <!-- 排在一週以後是最常見的情況，而且完全正常，語氣不要像出錯 -->
    <span v-else-if="weather?.status === 'out-of-range'" class="opacity-70">
      預報只到 {{ FORECAST_HORIZON_DAYS }} 天後
    </span>
    <span v-else class="opacity-70">暫時查不到</span>
  </template>

  <!-- ══ 獨立區塊 ═════════════════════════════════════════════ -->
  <div
    v-else-if="!hidden"
    class="surface-card rounded-xl border border-border bg-surface-raised p-4"
  >
    <p class="mb-2 text-fluid-sm font-semibold">當天天氣</p>

    <UiBaseSpinner v-if="pending" label="查詢天氣中…" />

    <template v-else-if="forecast">
      <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p class="text-fluid-lg font-bold">{{ forecast.description }}</p>
        <p class="text-fluid-lg font-bold tabular-nums">{{ temperature }}</p>
      </div>
      <p v-if="rainy" class="mt-1 text-fluid-sm text-warning">
        降雨機率 {{ forecast.rainChance }}%，記得帶傘
      </p>
      <p class="mt-2 text-xs text-content-muted">{{ forecast.city }}．資料來源：中央氣象署</p>
    </template>

    <p v-else-if="weather?.status === 'out-of-range'" class="text-fluid-sm text-content-muted">
      氣象署的預報只到 {{ FORECAST_HORIZON_DAYS }} 天後，比賽接近時再回來看。
    </p>
    <p v-else class="text-fluid-sm text-content-muted">暫時查不到天氣預報，請稍後再試。</p>
  </div>
</template>
