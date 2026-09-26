<script setup lang="ts">
import type { AttendanceEntry, LineupEntry, PitcherEntry } from '#shared/schemas/game'
import { POSITION_LABELS } from '#shared/schemas/player'
import { NuxtLink } from '#components'
import { formatGameStamp } from '~/utils/format'

/*
 * `NuxtLink` 用匯入的而不是寫成字串 `'NuxtLink'`。
 *
 * `<component :is="'NuxtLink'">` 靠的是「執行期用名稱把元件查出來」，而那份
 * 註冊表在測試環境裡不一定存在 —— 症狀是連結整個不渲染（`<a>` 變成什麼都沒有），
 * 而且**不會報錯**。直接給元件物件就沒有這層不確定性。
 */

/**
 * 出賽名單圖卡。
 *
 * 轉播單位公布名單時用的那種直式圖卡 —— 一眼看完、適合截圖轉貼到群組。
 * 配色全部取自球隊識別：墨藍底、金色棒次、teal 守位牌、米白姓名牌。
 *
 * 內容分兩段：先發打序與候補。候補沒有棒次也沒有守位，姓名牌因此往右延伸
 * 佔滿整列 —— 不留一個永遠空白的守位欄，兩段的差別一眼就分得出來。
 *
 * ## 為什麼是真的 HTML 而不是產生一張圖
 * 產圖要嘛在伺服器端跑無頭瀏覽器（為了一張圖養一個瀏覽器），要嘛在前端用
 * canvas 重畫一次版面（等於維護兩套排版）。用 HTML 排出來的好處是：
 * 名字長度、人數多寡、深淺色模式、手機寬度全部自動處理，改一次就好，
 * 而且使用者照樣可以截圖。
 *
 * ## 這是唯一的呈現方式，所以語意必須完整
 * 早期版本旁邊還有一份表格，圖卡只是它的視覺版本（標了 `aria-hidden`）。
 * 表格拿掉之後，這張卡就得自己撐起全部的語意：
 *
 * - 名單是 `<ul>`／`<li>`，螢幕閱讀器會報出「共 N 項」
 * - 有 `playerId` 的球員做成連結，點得進個人頁（臨時支援的球友沒有 ID，只顯示姓名）
 * - 守位視覺上是縮寫（`2B`），但同時藏一份中文全名給輔助科技 ——
 *   螢幕閱讀器把 `2B` 念成「二 B」對聽的人毫無意義
 *
 * 換句話說**不能再把 `aria-hidden` 加回來**。
 *
 * ## 這張卡上不放賽後的成績
 * 先發投手只顯示名字與背號，**不顯示投手紀錄的 `note`**（「6 局 2 失分」）。
 * 打擊紀錄同理，完全不出現在這裡。
 *
 * 這是一張**賽前**的名單：排出來是為了讓大家知道今天誰上場、幾點在哪裡打，
 * 而且它會在賽前就被截圖丟進群組。賽後才寫得出來的成績混進來之後，
 * 同一張卡在不同時間點長得不一樣 —— 看到舊截圖的人會以為名單改過。
 *
 * 成績要看就去單場比賽頁的「本場紀錄」，那裡投打分開列，而且不必截圖。
 *
 * ## 字體
 * 棒次、背號、守位縮寫的窄黑體來自**全站的預設字體**（`main.css` 的 body
 * 規則），這裡不需要、也刻意不再重複標 `font-display`。Oswald 只涵蓋 latin，
 * 中文自動落回系統黑體，所以 `#97 陳育廷` 混排不必拆成兩個 span。
 */
const props = withDefaults(
  defineProps<{
    entries: LineupEntry[]
    /** 候補：確定出席但不在先發打序上的人。由 `deriveBench()` 推導。 */
    bench?: AttendanceEntry[]
    teamName: string
    teamLogoUrl?: string
    opponent: string
    opponentLogoUrl?: string
    /** `YYYY-MM-DD` */
    date: string
    time: string
    /** 比賽地點。截圖流出去之後，「在哪裡打」和「幾點打」一樣重要。 */
    venue?: string
    pitchers?: PitcherEntry[]
  }>(),
  { bench: () => [], teamLogoUrl: '', opponentLogoUrl: '', venue: '', pitchers: () => [] },
)

