<script setup lang="ts">
import { tallyRecord } from '#shared/schemas/game'
import { describeCountdown, daysUntil, formatGameDateLong } from '~/utils/format'

/**
 * 首頁。
 *
 * ## 版面順序是依「進站的人想知道什麼」排的
 * ```
 * ┌─────────────────────────────┐
 * │        滿版主視覺            │  球隊形象
 * ├──────────────┬──────────────┤
 * │  比數         │  近期賽事     │  ← 第一屏就回答完最常被問的兩件事
 * ├──────────────┴──────────────┤
 * │  下一場比賽詳情              │
 * │  最新公告 / 最近戰績 / 簡介   │
 * ```
 * 主視覺與資訊帶放在 `.container-content` 外面，自然貼齊視窗兩側 ——
 * 大色塊要滿版才有氣勢，留白邊會讓它看起來像一張貼在頁面上的圖片。
 */
const today = useToday()

const { data: settings } = await useSiteSettings()
const { data: upcoming } = await useGames({ scope: 'upcoming', limit: 4 })
const { data: recent } = await useGames({ scope: 'past', limit: 3 })
const { data: announcements } = await useAnnouncements({ limit: 3 })

/**
 * 近期比賽的天氣。一次查完所有要顯示的場次，不要一場一個請求。
 * `server: false`，所以首屏不會等氣象署（見 `useGamesWeather`）。
 */
const weatherIds = computed(() => (upcoming.value ?? []).map((game) => game.id))
const { data: weather } = useGamesWeather(weatherIds)

const teamName = computed(() => settings.value?.teamName ?? '')

/**
 * 正在打的那一場。
 *
 * `scope: 'upcoming'` 會把進行中的場次排在最前面（見
 * `server/repositories/games.ts`），但這裡用 `find` 而不是取 `[0]` ——
 * 排序是那一層的決定，首頁不該依賴它。
 */
const liveGame = computed(
  () => (upcoming.value ?? []).find((game) => game.status === 'live') ?? null,
)

/**
 * 還沒開打的場次。
 *
 * 進行中的那一場要從這裡拿掉：它已經佔住左邊的比數區了，再出現在「近期賽事」
 * 或「下一場比賽」裡，等於同一場比賽在第一屏出現兩次，而且旁邊還寫著
 * 「還有 0 天」—— 球都在打了。
 */
const scheduled = computed(() => (upcoming.value ?? []).filter((game) => game.status !== 'live'))

const nextGame = computed(() => scheduled.value[0] ?? null)

/**
 * 要放在比數區的那一場：正在打的優先，否則是最近一場已結束的
 * （列表已由 BFF 依日期新到舊排序，取第一筆即可）。
 */
const scoreGame = computed(() => liveGame.value ?? recent.value?.[0] ?? null)

/** 下一場比賽的天氣。不該顯示的狀態回 null，那一欄就整個不出現。 */
const nextGameWeather = computed(() => {
  const result = nextGame.value ? (weather.value?.[nextGame.value.id] ?? null) : null
  if (!result || result.status === 'no-city' || result.status === 'not-configured') return null
  return result
})

const nextGameCountdown = computed(() =>
  nextGame.value ? describeCountdown(daysUntil(nextGame.value.date, today.value)) : '',
)

/** 近三戰的勝敗摘要，做成「近 3 戰 2 勝 1 敗」這種一眼看得懂的句子。 */
const recentSummary = computed(() => tallyRecord(recent.value ?? []))

useHead({ title: '首頁' })
</script>

