<script setup lang="ts">
import {
  BET_AMOUNT,
  TEAM_DUES_PER_BET,
  isBettingLocked,
  tallyBets,
} from '#shared/schemas/ws-bracket'

/**
 * 鎖盤（限期活動「預測世界大賽冠軍」，見 `docs/ws-bracket.md`）。
 *
 * ## 為什麼設的是「時間」而不是一個開關
 * 「時間到我會鎖盤」如果真的要靠人在那一秒按下去，那個人塞車、開會、
 * 手機沒電的時候就有人多押了一注 —— 而那一注是在知道更多資訊之後押的。
 * 所以存的是一個時間戳，時間一到自己生效；「立即鎖盤」只是把那個時間設成現在。
 *
 * ## 它是這個活動裡唯一走 BFF 的寫入
 * 下注與移除都由瀏覽器直接打 Realtime Database（純信任、任何人都能加減），
 * 但「還能不能下注」不能讓前台自己決定 —— 安全規則對 `ws-bracket/config`
 * 完全不開放寫入，只有 service account 改得動，而它在 `requireUser()` 後面。
 *
 * 前台不是「照著這個旗標自律」：安全規則讀的是同一個欄位，時間一到，
 * 繞過前端直接打 API 也一樣寫不進去。
 */
definePageMeta({ layout: 'admin', middleware: 'auth' })

const { bets, lockAt, ready, error: betsError, configured } = useWsBracketBets()
const { setLock, loading } = useWsBracketLockActions()
const toast = useToast()

const now = useNow({ interval: 1000 })
const locked = computed(() => isBettingLocked(lockAt.value, now.value.getTime()))
const tally = computed(() => tallyBets(bets.value))

/**
 * `<input type="datetime-local">` 要的是**當地時間**的 `YYYY-MM-DDTHH:mm`，
 * 不是 ISO 字串 —— `toISOString()` 是 UTC，直接丟進去會差八小時，
 * 而畫面上看起來只是「時間怎麼不對」。
 */
function toLocalInput(ms: number): string {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000)
  return d.toISOString().slice(0, 16)
}

/** 預設帶「明天晚上八點」—— 只是一個好改的起點，不是什麼規則。 */
const draft = ref(
  toLocalInput(
    new Date().setHours(20, 0, 0, 0) +
      (Date.now() > new Date().setHours(20, 0, 0, 0) ? 86_400_000 : 0),
  ),
)

// 讀到伺服器上已經設定的時間就以它為準，不要讓表單顯示一個和現況無關的值
watch(lockAt, (value) => {
  if (value != null) draft.value = toLocalInput(value)
})

const draftLabel = computed(() => {
  const ms = new Date(draft.value).getTime()
  return Number.isNaN(ms) ? '' : new Date(ms).toLocaleString('zh-Hant-TW')
})

const lockLabel = computed(() =>
  lockAt.value == null ? '' : new Date(lockAt.value).toLocaleString('zh-Hant-TW'),
)

async function apply(ms: number | null, message: string) {
  try {
    await setLock(ms)
    toast.show({ message, tone: 'success', key: 'ws-lock' })
  } catch (err) {
    toast.show({
      message: `設定失敗：${err instanceof Error ? err.message : '請稍後再試'}`,
      tone: 'error',
      key: 'ws-lock',
    })
  }
}

function schedule() {
  const ms = new Date(draft.value).getTime()
  if (Number.isNaN(ms)) {
    toast.show({ message: '請先選一個時間', tone: 'info', key: 'ws-lock' })
    return
  }
  apply(ms, `已設定 ${new Date(ms).toLocaleString('zh-Hant-TW')} 鎖盤`)
}

useHead({ title: '冠軍預測鎖盤' })
</script>

