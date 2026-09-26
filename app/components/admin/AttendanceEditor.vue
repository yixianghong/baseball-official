<script setup lang="ts">
import type { AttendanceEntry, AttendanceStatus } from '#shared/schemas/game'
import { ATTENDANCE_LABELS } from '#shared/schemas/game'
import type { Player } from '#shared/schemas/player'
import { mergeAttendanceWithRoster } from '~/utils/attendance'

/**
 * 出席統計編輯器。
 *
 * 狀態用一排按鈕而不是下拉選單：登記出席是「一個人一個人快速點過去」的
 * 工作，少一次展開就少一次等待。四個狀態剛好排得下。
 */
const props = defineProps<{ players: Player[] }>()
const model = defineModel<AttendanceEntry[]>({ required: true })

const STATUSES: Array<{ value: AttendanceStatus; tone: string }> = [
  { value: 'yes', tone: 'bg-success text-white' },
  { value: 'maybe', tone: 'bg-warning text-white' },
  { value: 'no', tone: 'bg-danger text-white' },
  { value: 'pending', tone: 'bg-surface-muted text-content-muted' },
]

const counts = computed(() => ({
  yes: model.value.filter((entry) => entry.status === 'yes').length,
  maybe: model.value.filter((entry) => entry.status === 'maybe').length,
  no: model.value.filter((entry) => entry.status === 'no').length,
  pending: model.value.filter((entry) => entry.status === 'pending').length,
}))

/**
 * 讓名單隨時與現役球員保持一致。
 *
 * 原本這是兩顆按鈕（「帶入現役名單」「同步現役名單」），但它們永遠只有一個
 * 正確答案 —— 進到這一頁就是要登記今天誰會來，名單當然要先在那裡。
 * 需要使用者先按一下才看得到隊員，那一步沒有任何決定可言。
 *
 * 規則與理由都在 `mergeAttendanceWithRoster()`，**使用這個元件的頁面在灌資料
 * 時就要先呼叫同一支函式**（`pages/admin/games/[id].vue` 的 `syncFromGame`）。
 * 少了那一步，這裡補上的名單會被自動儲存當成一筆變更，於是光是打開一場還沒
 * 登記出席的比賽就寫一次資料庫。這裡留著同步是為了**之後**才發生的事 ——
 * 新球員入隊時名單要自己長出來。
 */
function syncWithRoster() {
  const next = mergeAttendanceWithRoster(model.value, props.players)

  // 內容沒變就不要寫回 model —— 每次都指派會讓頁面一直處於「有未儲存變更」的狀態
  if (JSON.stringify(next) === JSON.stringify(model.value)) return
  model.value = next
}

// 名單或球員資料一到就自動補齊，不需要使用者按任何按鈕
watch(() => props.players, syncWithRoster, { immediate: true, deep: true })

function setStatus(index: number, status: AttendanceStatus) {
  const next = [...model.value]
  const entry = next[index]
  if (!entry) return
  next[index] = { ...entry, status }
  model.value = next
}

function setNote(index: number, note: string) {
  const next = [...model.value]
  const entry = next[index]
  if (!entry) return
  next[index] = { ...entry, note }
  model.value = next
}

/**
 * 套用截圖辨識的結果。
 *
 * 名單裡還沒有的球員會先補進來 —— 通常的使用順序是「投票完直接上傳截圖」，
 * 不該要求使用者得先按一次「帶入現役名單」才能用。
 *
 * 只動辨識結果涵蓋到的人；沒出現在截圖裡的球員維持原本的狀態，
 * 這樣分兩次上傳（例如先投票、後來有人補回覆）也不會把先前的回覆洗掉。
 */
function applyRecognized(entries: Array<{ playerId: string; status: AttendanceStatus }>) {
  const byId = new Map(model.value.map((entry) => [entry.playerId, entry]))

  for (const { playerId, status } of entries) {
    const existing = byId.get(playerId)
    if (existing) {
      byId.set(playerId, { ...existing, status })
      continue
    }

    const player = props.players.find((item) => item.id === playerId)
    if (!player) continue
    byId.set(playerId, {
      playerId: player.id,
      name: player.name,
      number: player.number,
      status,
      note: '',
    })
  }

  // 依現役名單的順序重排，維持與「帶入現役名單」一致的排列
  const order = new Map(props.players.map((player, index) => [player.id, index]))
  model.value = [...byId.values()].sort(
    (a, b) => (order.get(a.playerId) ?? 999) - (order.get(b.playerId) ?? 999),
  )
}
</script>

<template>
  <div class="space-y-4">
    <AdminAttendanceImport :players="players" @apply="applyRecognized" />

    <p v-if="model.length" class="flex flex-wrap gap-x-5 gap-y-1 text-fluid-sm">
      <span class="text-success">出席 {{ counts.yes }}</span>
      <span class="text-warning">待確認 {{ counts.maybe }}</span>
      <span class="text-danger">不出席 {{ counts.no }}</span>
      <span class="text-content-muted">未回覆 {{ counts.pending }}</span>
    </p>

    <UiBaseEmpty
      v-if="!model.length"
      title="名單裡還沒有現役球員"
      description="到「球員名單」新增隊員之後，這裡會自動帶入，再逐一登記回覆狀況。"
      icon="🙋"
    />

    <ul v-else class="space-y-2">
      <li
        v-for="(entry, index) in model"
        :key="entry.playerId || entry.name"
        class="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2.5"
      >
        <span class="min-w-32 font-medium">
          <span v-if="entry.number" class="mr-1 text-content-muted tabular-nums">
            #{{ entry.number }}
          </span>
          {{ entry.name }}
        </span>

        <div class="flex gap-1" role="group" :aria-label="`${entry.name} 的出席狀態`">
          <button
            v-for="status in STATUSES"
            :key="status.value"
            type="button"
            class="min-h-9 rounded-lg px-3 text-fluid-sm font-medium transition"
            :class="
              entry.status === status.value
                ? status.tone
                : 'text-content-muted hover:bg-surface-muted'
            "
            :aria-pressed="entry.status === status.value"
            @click="setStatus(index, status.value)"
          >
            {{ ATTENDANCE_LABELS[status.value] }}
          </button>
        </div>

        <input
          :value="entry.note"
          type="text"
          placeholder="備註（選填）"
          maxlength="100"
          class="min-h-9 min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 text-fluid-sm"
          @input="setNote(index, ($event.target as HTMLInputElement).value)"
        />
      </li>
    </ul>
  </div>
</template>
