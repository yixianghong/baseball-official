<script setup lang="ts">
import type { Game } from '#shared/schemas/game'
import type { WeatherMap } from '#shared/schemas/weather'
import { GAME_STATUS_LABELS, isNotPlayed } from '#shared/schemas/game'
import { formatGameDate } from '~/utils/format'

/**
 * 首頁主視覺下方的資訊帶：最新比數 ＋ 近期賽事。
 *
 * ## 為什麼把這兩件事放在同一條帶子上
 * 球迷與隊員進官網最想知道的就是這兩件事：上一場打成怎樣、下一場什麼時候。
 * 把它們壓在主視覺下緣、用實心色塊撐住，等於在畫面第一屏就回答完 ——
 * 不需要捲動，也不需要點進任何頁面。
 *
 * ## 排列順序跟著主客場走
 * 比分左右兩側的球隊依 `homeAway` 決定：我隊是客場（先攻）就排左邊。
 * 這與計分板的上下半局是同一個慣例（見 `GameScoreboard.vue`），
 * 兩處若不一致，看得懂棒球的人一眼就會覺得怪。
 */
const props = defineProps<{
  /** 最近一場已結束的比賽。沒有比賽紀錄時傳 null。 */
  lastGame: Game | null
  /** 接下來的場次，最多顯示三場。 */
  upcoming: Game[]
  /** 比賽 id → 天氣。查不到的場次不會有這一筆，小卡就不顯示溫度。 */
  weather?: WeatherMap
  teamName: string
  teamLogoUrl: string
}>()

/** 比分兩側的球隊。客場（先攻）時我隊在左。 */
const sides = computed(() => {
  const game = props.lastGame
  if (!game) return null

  const ours = {
    name: props.teamName,
    logoUrl: props.teamLogoUrl,
    score: game.scoreboard.totals.our.r,
    isOurs: true,
  }
  const theirs = {
    name: game.opponent,
    logoUrl: game.opponentLogoUrl,
    score: game.scoreboard.totals.opponent.r,
    isOurs: false,
  }

  return game.homeAway === 'home' ? [theirs, ours] : [ours, theirs]
})

/**
 * 沒有打成的場次（延賽、取消）。
 *
 * 這種場次的計分板是空的，總分兩邊都是 0 —— 直接顯示就變成「0 0」，
 * 看起來像打完了而且是和局。必須把狀態寫出來，而不是讓比數代替它說話。
 */
const notPlayed = computed(() => (props.lastGame ? isNotPlayed(props.lastGame) : false))

/** 延賽是「出事了」，取消則是中性的結束 —— 與後台列表用同一套語彙。 */
const statusTone = computed(() =>
  props.lastGame?.status === 'postponed' ? ('warning' as const) : ('neutral' as const),
)

const nextGames = computed(() => props.upcoming.slice(0, 3))

/**
 * 欄數跟著場次數量走，避免只有一兩場時右側留下空格。
 *
 * 完整的 class 名稱要寫死在原始碼裡 —— Tailwind 是靜態掃描原始碼來決定要產生
 * 哪些 utility 的，`sm:${變數}` 這種在執行期才拼出來的字串它看不到，
 * 對應的 CSS 就不會被產生。
 */
const columnsClass = computed(() => {
  if (nextGames.value.length === 1) return 'sm:grid-cols-1'
  if (nextGames.value.length === 2) return 'sm:grid-cols-2'
  return 'sm:grid-cols-3'
})
</script>