<template>
  <div class="space-y-8">
    <AdminHeader
      title="冠軍預測"
      description="設定什麼時候停止下注。時間一到就生效，不必有人在場按。"
    />

    <p v-if="!configured" class="rounded-xl bg-warning/10 px-5 py-4 text-fluid-sm">
      下注功能尚未設定（缺少
      <code class="font-mono text-xs">NUXT_PUBLIC_WS_BRACKET_DATABASE_URL</code>）。
    </p>
    <p v-else-if="betsError" class="rounded-xl bg-danger/10 px-5 py-4 text-fluid-sm">
      無法連線到下注資料庫：{{ betsError }}
    </p>

    <template v-else>
      <!-- ── 現況 ─────────────────────────────────────────────── -->
      <section class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div class="rounded-xl border border-border bg-surface p-5">
          <p class="text-fluid-sm text-content-muted">目前狀態</p>
          <p class="mt-1 text-fluid-lg font-bold">
            <template v-if="!ready">連線中…</template>
            <template v-else-if="locked">🔒 已鎖盤</template>
            <template v-else-if="lockAt">⏳ 尚未鎖盤</template>
            <template v-else>開放下注</template>
          </p>
          <p v-if="lockAt" class="mt-1 text-fluid-sm text-content-muted">{{ lockLabel }}</p>
        </div>

        <div class="rounded-xl border border-border bg-surface p-5">
          <p class="text-fluid-sm text-content-muted">目前注數</p>
          <p class="mt-1 text-fluid-2xl font-bold tabular-nums">{{ tally.totalCount }}</p>
        </div>

        <div class="rounded-xl border border-border bg-surface p-5">
          <p class="text-fluid-sm text-content-muted">收到的總額</p>
          <p class="mt-1 text-fluid-2xl font-bold tabular-nums">
            ${{ tally.pot.toLocaleString('zh-Hant-TW') }}
          </p>
          <p class="mt-1 text-fluid-sm text-content-muted">一注 ${{ BET_AMOUNT }}</p>
        </div>

        <!--
          隊費與可分彩池分開放一張卡片，不併進「收到的總額」——
          那一張回答的是「收了多少」，這一張回答的是「錢去了哪裡」，
          問題不一樣，擠在同一個數字裡反而要讓人自己心算。
        -->
        <div class="rounded-xl border border-border bg-surface p-5">
          <p class="text-fluid-sm text-content-muted">
            隊費（一注 ${{ TEAM_DUES_PER_BET }}） / 可分彩池
          </p>
          <p class="mt-1 text-fluid-lg font-bold tabular-nums">
            ${{ tally.duesTotal.toLocaleString('zh-Hant-TW') }} / ${{
              tally.payoutPool.toLocaleString('zh-Hant-TW')
            }}
          </p>
        </div>
      </section>

      <!-- ── 設定 ─────────────────────────────────────────────── -->
      <section class="space-y-4 rounded-xl border border-border bg-surface p-5">
        <h2 class="text-fluid-lg font-bold">設定鎖盤時間</h2>

        <div class="flex flex-wrap items-end gap-3">
          <UiBaseInput
            v-model="draft"
            type="datetime-local"
            label="鎖盤時間"
            class="min-w-60 flex-1"
          />
          <UiBaseButton :loading="loading" @click="schedule">
            {{ lockAt ? '更新時間' : '設定' }}
          </UiBaseButton>
        </div>
        <p v-if="draftLabel" class="text-fluid-sm text-content-muted">
          設定後，{{ draftLabel }} 起前台就不能再下注或移除。
        </p>

        <hr class="border-border" />

        <div class="flex flex-wrap items-center gap-3">
          <!--
            兩段式，不是直接執行 —— 鎖盤是會被所有人看見的動作，
            而且鎖下去之後大家就不能再改自己的注了。
          -->
          <AdminDeleteButton
            v-if="!locked"
            label="立即鎖盤"
            confirm-label="確定現在就鎖？"
            :loading="loading"
            @confirm="apply(Date.now(), '已立即鎖盤')"
          />
          <UiBaseButton
            v-if="lockAt"
            variant="secondary"
            size="sm"
            :loading="loading"
            @click="apply(null, '已解除鎖盤')"
          >
            解除鎖盤
          </UiBaseButton>
          <p class="text-fluid-sm text-content-muted">
            {{
              locked ? '解除之後大家又可以下注與移除了。' : '「立即鎖盤」等於把鎖盤時間設成現在。'
            }}
          </p>
        </div>
      </section>

      <p class="text-fluid-sm text-content-muted">
        下注與移除是前台直接寫資料庫的（任何人都能加、也能減），這一頁只管
        「什麼時候停」。要刪掉某一筆或整個清空，見
        <code class="font-mono text-xs">docs/ws-bracket.md</code>。
      </p>
    </template>
  </div>
</template>
