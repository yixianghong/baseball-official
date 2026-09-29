<script setup lang="ts">
import {
  BET_AMOUNT,
  MAX_BETS_PER_PLAYER,
  TEAM_DUES_PER_BET,
  hasBetOnTeam,
  isBettingLocked,
  reachedMaxBets,
  tallyBets,
  teamByCode,
} from '#shared/schemas/ws-bracket'
import type { BetDragSource } from '~/composables/useWsBetDrag'

/**
 * 「預測世界大賽冠軍」—— 限期的小遊戲活動。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ **這一頁是整包可拆的。** 完整的設計理由、設定步驟與拆除清單在
 * `docs/ws-bracket.md`。它唯一違反全站架構紀律的地方是
 * **下注資料由瀏覽器直接讀寫 Realtime Database**（`useWsBracketBets()`），
 * 樹狀圖與戰績仍然照規矩走 BFF（`useWsBracket()`）。
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ## 玩法
 * 一注 {@link BET_AMOUNT} 元，把自己的頭像拖到看好的球隊上就算一注。
 * **同一隊同一個人最多押一注，一個人全部加起來最多押 {@link MAX_BETS_PER_PLAYER} 注**
 * （不同隊）。下錯了可以在彩池表移除，鎖盤之後就不行 —— 沒有前台登入系統時，
 * 「新增」與「移除」都是純信任，唯一擋得住的是這兩條上限，靠安全規則
 * 與畫面一起守（見 `docs/ws-bracket.md`）。
 *
 * ## 幾件在畫面上要看得出來的事
 * - **被淘汰的球隊不能再押**，而且要一眼看得出來（灰階 + 刪除線）。
 * - **押滿兩注的人，頭像在隊員列直接收起來**，不是留著讓人一直戳到失敗。
 * - **「押中可分」是預估**：後面每多一注，已下注的人分到的就變少。
 * - **戰績是幾分鐘前抓的**，所以頁尾寫出更新時間，不要讓人以為是逐球即時。
 */
definePageMeta({ layout: 'default' })

const { data: bracket, pending, error, refresh } = useWsBracket()
const { data: players } = await usePlayers({ status: 'active' })
const {
  bets,
  lockAt,
  ready,
  error: betsError,
  configured,
  placeBet,
  removeBet,
} = useWsBracketBets()
const toast = useToast()

/**
 * 鎖盤。
 *
 * ⚠️ 時鐘要**會走**（`useNow`），不能只在載入時算一次 —— 開著頁面等截止時間
 * 的人正是最可能在最後一刻想再押一注的人，而他看到的畫面如果停在「還沒鎖」，
 * 按下去就會收到一個沒頭沒腦的失敗（規則那一層照樣擋）。
 *
 * 真正擋得住的是安全規則裡的同一條比較，所以這裡算錯了也只是畫面不同步，
 * 寫不進去就是寫不進去。
 */
const now = useNow({ interval: 1000 })
const locked = computed(() => isBettingLocked(lockAt.value, now.value.getTime()))

