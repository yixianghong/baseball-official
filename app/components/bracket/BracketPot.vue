<script setup lang="ts">
import type { Bracket, BetTally, WsBet } from '#shared/schemas/ws-bracket'
import { BET_AMOUNT, payoutPerBet, teamStanding } from '#shared/schemas/ws-bracket'
import { mlbLogo } from '~/utils/mlb-logos'

/**
 * 彩池統計（限期活動，見 `docs/ws-bracket.md`）。
 *
 * 樹狀圖上每一格只擠得下四個頭像，所以「誰押了誰」的完整清單放在這裡。
 * 順序照注數多寡，不是照樹狀圖 —— 這張表要回答的是「現在大家看好誰」。
 *
 * ⚠️ **每個人的頭像下面印名字，樹狀圖上不印。** 樹狀圖的格子小、一格最多
 * 擠四個頭像，加名字會直接爆版（見 `BracketSlot.vue`）；這裡是專門列名單的
 * 地方，而且**同一隊同一人只會出現一次**（規則擋住重複），加名字不會讓
 * 行高暴增。
 *
 * ⚠️ **「押中可分」一定要寫成預估。** 後面每多一注，已經下注的人分到的
 * 就會變少；少了那兩個字，這個數字看起來就像已經談定的獎金。
 *
 * ⚠️ **總額要拆成「彩池」與「隊費」兩行，不能只顯示一個數字。** 一注 $200
 * 裡有一半進球隊隊費、不參與分配 —— 只顯示合計的話，押中的人會拿實際能分到
 * 的錢去對總額，覺得帳對不上。`payoutPerBet()` 算的是 `payoutPool`（扣掉
 * 隊費後的那一半），這裡的文案要老實講清楚錢分去哪裡了。
 *
 * ## 移除也在這裡，不在樹狀圖上
 * 樹狀圖的每一格只擠得下四個頭像（其餘收成「+N」），收起來的那些**點不到**——
 * 而「我的注剛好被收起來」是隨時會發生的。這張表列的是全部的人，所以移除
 * 只開在這裡一個地方，不會有「有時候刪得掉、有時候找不到」的情況。
 */
const props = defineProps<{
  bracket: Bracket
  tally: BetTally
  /** 原始的下注紀錄。移除要的是**單筆的 id**。 */
  bets: WsBet[]
  photos: Record<string, string>
  locked: boolean
  busy: boolean
}>()

const emit = defineEmits<{
  /** `label` 是提示要顯示的文字（誰押了哪一隊）。 */
  remove: [id: string, label: string]
}>()

/**
 * 正在等待確認移除的那一注。兩段式，比照 `AdminDeleteButton` ——
 * 任何人都能移除任何一筆，所以防手滑只剩這一道。
 */
const armed = ref<string | null>(null)
let armedTimer: ReturnType<typeof setTimeout> | undefined

/**
 * 某個人押某一隊的那一筆。
 *
 * ⚠️ **一定只找得到一筆**，不必再挑「哪一筆」——「同一隊同一人只能押一注」
 * 是安全規則擋住的（見 `database.rules.json`），這裡直接找第一筆命中的即可。
 */
function betIdFor(playerId: string, team: string): string | null {
  return props.bets.find((b) => b.playerId === playerId && b.team === team)?.id ?? null
}

function press(playerId: string, playerName: string, team: string, teamName: string) {
  const id = betIdFor(playerId, team)
  if (!id) return

  if (armed.value !== id) {
    armed.value = id
    // 五秒沒有動作就還原，不要讓一個「等待確認」的紅框一直留在畫面上
    clearTimeout(armedTimer)
    armedTimer = setTimeout(() => (armed.value = null), 5000)
    return
  }

  clearTimeout(armedTimer)
  armed.value = null
  emit('remove', id, `${playerName} 押 ${teamName} 的一注`)
}

onUnmounted(() => clearTimeout(armedTimer))

const rows = computed(() =>
  props.bracket.contenders
    .map((team) => ({
      team,
      standing: teamStanding(props.bracket, team.code),
      tally: props.tally.byTeam[team.code],
      payout: payoutPerBet(props.tally, team.code),
    }))
    .sort((a, b) => (b.tally?.count ?? 0) - (a.tally?.count ?? 0)),
)

const money = (n: number) => `$${n.toLocaleString('zh-Hant-TW')}`
</script>