/**
 * 先發投手。獨立成一段，不管他有沒有排在打序上。
 *
 * 早期版本只在「投手不在打序裡」時才列出來（照抄指定打擊制的轉播圖卡）。
 * 但業餘棒球多半沒有 DH，投手自己也要打擊 —— 於是最該被看到的那個資訊
 * 剛好在最常見的情況下消失了。打序裡的守位雖然會標 `P`，那是「第幾棒守投手」，
 * 和「今天誰先發」不是同一件事，而且要一列一列找。
 *
 * ⚠️ **只取名字與背號，`note` 不放上來** —— 見下面那一段。
 */
const startingPitcher = computed(
  () => props.pitchers.find((pitcher) => pitcher.role === 'starter') ?? null,
)

/** `#7 張志豪`；沒有背號就只有名字，不留一個孤零零的井字號。 */
function displayName(person: { number?: string; name: string }): string {
  return person.number ? `#${person.number} ${person.name}` : person.name
}

/*
 * 分享。
 *
 * 按鈕刻意放在 `cardRef` **外面** —— 它在圖片裡沒有意義，而且截到一顆
 * 「分享」按鈕看起來就像截圖截壞了。用 `filter` 排除也可以，但把它放在
 * 被截的節點之外更直接，不會有「以後改版忘了更新 filter」的風險。
 */
const cardRef = ref<HTMLElement | null>(null)
const { busy, message: shareMessage, downloadImage, shareImage } = useShareRoster()

const filename = computed(() => `${props.teamName}-vs-${props.opponent}-${props.date}.png`)

/**
 * 下載與分享分成兩顆按鈕。
 *
 * 讓一顆按鈕自己判斷「能分享就分享、不能就下載」看似聰明，實際上使用者
 * 按下去之前不知道會發生什麼 —— 想存檔的人被叫出分享選單，想貼到群組的人
 * 拿到一個檔案。兩個明確的動作比一個猜心思的按鈕好。
 */
function onDownload() {
  return downloadImage({ node: cardRef.value, filename: filename.value })
}

function onShare() {
  return shareImage({
    node: cardRef.value,
    filename: filename.value,
    title: `${props.teamName} vs ${props.opponent} 出賽名單`,
    text: `${formatGameStamp(props.date, props.time)} — ${props.teamName} vs ${props.opponent}`,
  })
}
</script>