<template>
  <div>
    <!-- ══ 主視覺 ═══════════════════════════════════════════════ -->
    <!--
      `hero-glow` 疊一層極淡的品牌色光暈並緩慢飄移（18 秒一個來回）——
      一大塊純深色再怎麼配字都是平的。慢到不會讓人分心，但畫面不再是死的。
      它是 `::after`，不進 DOM，也尊重「減少動態效果」。
    -->
    <section class="hero-glow relative overflow-hidden bg-ink text-white">
      <img
        v-if="settings?.heroImageUrl"
        :src="settings.heroImageUrl"
        alt=""
        class="absolute inset-0 size-full object-cover"
      />
      <div v-else class="field-pattern absolute inset-0" aria-hidden="true" />

      <!-- 由下往上的暗色漸層：不論主視覺是什麼照片，壓在上面的文字都讀得清楚 -->
      <div
        class="absolute inset-0 bg-gradient-to-t from-ink-deep via-ink-deep/65 to-ink-deep/25"
        aria-hidden="true"
      />

      <!-- 內容置中：沒有主視覺照片時，靠左下會讓上方留下一大片空白色塊；
           置中則不論有沒有照片都成立 -->
      <div
        class="container-content relative flex min-h-[22rem] flex-col items-center justify-center py-16 text-center md:min-h-[30rem] md:py-24"
      >
        <p class="text-fluid-sm font-bold tracking-[0.35em] text-accent-400 uppercase">
          Official Site
        </p>
        <!--
          `max-w-full` 不能省：父層是 `flex flex-col items-center`，這會讓子元素的
          寬度變成 max-content —— 長隊名（例如 HG MERCENARIES）不會換行，直接
          撐出視窗右緣。限制最大寬度之後才會在空格處正常折行。
        -->
        <h1
          class="mt-4 max-w-full text-fluid-3xl font-black text-balance break-words leading-[1.05] drop-shadow-lg"
        >
          {{ teamName }}
        </h1>

        <!-- 金色短線：隊徽用金色描邊框住字，這裡用同一個顏色框住標題 -->
        <span class="mt-5 block h-1 w-16 bg-accent-500" aria-hidden="true" />
        <p v-if="settings?.slogan" class="mt-5 max-w-2xl text-fluid-lg text-white/85">
          {{ settings.slogan }}
        </p>

        <div class="mt-9 flex flex-wrap justify-center gap-3">
          <NuxtLink
            to="/schedule"
            class="inline-flex min-h-12 items-center bg-accent-500 px-7 font-bold tracking-wider text-ink-deep transition hover:bg-accent-400"
          >
            近期賽程
          </NuxtLink>
          <NuxtLink
            to="/players"
            class="inline-flex min-h-12 items-center border border-white/50 px-7 font-bold tracking-wider transition hover:bg-white/10"
          >
            球員名單
          </NuxtLink>
        </div>
      </div>
    </section>

    <!-- ══ 比數 ／ 近期賽事 ═══════════════════════════════════ -->
    <HomeScoreBanner
      :score-game="scoreGame"
      :upcoming="scheduled"
      :weather="weather ?? undefined"
      :team-name="teamName"
      :team-logo-url="settings?.logoUrl ?? ''"
    />

    <div class="container-content space-y-16 py-14 md:py-20">
      <!-- ══ 下一場比賽 ═════════════════════════════════════════ -->
      <section v-if="nextGame" aria-labelledby="next-game-heading">
        <CommonSectionHeading
          id="next-game-heading"
          en="NEXT GAME"
          zh="下一場比賽"
          to="/schedule"
        />

        <NuxtLink
          :to="`/games/${nextGame.id}`"
          class="surface-card lift block rounded-xl border border-l-4 border-border border-l-brand-600 bg-surface-raised p-6 md:p-8"
        >
          <div class="flex flex-wrap items-center gap-3">
            <UiBaseBadge tone="brand">{{ nextGameCountdown }}</UiBaseBadge>
            <span v-if="nextGame.league" class="text-fluid-sm text-content-muted">
              {{ nextGame.league }}
            </span>
          </div>

          <!-- 隊徽緊貼對手隊名：放在 vs 前面會看起來像它屬於「vs」而不是對手 -->
          <p class="mt-4 flex flex-wrap items-center gap-3 text-fluid-2xl font-black">
            <span class="text-fluid-lg font-bold text-content-muted">vs</span>
            <CommonTeamCrest
              :name="nextGame.opponent"
              :logo-url="nextGame.opponentLogoUrl"
              size="md"
            />
            {{ nextGame.opponent }}
          </p>

          <dl class="mt-5 grid gap-3 text-fluid-sm sm:grid-cols-3">
            <div>
              <dt class="text-content-muted">日期</dt>
              <dd class="font-semibold">{{ formatGameDateLong(nextGame.date) }}</dd>
            </div>
            <div>
              <dt class="text-content-muted">時間</dt>
              <dd class="font-semibold tabular-nums">{{ nextGame.time }}</dd>
            </div>
            <div>
              <dt class="text-content-muted">地點</dt>
              <dd class="font-semibold">
                {{ nextGame.venue || '未定' }}
                <span class="font-normal text-content-muted">
                  （{{ nextGame.homeAway === 'home' ? '主場' : '客場' }}）
                </span>
              </dd>
            </div>
            <div v-if="nextGameWeather">
              <dt class="text-content-muted">當天天氣</dt>
              <dd class="font-semibold">
                <GameWeather :weather="nextGameWeather" />
              </dd>
            </div>
          </dl>
        </NuxtLink>
      </section>

      <!-- ══ 最新公告 ═══════════════════════════════════════════ -->
      <section v-if="announcements?.length" aria-labelledby="news-heading">
        <CommonSectionHeading id="news-heading" en="NEWS" zh="最新公告" to="/news" />

        <div class="grid gap-5 md:grid-cols-3">
          <NewsAnnouncementCard
            v-for="(announcement, index) in announcements"
            :key="announcement.id"
            :announcement="announcement"
            :delay="index * 90"
          />
        </div>
      </section>

      <!-- ══ 最近戰績 ═══════════════════════════════════════════ -->
      <section v-if="recent?.length" aria-labelledby="recent-heading">
        <CommonSectionHeading id="recent-heading" en="RESULTS" zh="最近戰績" to="/results" />

        <p class="mb-4 text-fluid-sm text-content-muted">
          近 {{ recentSummary.total }} 戰
          <strong class="text-accent-700 dark:text-accent-400">{{ recentSummary.win }} 勝</strong>
          <strong class="ml-2 text-danger">{{ recentSummary.loss }} 敗</strong>
          <strong v-if="recentSummary.tie" class="ml-2">{{ recentSummary.tie }} 和</strong>
        </p>

        <div class="grid gap-4 md:grid-cols-3">
          <!-- 依序浮現。`v-reveal` 預設可見，JS 沒跑內容照樣在（見 plugins/reveal.ts） -->
          <GameCard
            v-for="(game, index) in recent"
            :key="game.id"
            v-reveal="(index % 3) * 80"
            class="reveal"
            :game="game"
            :our-name="teamName"
            :today="today"
          />
        </div>
      </section>

      <!-- ══ 球隊簡介 ═══════════════════════════════════════════ -->
      <section v-if="settings?.intro" aria-labelledby="about-heading">
        <CommonSectionHeading id="about-heading" en="ABOUT" :zh="`關於${teamName}`" />

        <div class="border border-border bg-surface-raised p-6 shadow-sm md:p-8">
          <p class="whitespace-pre-wrap leading-relaxed text-content-muted">{{ settings.intro }}</p>

          <dl
            class="mt-6 flex flex-wrap gap-x-12 gap-y-4 border-t border-border pt-5 text-fluid-sm"
          >
            <div v-if="settings.foundedYear">
              <dt class="text-content-muted">成立年份</dt>
              <dd class="text-fluid-lg font-bold tabular-nums">{{ settings.foundedYear }}</dd>
            </div>
            <div v-if="settings.homeField">
              <dt class="text-content-muted">主場</dt>
              <dd class="text-fluid-lg font-bold">{{ settings.homeField }}</dd>
            </div>
          </dl>
        </div>
      </section>
    </div>
  </div>
</template>