<template>
  <section class="surface-card overflow-hidden rounded-2xl">
    <header class="flex flex-wrap items-baseline justify-between gap-3 border-b border-border p-5">
      <div>
        <h2 class="text-fluid-lg font-black">目前的彩池</h2>
        <!--
          ⚠️ 這一行只在「還能移除」的時候出現。鎖盤之後留著它，使用者會一直
          去點那些頭像，然後以為自己點錯了地方。
        -->
        <p v-if="!locked && tally.totalCount" class="mt-0.5 text-fluid-sm text-content-muted">
          點頭像可以移除那一注（要按兩下確認）
        </p>
      </div>
      <div class="text-right text-fluid-sm text-content-muted">
        <p>
          共 <span class="font-bold text-content">{{ tally.totalCount }}</span> 注 · 一注
          {{ money(BET_AMOUNT) }} · 總額
          <span class="font-bold text-content">{{ money(tally.pot) }}</span>
        </p>
        <!--
          隊費另起一行，不塞進上面那句 —— 上面那句是「錢從哪裡來」，這一句是
          「錢去了哪裡」，混在一起會變成一長串誰都不想細讀的數字。
        -->
        <p v-if="tally.totalCount">
          其中隊費 {{ money(tally.duesTotal) }} · 可分彩池
          <span class="font-bold text-content">{{ money(tally.payoutPool) }}</span>
        </p>
      </div>
    </header>

    <ul class="divide-y divide-border">
      <li
        v-for="row in rows"
        :key="row.team.code"
        class="flex flex-col gap-2 p-4"
        :class="row.standing === 'eliminated' ? 'opacity-50' : ''"
      >
        <!--
          ⚠️ 隊伍資訊獨立一整列，不跟頭像列擠在同一個 flex-wrap 裡。

          原本是三個 flex item（圖示、`min-w-0 flex-1` 的隊伍資訊、頭像列）
          塞在同一個 `flex flex-wrap` 容器裡，想說寬度不夠會自動換行 ——
          但 `min-w-0` 拿掉的正是瀏覽器判斷「該不該換行」用的內容最小寬度，
          所以視窗變窄時瀏覽器選擇把隊伍資訊**壓扁到只剩幾個字寬**（「紐約
          洋基」被逼得一個字一行），而不是把頭像列擠到下一行。手機寬度下
          最明顯。現在拆成兩層：這一列固定佔滿整個寬度，頭像永遠在它下面
          另起一列，兩邊都不會再互相搶寬度。
        -->
        <div class="flex items-center gap-4">
          <img
            v-if="mlbLogo(row.team.code)"
            :src="mlbLogo(row.team.code)!"
            :alt="''"
            class="size-9 shrink-0 rounded-full object-contain"
            :class="row.standing === 'eliminated' ? 'grayscale' : ''"
          />

          <div class="min-w-0 flex-1">
            <p class="flex items-center gap-2 font-bold">
              <span :class="row.standing === 'eliminated' ? 'line-through' : ''">
                {{ row.team.name }}
              </span>
              <UiBaseBadge v-if="row.standing === 'champion'" tone="accent">冠軍</UiBaseBadge>
              <UiBaseBadge v-else-if="row.standing === 'eliminated'">已淘汰</UiBaseBadge>
            </p>
            <p class="text-fluid-sm text-content-muted">
              <template v-if="row.tally?.count">
                {{ row.tally.count }} 注 · {{ money(row.tally.amount) }} ·
                <template v-if="row.standing === 'champion'">
                  每注可分 <span class="font-bold text-content">{{ money(row.payout) }}</span>
                </template>
                <template v-else>押中預估每注 {{ money(row.payout) }}</template>
              </template>
              <template v-else>還沒有人押</template>
            </p>
          </div>
        </div>

        <!--
          每個人一欄：頭像在上、名字在下（`w-12 truncate` 避免長名字撐開整排）。
          ⚠️ 這是跟樹狀圖唯一不一樣的地方，見上面元件說明。
        -->
        <ul v-if="row.tally?.bettors.length" class="flex flex-wrap gap-x-2 gap-y-1">
          <li v-for="bettor in row.tally.bettors" :key="bettor.playerId" class="w-12">
            <!--
              鎖盤之後換成不是按鈕的 <div>：一個點得下去卻什麼都不會發生的
              頭像，比一個明顯不能點的頭像更讓人困惑。
            -->
            <div v-if="locked" class="flex flex-col items-center gap-0.5">
              <BracketAvatar
                :name="bettor.name"
                :number="bettor.number"
                :photo-url="photos[bettor.playerId] ?? ''"
                size="sm"
              />
              <span
                class="w-full truncate text-center text-[10px] leading-tight text-content-muted"
              >
                {{ bettor.name }}
              </span>
            </div>

            <button
              v-else
              type="button"
              :disabled="busy"
              class="flex w-full flex-col items-center gap-0.5 rounded-lg py-0.5 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:opacity-50"
              :class="
                armed === betIdFor(bettor.playerId, row.team.code)
                  ? 'bg-danger/15 ring-2 ring-danger'
                  : 'hover:bg-surface-muted'
              "
              :aria-label="`移除 ${bettor.name} 押 ${row.team.name} 的一注`"
              @click="press(bettor.playerId, bettor.name, row.team.code, row.team.name)"
            >
              <BracketAvatar
                :name="bettor.name"
                :number="bettor.number"
                :photo-url="photos[bettor.playerId] ?? ''"
                size="sm"
              />
              <span
                class="w-full truncate text-center text-[10px] leading-tight"
                :class="
                  armed === betIdFor(bettor.playerId, row.team.code)
                    ? 'font-bold text-danger'
                    : 'text-content-muted'
                "
              >
                {{
                  armed === betIdFor(bettor.playerId, row.team.code) ? '確定移除？' : bettor.name
                }}
              </span>
            </button>
          </li>
        </ul>
      </li>
    </ul>
  </section>
</template>
