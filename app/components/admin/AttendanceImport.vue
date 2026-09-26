<script setup lang="ts">
import type { AttendanceStatus } from '#shared/schemas/game'
import { ATTENDANCE_LABELS } from '#shared/schemas/game'
import type { Player } from '#shared/schemas/player'
import { LOW_CONFIDENCE_THRESHOLD, type ParsedAttendance } from '#shared/schemas/ai'
import { ApiError } from '~/utils/api-error'

/**
 * 用 LINE 投票截圖填出席名單。
 *
 * ## 難的不是讀字，是對應名字
 * 出席調查多半在 LINE 上進行，而 LINE 顯示的是暱稱：「阿豪」是「張志豪」、
 * 「冠宇」少了姓。所以辨識時會把現有名單一起送給模型做對應，回來的每一筆
 * 都帶著它認為對應到哪位球員。
 *
 * 模型對不上的（或對錯的），這裡用一個下拉讓人直接改 —— 與其追求模型 100%
 * 正確，不如讓修正只要一次點擊。
 *
 * ## 套用前不會動到出席名單
 * 確認完按「套用」才把狀態寫回編輯器，而且只動有對應到球員的那幾筆。
 */
const props = defineProps<{ players: Player[] }>()

const emit = defineEmits<{
  apply: [entries: Array<{ playerId: string; status: AttendanceStatus }>]
}>()

const { parseAttendance, loading } = useAiActions()

const fileInput = ref<HTMLInputElement | null>(null)
const message = ref('')
const warnings = ref<string[]>([])
const entries = ref<ParsedAttendance[]>([])

/** 只列現役球員，退隊的人不會出現在投票裡。 */
const roster = computed(() =>
  props.players
    .filter((player) => player.status === 'active')
    .map((player) => ({ id: player.id, name: player.name, number: player.number })),
)

const playerOptions = computed(() => [
  { value: '', label: '（不對應任何球員）' },
  ...roster.value.map((player) => ({
    value: player.id,
    label: player.number ? `#${player.number} ${player.name}` : player.name,
  })),
])

const statusOptions = (['yes', 'no', 'maybe', 'pending'] as const).map((status) => ({
  value: status,
  label: ATTENDANCE_LABELS[status],
}))

const matchedCount = computed(() => entries.value.filter((entry) => entry.playerId).length)

async function handleFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  message.value = ''
  warnings.value = []
  entries.value = []

  if (roster.value.length === 0) {
    message.value = '球員名單是空的，請先建立名單，辨識時才能把截圖上的名字對應到球員。'
    input.value = ''
    return
  }

  try {
    const result = await parseAttendance(file, roster.value)
    entries.value = result.entries
    warnings.value = result.warnings
    message.value = result.entries.length
      ? `讀到 ${result.entries.length} 筆回覆，請核對名字的對應關係。`
      : '沒有讀到任何出席回覆。'
  } catch (err) {
    message.value =
      err instanceof Error && !(err instanceof ApiError) ? err.message : ApiError.from(err).message
  } finally {
    input.value = ''
  }
}

function apply() {
  const applicable = entries.value
    .filter((entry) => entry.playerId)
    .map((entry) => ({ playerId: entry.playerId, status: entry.status }))

  if (!applicable.length) return

  emit('apply', applicable)
  entries.value = []
  // 這一頁是自動儲存的，早就沒有「儲存出席名單」那顆按鈕了
  message.value = `已套用 ${applicable.length} 筆回覆，會自動儲存。`
  warnings.value = []
}

function reset() {
  entries.value = []
  message.value = ''
  warnings.value = []
}
</script>

<template>
  <div class="rounded-xl border border-dashed border-brand-300 bg-brand-600/5 p-4">
    <div class="flex flex-wrap items-center gap-3">
      <div class="min-w-0 flex-1">
        <p class="font-medium">用 LINE 投票截圖填寫</p>
        <p class="mt-0.5 text-fluid-sm text-content-muted">
          把 LINE 的投票結果或接龍訊息截圖上傳，系統會讀出每個人的回覆，
          並盡量把暱稱對應到名單中的球員。
        </p>
      </div>

      <UiBaseButton :loading="loading" @click="fileInput?.click()">
        {{ loading ? '辨識中…' : '選擇截圖' }}
      </UiBaseButton>
      <input ref="fileInput" type="file" accept="image/*" class="hidden" @change="handleFile" />
    </div>

    <p v-if="loading" class="mt-3 text-fluid-sm text-content-muted">
      辨識通常需要 10～30 秒，請不要關閉頁面。
    </p>

    <p v-if="message" class="mt-3 text-fluid-sm">{{ message }}</p>

    <ul v-if="warnings.length" class="mt-2 space-y-1">
      <li v-for="warning in warnings" :key="warning" class="text-fluid-sm text-warning">
        ・{{ warning }}
      </li>
    </ul>

    <!-- 對照表：每一列都能改對應到誰、改狀態 -->
    <div v-if="entries.length" class="mt-4 space-y-2">
      <p class="text-fluid-sm text-content-muted">
        已對應 {{ matchedCount }} / {{ entries.length }} 筆。
        對不上的可以在下拉選單指定，或維持「不對應」讓它被略過。
      </p>

      <ul class="space-y-2">
        <li
          v-for="(entry, index) in entries"
          :key="index"
          class="grid items-end gap-3 rounded-lg border bg-surface p-3 sm:grid-cols-[1fr_1fr_8rem_auto]"
          :class="entry.playerId ? 'border-border' : 'border-warning/50'"
        >
          <div>
            <p class="text-xs text-content-muted">截圖上的名字</p>
            <p class="mt-1 font-medium">{{ entry.displayName }}</p>
          </div>

          <UiBaseSelect v-model="entry.playerId" label="對應球員" :options="playerOptions" />

          <UiBaseSelect v-model="entry.status" label="出席狀態" :options="statusOptions" />

          <UiBaseBadge
            :tone="entry.confidence < LOW_CONFIDENCE_THRESHOLD ? 'warning' : 'success'"
            size="sm"
          >
            {{ Math.round(entry.confidence * 100) }}%
          </UiBaseBadge>
        </li>
      </ul>

      <div class="flex flex-wrap gap-2">
        <UiBaseButton :disabled="!matchedCount" @click="apply">
          套用 {{ matchedCount }} 筆到出席名單
        </UiBaseButton>
        <UiBaseButton variant="ghost" @click="reset">捨棄辨識結果</UiBaseButton>
      </div>
    </div>
  </div>
</template>