<template>
  <section class="bg-ink text-white" aria-label="最新比數與近期賽事">
    <!--
      明確寫出 `grid-cols-1`：沒有指定 grid-template-columns 時，隱含欄位的寬度是
      `auto`，會被內容的 max-content 撐開而溢出容器。Tailwind 的 grid-cols-* 產生的
      是 `minmax(0, 1fr)`，才會乖乖收在容器寬度內。
    -->
    <div class="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <!--
        ══ 最新比數 ══
        `min-w-0` 不能省：grid item 的 min-width 預設是 `auto`，內容比軌道寬時
        item 會直接溢出軌道 —— 軌道用 `minmax(0, 1fr)` 只約束軌道自己，管不到 item。
      -->
      <div class="flex min-w-0 flex-col justify-center gap-5 px-5 py-8 md:px-10">
        <template v-if="lastGame && sides">
          <!--
            手機上「隊徽 比分 標題 比分 隊徽」五個元素排成一行會超出 390px，
            所以標題與日期在小螢幕改放到上方，下面那行只留隊徽與比分。
            桌機維持單行，標題夾在兩個比分中間（與參考版面一致）。
          -->
          <div class="text-center sm:hidden">
            <p class="text-fluid-sm font-bold tracking-widest">LAST SCORE</p>
            <p class="text-xs text-white/70">最新比數</p>
            <p class="mt-0.5 text-xs tabular-nums text-white/70">
              {{ formatGameDate(lastGame.date) }}
              <span class="ml-1 underline decoration-white/40 underline-offset-4">
                {{ lastGame.time }}
              </span>
            </p>
          </div>

          <div class="flex items-center justify-center gap-3 sm:gap-4 md:gap-8">
            <!-- 左隊 -->
            <div class="flex min-w-0 flex-col items-center gap-2">
              <CommonTeamCrest
                :name="sides[0]!.name"
                :logo-url="sides[0]!.logoUrl"
                size="hero"
                on-dark
              />
              <span
                class="line-clamp-1 max-w-20 text-center text-xs text-white/80 sm:max-w-28 sm:text-fluid-sm"
              >
                {{ sides[0]!.name }}
              </span>
            </div>

            <!-- 比分與標題 -->
            <div class="flex items-center gap-2 sm:gap-4 md:gap-6">
              <template v-if="!notPlayed">
                <span
                  class="text-3xl font-black tabular-nums sm:text-5xl md:text-6xl"
                  :class="sides[0]!.isOurs ? '' : 'text-white/75'"
                >
                  {{ sides[0]!.score }}
                </span>

                <!--
                  冒號只在手機出現。桌機的標題塊就夾在兩個比分中間，
                  本身就是分隔；手機把標題移到上方之後，兩個數字之間
                  只剩一個空隙 —— 看起來像「0 0」而不是「0 比 0」。
                -->
                <span class="text-3xl font-black text-white/50 sm:hidden" aria-hidden="true"
                  >:</span
                >
              </template>

              <!--
                沒打成的場次要把狀態寫出來，所以這一塊在手機上也要顯示
                （平常它是 `hidden sm:block`，標題另外排在上方）。
              -->
              <div class="text-center" :class="notPlayed ? '' : 'hidden sm:block'">
                <div class="hidden sm:block">
                  <p class="text-fluid-lg font-bold tracking-widest">LAST SCORE</p>
                  <p class="text-fluid-sm text-white/70">最新比數</p>
                  <p class="mt-1 text-fluid-sm tabular-nums text-white/70">
                    {{ formatGameDate(lastGame.date) }}
                    <span class="ml-1 underline decoration-white/40 underline-offset-4">
                      {{ lastGame.time }}
                    </span>
                  </p>
                </div>

                <UiBaseBadge v-if="notPlayed" :tone="statusTone" class="sm:mt-2">
                  {{ GAME_STATUS_LABELS[lastGame.status] }}
                </UiBaseBadge>
              </div>

              <span
                v-if="!notPlayed"
                class="text-3xl font-black tabular-nums sm:text-5xl md:text-6xl"
                :class="sides[1]!.isOurs ? '' : 'text-white/75'"
              >
                {{ sides[1]!.score }}
              </span>
            </div>

            <!-- 右隊 -->
            <div class="flex min-w-0 flex-col items-center gap-2">
              <CommonTeamCrest
                :name="sides[1]!.name"
                :logo-url="sides[1]!.logoUrl"
                size="hero"
                on-dark
              />
              <span
                class="line-clamp-1 max-w-20 text-center text-xs text-white/80 sm:max-w-28 sm:text-fluid-sm"
              >
                {{ sides[1]!.name }}
              </span>
            </div>
          </div>

          <!-- 按鈕跨滿整個左區：對齊上方的比分區塊，形成一個完整的色塊單位 -->
          <NuxtLink
            :to="`/games/${lastGame.id}`"
            class="flex min-h-12 w-full items-center justify-center bg-brand-600 px-6 font-bold tracking-wider transition hover:bg-brand-500"
          >
            賽事<span class="ml-1 font-normal">詳情</span>
          </NuxtLink>
        </template>

        <!-- 還沒有任何比賽紀錄時，這一格不該留白 -->
        <div v-else class="py-6 text-center">
          <p class="text-fluid-lg font-bold tracking-widest">LAST SCORE</p>
          <p class="text-fluid-sm text-white/70">最新比數</p>
          <p class="mt-3 text-white/60">還沒有比賽紀錄</p>
        </div>
      </div>

      <!-- ══ 近期賽事 ══════════════════════════════════════════ -->
      <div class="flex min-w-0 flex-col bg-ink-soft sm:flex-row lg:border-l lg:border-white/10">
        <!-- 側欄要夠寬，「NEXT ON」與按鈕文字才不會被擠成兩行 —— 標題斷行會讓
             整條資訊帶看起來像壞掉的版面，所以這裡明確禁止換行 -->
        <div class="flex shrink-0 flex-col justify-center gap-3 px-5 py-6 sm:w-48 md:px-7">
          <div>
            <p class="text-fluid-lg font-bold tracking-widest whitespace-nowrap">NEXT ON</p>
            <p class="text-fluid-sm text-white/70">近期賽事</p>
          </div>
          <NuxtLink
            to="/schedule"
            class="flex min-h-11 w-fit items-center whitespace-nowrap bg-accent-500 px-5 text-fluid-sm font-bold text-ink-deep transition hover:bg-accent-400"
          >
            完整賽程
          </NuxtLink>
        </div>

        <!--
          手機橫向滑動、桌機等分格子。

          手機上把三場塞進 390px 的等分格子，每格只剩一百出頭的寬度，日期與
          場地都得截斷；改成可滑動的卡片列，每張卡片有足夠空間，也是行動裝置上
          很自然的操作。桌機空間夠，就回到等分格子（欄數跟著實際場次走，
          只有兩場時排三欄會空一格，看起來像資料掉了）。
        -->
        <ul
          v-if="nextGames.length"
          class="flex min-w-0 flex-1 snap-x snap-mandatory overflow-x-auto bg-surface-raised text-content sm:grid sm:overflow-visible"
          :class="columnsClass"
        >
          <li
            v-for="game in nextGames"
            :key="game.id"
            class="w-32 shrink-0 snap-start border-l border-border first:border-l-0 sm:w-auto sm:min-w-0"
          >
            <NuxtLink
              :to="`/games/${game.id}`"
              class="flex h-full flex-col items-center justify-center gap-2 px-2 py-6 transition hover:bg-surface-muted"
            >
              <CommonTeamCrest :name="game.opponent" :logo-url="game.opponentLogoUrl" size="sm" />
              <p class="text-center text-fluid-sm font-bold tabular-nums">
                {{ formatGameDate(game.date).split('（')[0] }}
                <span
                  class="ml-0.5 text-xs font-medium text-content-muted underline underline-offset-4"
                >
                  {{ game.time }}
                </span>
              </p>
              <p class="line-clamp-1 text-center text-xs text-content-muted">
                {{ game.venue || game.opponent }}
              </p>
              <!-- 小卡只有溫度：一格寬 128px，塞得下的就這麼多 -->
              <GameWeather :weather="weather?.[game.id] ?? null" variant="mini" />
            </NuxtLink>
          </li>
        </ul>

        <div
          v-else
          class="flex flex-1 items-center justify-center bg-surface-raised px-4 py-8 text-content-muted"
        >
          尚未公布下一場賽程
        </div>
      </div>
    </div>
  </section>
</template>