/** 鎖盤時間的顯示文字。還沒設定就沒有這一行。 */
const lockLabel = computed(() =>
  lockAt.value == null
    ? ''
    : new Date(lockAt.value).toLocaleString('zh-Hant-TW', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
)

/** 樹狀圖的橫向捲動容器。拖曳到邊緣時要自動捲，所以 ref 由頁面持有。 */
const scroller = ref<HTMLElement | null>(null)
/**
 * 釘在畫面下緣的隊員列。傳給 `useWsBetDrag()` 當作「樹狀圖看得見的下界」——
 * 它蓋住的那一條不算可視範圍，理由見那支 composable。
 */
const rosterBar = ref<HTMLElement | null>(null)

const tally = computed(() => tallyBets(bets.value))

/**
 * `playerId → 照片網址`。
 *
 * 照片**不存進下注紀錄**（姓名與背號才存快照）：換照片時舊的注也該跟著換，
 * 照片不是「這筆紀錄當時的樣子」的一部分。查不到的人就用背號畫頭像。
 */
const photos = computed(() =>
  Object.fromEntries(
    (players.value ?? []).filter((p) => p.photoUrl).map((p) => [p.id, p.photoUrl]),
  ),
)

/** 每個人總共下了幾注，畫在隊員列的頭像上。 */
const betCounts = computed(() => {
  const counts: Record<string, number> = {}
  for (const bet of bets.value) counts[bet.playerId] = (counts[bet.playerId] ?? 0) + 1
  return counts
})

/** 送出中的那一注。連點兩下時擋住第二次 —— RTDB 是 push，重複送就是兩注。 */
const submitting = ref(false)

async function place(source: BetDragSource, code: string) {
  if (submitting.value) return

  const team = teamByCode(code)
  if (!team) return

  /*
   * 鎖盤擋在這裡，不只擋在畫面上。
   *
   * 畫面會在時間一到就把隊員列收起來，但點選模式已經選好的人、還沒放開的
   * 拖曳都可能跨過那一刻 —— 而安全規則那一層丟出來的錯誤訊息是英文的
   * `PERMISSION_DENIED`，使用者看不懂發生了什麼事。
   */
  if (locked.value) {
    toast.show({ message: '已經鎖盤，不能再下注了', tone: 'info', key: 'ws-bet' })
    return
  }

  /*
   * 「同一隊只能押一注」「一人最多兩注」擋在這裡，不只擋在畫面上。
   *
   * 安全規則是真正的防線（固定的 slot1／slot2 + 寫入時互相比對，見
   * `database.rules.json`），但它拋出來的錯誤是英文的 `PERMISSION_DENIED`，
   * 使用者看不懂發生了什麼事 —— 這裡先攔下來給一句看得懂的話。
   */
  if (hasBetOnTeam(bets.value, source.playerId, code)) {
    toast.show({
      message: `${source.playerName} 已經押過 ${team.name} 了`,
      tone: 'info',
      key: 'ws-bet',
    })
    return
  }
  if (reachedMaxBets(bets.value, source.playerId)) {
    toast.show({
      message: `${source.playerName} 已經押滿 ${MAX_BETS_PER_PLAYER} 注了`,
      tone: 'info',
      key: 'ws-bet',
    })
    return
  }

  /*
   * 淘汰的球隊擋在這裡，不只擋在畫面上。
   *
   * `data-bet-disabled` 已經讓拖曳放不上去，但點選模式與鍵盤走的是另一條路，
   * 而「哪些隊還活著」在輪詢之間會變 —— 兩條路各判斷一次遲早會有一條漏掉。
   */
  if (bracket.value?.eliminated.includes(code)) {
    toast.show({ message: `${team.name} 已經被淘汰了`, tone: 'info', key: 'ws-bet' })
    return
  }

  submitting.value = true
  try {
    await placeBet({
      playerId: source.playerId,
      playerName: source.playerName,
      playerNumber: source.playerNumber,
      team: code,
    })
    toast.show({
      message: `${source.playerName} 押 ${team.name}，$${BET_AMOUNT}`,
      tone: 'success',
      key: 'ws-bet',
    })
  } catch (err) {
    toast.show({
      message: `下注失敗：${err instanceof Error ? err.message : '請稍後再試'}`,
      tone: 'error',
      key: 'ws-bet',
    })
  } finally {
    submitting.value = false
  }
}

/**
 * 移除一注。
 *
 * **任何人都能移除任何一筆**（和下注對稱）。防手滑靠的是彩池那張表上的
 * 兩段式確認，而不是這裡 —— 這裡只負責送出與說明結果。
 */
async function remove(id: string, label: string) {
  if (submitting.value) return

  if (locked.value) {
    toast.show({ message: '已經鎖盤，不能再移除了', tone: 'info', key: 'ws-bet' })
    return
  }

  submitting.value = true
  try {
    await removeBet(id)
    toast.show({ message: `已移除 ${label}`, tone: 'success', key: 'ws-bet' })
  } catch (err) {
    toast.show({
      message: `移除失敗：${err instanceof Error ? err.message : '請稍後再試'}`,
      tone: 'error',
      key: 'ws-bet',
    })
  } finally {
    submitting.value = false
  }
}

const { selected, dragging, pointer, hovered, grab, toggle, placeSelected } = useWsBetDrag({
  onPlace: place,
  scroller,
  keepClear: rosterBar,
})

const updatedAt = computed(() =>
  bracket.value?.fetchedAt
    ? new Date(bracket.value.fetchedAt).toLocaleTimeString('zh-Hant-TW', {
        hour: '2-digit',
        minute: '2-digit',
      })
    : '',
)

useHead({
  title: '預測世界大賽冠軍',
  meta: [{ name: 'description', content: '把自己的頭像拖到看好的球隊上，一注 200 元。' }],
})
</script>

<template>
  <div>
    <CommonPageHero
      en="World Series Pick'em"
      zh="預測世界大賽冠軍"
      :description="`把自己的頭像拖到看好的球隊上就算一注，一注 $${BET_AMOUNT}（其中 $${TEAM_DUES_PER_BET} 是隊費）。同一隊只能押一注，一個人最多押 ${MAX_BETS_PER_PLAYER} 注。`"
    />

    <div class="container-content space-y-8 py-8">
      <!--
        鎖盤狀態。放在規則上面 —— 「現在還能不能下注」比規則本身更急著要知道，
        而且鎖盤之後整頁的操作都不見了，不說明的話看起來就像功能壞了。
      -->
      <p
        v-if="locked"
        class="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-ink px-5 py-4 text-fluid-sm text-white"
      >
        <span class="font-bold">🔒 已鎖盤</span>
        <span class="text-white/75">{{ lockLabel }} 起不能再下注或移除，彩池已經定案。</span>
      </p>
      <p
        v-else-if="lockAt"
        class="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-accent-500/15 px-5 py-4 text-fluid-sm"
      >
        <span class="font-bold">⏳ {{ lockLabel }} 鎖盤</span>
        <span class="text-content-muted">在那之前都可以改，時間一到就不能再動了。</span>
      </p>

      <!-- 規則 -->
      <ul
        class="flex flex-wrap gap-x-6 gap-y-2 rounded-xl bg-surface-muted px-5 py-4 text-fluid-sm text-content-muted"
      >
        <li>
          一注 ${{ BET_AMOUNT }}，其中 ${{ TEAM_DUES_PER_BET }} 是隊費、剩下的進彩池，
          押中世界大賽冠軍的人平分彩池
        </li>
        <li>
          <strong class="text-content"
            >同一隊只能押一注，一個人最多押 {{ MAX_BETS_PER_PLAYER }} 注</strong
          >
        </li>
        <li>下錯了可以在下面的彩池表移除，<strong class="text-content">鎖盤之後就不行</strong></li>
        <li>已被淘汰的球隊不能再押</li>
        <li>戰績來自 MLB 官方，每幾分鐘更新一次</li>
      </ul>

      <UiBaseError v-if="error" :error="error" @retry="refresh()" />

      <div v-else-if="pending && !bracket" class="flex justify-center py-20">
        <UiBaseSpinner />
      </div>
    </div>

    <!--
      樹狀圖的橫向捲動容器。

      ⚠️ 它**刻意放在 `.container-content` 外面**（版面的 `<main>` 沒有寬度
      限制）—— 畫布是 1160px 寬，塞進內容容器裡的話**桌機上也會被切掉右半邊**，
      而右半邊正好是整個國聯。全站的滿版區塊都是這樣做的，不要改用負 margin
      加 `100vw`：`100vw` 含垂直捲軸的寬度，會橫向溢出十幾像素。

      ⚠️ 這裡也**不能**放任何絕對定位的浮動選單（CSS 規定只要有一軸不是
      `visible`，另一軸就不會是 `visible`，見 CLAUDE.md）。拖曳中的頭像
      是 teleport 到 `<body>` 的，所以不受影響。
    -->
    <section v-if="bracket" class="px-4">
      <div
        ref="scroller"
        class="overflow-x-auto overscroll-x-contain rounded-2xl bg-surface-raised py-4 ring-1 ring-border"
      >
        <BracketTree
          :bracket="bracket"
          :tally="tally"
          :photos="photos"
          :hovered="hovered"
          :armed="Boolean(selected) && !locked"
          :locked="locked"
          @place="(code) => placeSelected(code)"
        />
      </div>
      <!--
        提示的斷點是 `xl`（1280）而不是 `lg` —— 畫布 1160 加上左右留白要
        1192px 才放得下，在 1024～1192 這一段其實還是要捲。
      -->
      <p class="mt-2 text-center text-xs text-content-muted xl:hidden">左右滑動看完整賽程樹</p>
    </section>

    <div class="container-content space-y-8 py-8">
      <template v-if="bracket">
        <!-- 連線狀態。「看起來沒有人下注」與「根本沒連上」在畫面上長得一模一樣 -->
        <p v-if="!configured" class="rounded-xl bg-warning/10 px-5 py-4 text-fluid-sm">
          下注功能尚未設定（缺少
          <code class="font-mono text-xs">NUXT_PUBLIC_WS_BRACKET_DATABASE_URL</code>），
          目前只能看賽程與戰績。
        </p>
        <p v-else-if="betsError" class="rounded-xl bg-danger/10 px-5 py-4 text-fluid-sm">
          無法連線到下注資料庫：{{ betsError }}
        </p>

        <BracketPot
          :bracket="bracket"
          :tally="tally"
          :bets="bets"
          :photos="photos"
          :locked="locked"
          :busy="submitting"
          @remove="remove"
        />

        <p v-if="updatedAt" class="text-center text-xs text-content-muted">
          戰績更新於 {{ updatedAt }} · 資料來源：MLB 官方賽程
        </p>
      </template>
    </div>

    <!--
      隊員列固定在畫面下緣。外層那塊 `pb-40` 的留白不能省 ——
      少了它，頁面最後一段內容永遠被這一列蓋住（`fixed` 不佔版面空間）。

      ⚠️ 它的 z-index 要**低於** toast（`UiToastHost`），否則「下注成功」
      會被這一列壓在下面，使用者按了半天看不到任何回應。
    -->
    <!--
      鎖盤之後整列收起來，不是停用。

      一整排點不動的頭像只會讓人一直去戳，而畫面上那條「已鎖盤」的說明
      反而被它擠到看不見的地方。收起來之後，頁面剩下的就是「結果」。
    -->
    <div v-if="configured && !locked" class="pb-40" />
    <div v-if="configured && !locked" ref="rosterBar" class="fixed inset-x-0 bottom-0 z-30">
      <BracketRoster
        :players="players ?? []"
        :bet-counts="betCounts"
        :max-bets-per-player="MAX_BETS_PER_PLAYER"
        :selected-id="selected?.playerId ?? null"
        :dragging-id="dragging?.playerId ?? null"
        :disabled="!ready || submitting"
        @grab="grab"
        @select="toggle"
      />
    </div>

    <!--
      拖曳中的頭像。

      teleport 到 `<body>` 並用 `position: fixed`：它的起點在橫向捲動的
      隊員列裡，留在原地的話會被容器裁掉（`overflow-x-auto` 的兩軸都不是
      `visible`）。`pointer-events-none` 同樣不能省 —— 這塊東西正好在手指
      底下，會接事件的話 `elementFromPoint()` 永遠只打得到它自己。
    -->
    <Teleport to="body">
      <div
        v-if="dragging"
        class="pointer-events-none fixed z-50"
        :style="{ left: `${pointer.x}px`, top: `${pointer.y}px` }"
      >
        <!--
          手指拖曳時球要畫在手指**上方**，不是正下方（比照逐局紀錄的球場拖曳）：
          蓋在手指底下的東西看不到，而看不到就不知道現在會放進哪一格。
        -->
        <div class="-translate-x-1/2 -translate-y-[calc(100%+12px)] scale-125">
          <BracketAvatar
            :name="dragging.playerName"
            :number="dragging.playerNumber"
            :photo-url="dragging.photoUrl"
            size="lg"
            selected
          />
        </div>
      </div>
    </Teleport>
  </div>
</template>