<template>
  <div>
    <!--
      底色是墨藍家族的對角漸層（`ink-soft → ink → ink-deep`），不是單一色塊。
      一整片純色在這個尺寸會顯得很平，而深色介面沒辦法靠陰影做層次
      （見 `main.css` 的 `.surface-card`）—— 漸層是深色底最直接的立體感來源。
      色相全部維持在 250～255，所以看起來仍然是同一個顏色，只是有光從左上來。
    -->
    <div
      ref="cardRef"
      class="relative isolate overflow-hidden rounded-2xl bg-gradient-to-br from-ink-soft via-ink to-ink-deep text-white shadow-lg"
    >
      <!-- 球場紋理。純裝飾，要對輔助科技隱藏 -->
      <div class="field-pattern absolute inset-0" aria-hidden="true" />

      <div class="relative flex">
        <!--
        左側直書標題。`writing-mode` 讓中文自然由上往下排。
      -->
        <div
          class="flex shrink-0 items-center justify-center bg-accent-500 px-1.5 py-6 text-ink-deep sm:px-2.5"
        >
          <p class="[writing-mode:vertical-rl] text-fluid-lg font-black tracking-[0.2em]">
            出賽名單
            <span class="ml-1 text-xs font-bold tracking-[0.3em] opacity-70"> GAME ROSTER </span>
          </p>
        </div>

        <div class="min-w-0 flex-1 p-3 sm:p-5">
          <!-- ══ 隊名列 ══════════════════════════════════════════ -->
          <!--
          隊名列用 `CommonTeamLogo` 而不是 `CommonTeamCrest`：我隊的識別圖多半是
          橫式字標，塞進圓形容器再 contain 會縮到只剩容器的三分之一高。
          TeamLogo 是固定高度、寬度自適應，字標與方形徽章都撐得起來。
        -->
          <div class="mb-3 flex items-center gap-3 rounded-lg bg-white/95 px-3 py-2 text-ink-deep">
            <CommonTeamLogo :name="teamName" :logo-url="teamLogoUrl" size="sm" />
            <p class="min-w-0 truncate text-fluid-lg font-black tracking-wide">{{ teamName }}</p>
          </div>

          <!-- ══ 先發打序 ════════════════════════════════════════ -->
          <p class="mb-2 text-fluid-sm font-bold tracking-wide text-accent-400">
            <span aria-hidden="true">▤</span>
            先發打序
            <span class="tracking-[0.15em] opacity-70">(STARTING LINEUP)</span>
          </p>

          <ul class="space-y-1.5">
            <li
              v-for="entry in entries"
              :key="entry.order"
              class="grid grid-cols-[1.75rem_minmax(0,1fr)_2.5rem] items-stretch gap-1.5 sm:grid-cols-[2.25rem_minmax(0,1fr)_3rem]"
            >
              <!-- 棒次：窄黑體、金色，整張卡最先被看到的東西 -->
              <span
                class="flex items-center justify-center text-fluid-xl leading-none font-bold tabular-nums text-accent-400"
              >
                {{ entry.order }}
              </span>

              <!-- 名牌。左緣一道金條是「這是打序上的人」的視覺記號 -->
              <component
                :is="entry.playerId ? NuxtLink : 'span'"
                :to="entry.playerId ? `/players/${entry.playerId}` : undefined"
                class="flex min-w-0 items-center justify-center rounded-lg border-l-4 border-l-accent-500/70 bg-white/95 px-2.5 py-1.5 text-ink-deep transition hover:bg-white"
              >
                <span class="min-w-0 truncate text-center text-fluid-base font-bold">
                  {{ displayName(entry) }}
                </span>
              </component>

              <!--
                守位。視覺上是縮寫、念出來是中文全名 ——
                螢幕閱讀器把 `2B` 念成「二 B」對聽的人完全沒有意義。
              -->
              <span
                class="flex items-center justify-center rounded-lg bg-brand-700 text-fluid-sm font-bold tracking-wide shadow-[inset_0_1px_0_oklch(1_0_0/0.15)]"
                :title="POSITION_LABELS[entry.position]"
              >
                <span aria-hidden="true">{{ entry.position }}</span>
                <span class="sr-only">{{ POSITION_LABELS[entry.position] }}</span>
              </span>
            </li>
          </ul>

          <!-- ══ 先發投手 ════════════════════════════════════════ -->
          <!--
            自成一段而不是接在打序後面：他有沒有排打序是另一回事，
            而「今天誰先發」是這張卡上最常被問的一件事，值得一個標題。
          -->
          <template v-if="startingPitcher">
            <div class="mt-4 mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <p class="text-fluid-sm font-bold tracking-wide text-accent-400">
                <span aria-hidden="true">◈</span>
                先發投手
                <span class="tracking-[0.15em] opacity-70">(STARTING PITCHER)</span>
              </p>
            </div>

            <div
              class="grid grid-cols-[minmax(0,1fr)_2.5rem] items-stretch gap-1.5 sm:grid-cols-[minmax(0,1fr)_3rem]"
            >
              <component
                :is="startingPitcher.playerId ? NuxtLink : 'span'"
                :to="startingPitcher.playerId ? `/players/${startingPitcher.playerId}` : undefined"
                class="flex min-w-0 flex-col items-center justify-center rounded-lg border-l-4 border-l-accent-500 bg-white/95 px-3 py-2 text-center text-ink-deep transition hover:bg-white"
              >
                <!--
                  ⚠️ 只有名字，**不顯示投手紀錄的 `note`**（「6 局 2 失分」那種）。
                  理由見 `<script>` 開頭的「這張卡上不放賽後的成績」。
                -->
                <span class="min-w-0 max-w-full truncate text-fluid-lg font-bold">
                  {{ displayName(startingPitcher) }}
                </span>
              </component>

              <span
                class="flex items-center justify-center rounded-lg bg-accent-500 text-fluid-base font-bold tracking-wide text-ink-deep"
                title="先發投手"
              >
                <span aria-hidden="true">SP</span>
                <span class="sr-only">先發投手</span>
              </span>
            </div>
          </template>

          <!-- ══ 候補 ════════════════════════════════════════════ -->
          <template v-if="bench.length">
            <p class="mt-4 mb-2 text-fluid-sm font-bold tracking-wide text-accent-400">
              <span aria-hidden="true">▤</span>
              候補
              <span class="tracking-[0.15em] opacity-70">(BENCH)</span>
            </p>

            <ul class="space-y-1.5">
              <li
                v-for="person in bench"
                :key="person.playerId || person.name"
                class="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-1.5 sm:grid-cols-[2.25rem_minmax(0,1fr)]"
              >
                <span />
                <!-- 沒有棒次也沒有守位，名牌就佔到底。底色淡一階，與先發區分開 -->
                <component
                  :is="person.playerId ? NuxtLink : 'span'"
                  :to="person.playerId ? `/players/${person.playerId}` : undefined"
                  class="flex min-w-0 items-center justify-center rounded-lg border-l-4 border-l-white/40 bg-white/75 px-2.5 py-1.5 text-ink-deep transition hover:bg-white"
                >
                  <span class="min-w-0 truncate text-center text-fluid-base font-bold">
                    {{ displayName(person) }}
                  </span>
                </component>
              </li>
            </ul>
          </template>

          <!-- ══ 日期與對手 ══════════════════════════════════════ -->
          <div
            class="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/15 pt-3"
          >
            <p class="min-w-0 text-fluid-sm font-bold">
              <span class="tabular-nums">{{ formatGameStamp(date, time) }}</span>
              <span v-if="venue" class="text-accent-400">・{{ venue }}</span>
            </p>
            <p class="flex items-center gap-2 text-fluid-sm font-bold">
              <span class="tracking-[0.15em] text-white/60">VS</span>
              <CommonTeamCrest
                :name="opponent"
                :logo-url="opponentLogoUrl"
                size="sm"
                on-dark
                class="!size-8 !text-sm"
              />
              <span class="truncate">{{ opponent }}</span>
            </p>
          </div>
        </div>
      </div>
    </div>

    <div class="mt-3 flex flex-wrap items-center gap-2">
      <button
        type="button"
        class="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border px-4 text-fluid-sm font-semibold transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="busy !== null"
        @click="onDownload"
      >
        <svg class="size-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path
            d="M12 3a1 1 0 0 1 1 1v9.6l3.3-3.3a1 1 0 1 1 1.4 1.4l-5 5a1 1 0 0 1-1.4 0l-5-5a1 1 0 1 1 1.4-1.4l3.3 3.3V4a1 1 0 0 1 1-1Zm-7 15a1 1 0 0 1 1 1h12a1 1 0 1 1 0 2H6a2 2 0 0 1-2-2 1 1 0 0 1 1-1Z"
          />
        </svg>
        {{ busy === 'download' ? '產生圖片中…' : '下載圖片' }}
      </button>

      <button
        type="button"
        class="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border px-4 text-fluid-sm font-semibold transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="busy !== null"
        @click="onShare"
      >
        <svg class="size-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path
            d="M18 16a3 3 0 0 0-2.3 1.1l-6-3.1a3 3 0 0 0 0-1.9l6-3.1a3 3 0 1 0-.9-1.8l-6 3.1a3 3 0 1 0 0 5.4l6 3.1A3 3 0 1 0 18 16Z"
          />
        </svg>
        {{ busy === 'share' ? '產生圖片中…' : '分享' }}
      </button>

      <!-- aria-live：結果是按下之後才出現的，螢幕閱讀器需要被告知 -->
      <p v-if="shareMessage" class="text-fluid-sm text-content-muted" aria-live="polite">
        {{ shareMessage }}
      </p>
    </div>
  </div>
</template>
