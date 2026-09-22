<script setup lang="ts">
import type { AttendanceEntry, LineupEntry } from '#shared/schemas/game'
import { deriveBench } from '#shared/schemas/game'
import { POSITIONS, POSITION_LABELS, type Player, type Position } from '#shared/schemas/player'

/**
 * 打線編輯器。已結束比賽的「當天打線」與未來比賽的「先發陣容」共用。
 *
 * ## 姓名會存成快照
 * 選了球員之後，`name` 與 `number` 會一起寫進打線裡。球員日後改名或退隊時，
 * 兩年前那場比賽的紀錄仍顯示當時的名字與背號 —— 歷史紀錄就該是歷史的樣子。
 * `playerId` 同時保留，所以個人頁的連結還是通的。
 *
 * ## 排序：桌機拖曳、手機用箭頭
 * 用瀏覽器原生的 drag and drop，不引入排序套件。原生 DnD 在觸控裝置上不會
 * 觸發，所以上下箭頭按鈕保留著 —— 只做拖曳等於把手機與鍵盤使用者排除在外。
 *
 * ## 允許不在名單上的人
 * `playerId` 可以留空、`name` 直接手打 —— 臨時找來的支援球員本來就不在
 * 球隊名單裡，但打線上必須寫得出他。
 */
const props = defineProps<{
  players: Player[]
  /**
   * 這場比賽的出席名單。有人回報出席時，挑人的選單只列那些人 ——
   * 排打線的當下最不想做的事，就是從全隊名單裡挑出今天會到的那幾位。
   */
  attendance?: AttendanceEntry[]
}>()
const model = defineModel<LineupEntry[]>({ required: true })

/** 新增棒次時的預設守位。選了球員之後會換成他的主要守位。 */
const DEFAULT_POSITION: Position = 'P'

const positionOptions = POSITIONS.map((position) => ({
  value: position,
  label: POSITION_LABELS[position],
}))

/** 回報出席的球員 id。沒有人回報 yes 時視為「還沒統計」。 */
const attendingIds = computed(
  () =>
    new Set(
      (props.attendance ?? [])
        .filter((entry) => entry.status === 'yes')
        .map((entry) => entry.playerId),
    ),
)

/** 是否有出席統計可用。沒有的話就只能列全隊。 */
const hasAttendance = computed(() => attendingIds.value.size > 0)

/**
 * 還沒排進先發、但當天會到的人 —— 前台會以「候補」呈現。
 *
 * 用與前台完全相同的 `deriveBench()`，不在這裡另外寫一套比對：
 * 兩邊各寫各的，遲早會出現「後台說還有 3 個人、前台列出 4 個」。
 */
const bench = computed(() =>
  deriveBench({ attendance: props.attendance ?? [], lineup: model.value }),
)

/** 使用者手動切換成「顯示全部球員」—— 臨時來的人不一定有回報出席。 */
const showAll = ref(false)

const availablePlayers = computed(() => {
  const active = props.players.filter((player) => player.status === 'active')
  if (!hasAttendance.value || showAll.value) return active
  return active.filter((player) => attendingIds.value.has(player.id))
})

const playerOptions = computed(() => [
  { value: '', label: '（自行輸入）' },
  ...availablePlayers.value.map((player) => ({
    value: player.id,
    label: player.number ? `#${player.number} ${player.name}` : player.name,
  })),
])

/**
 * 某一棒可以選的球員。
 *
 * 兩件事：已經排在其他棒次的人不再出現（避免同一個人排兩次），
 * 以及**這一棒目前選的人一定要留在選單裡** —— 他可能沒回報出席、或已經退隊，
 * 少了這一條，打開編輯畫面就會看到自己的選擇被清空。
 */
function optionsFor(index: number) {
  const current = model.value[index]
  const usedIds = new Set(
    model.value
      .filter((_, i) => i !== index)
      .map((entry) => entry.playerId)
      .filter(Boolean),
  )

  const options = playerOptions.value.filter(
    (option) =>
      option.value === '' || !usedIds.has(option.value) || current?.playerId === option.value,
  )

  // 目前選的人被出席篩選擋掉時，補回選單裡
  if (current?.playerId && !options.some((option) => option.value === current.playerId)) {
    const player = props.players.find((item) => item.id === current.playerId)
    if (player) {
      options.splice(1, 0, {
        value: player.id,
        label: player.number ? `#${player.number} ${player.name}` : player.name,
      })
    }
  }

  return options
}

function addEntry() {
  if (model.value.length >= 15) return
  model.value = [
    ...model.value,
    {
      order: model.value.length + 1,
      playerId: '',
      name: '',
      number: '',
      position: DEFAULT_POSITION,
    },
  ]
}

function removeEntry(index: number) {
  model.value = model.value
    .filter((_, i) => i !== index)
    .map((entry, i) => ({ ...entry, order: i + 1 }))
}

/**
 * 拖曳排序。
 *
 * 用瀏覽器原生的 drag and drop，不引入排序套件 —— 這裡要的只是「把一列搬到
 * 另一個位置」，為此多背一個相依不划算。
 *
 * 原生 DnD 在觸控裝置上不會觸發，所以**上下箭頭按鈕保留著**：手機用箭頭、
 * 桌機用拖曳，鍵盤使用者也還有得用。只做拖曳等於把手機和鍵盤排除在外。
 */
const draggingIndex = ref<number | null>(null)
const dragOverIndex = ref<number | null>(null)

function onDragStart(index: number, event: DragEvent) {
  draggingIndex.value = index
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    // Firefox 需要設定資料，拖曳才會啟動
    event.dataTransfer.setData('text/plain', String(index))
  }
}

function onDragOver(index: number, event: DragEvent) {
  // 不 preventDefault 的話瀏覽器不會把這裡當成可放置的目標
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  dragOverIndex.value = index
}

function onDrop(index: number) {
  const from = draggingIndex.value
  resetDrag()
  if (from === null || from === index) return
  moveTo(from, index)
}

function resetDrag() {
  draggingIndex.value = null
  dragOverIndex.value = null
}

/** 把第 from 棒搬到第 to 棒的位置，其餘依序遞補。 */
function moveTo(from: number, to: number) {
  const next = [...model.value]
  const [moved] = next.splice(from, 1)
  if (!moved) return
  next.splice(to, 0, moved)
  model.value = next.map((entry, index) => ({ ...entry, order: index + 1 }))
}

function move(index: number, direction: -1 | 1) {
  const target = index + direction
  if (target < 0 || target >= model.value.length) return

  const next = [...model.value]
  const current = next[index]!
  next[index] = next[target]!
  next[target] = current
  model.value = next.map((entry, i) => ({ ...entry, order: i + 1 }))
}

/** 選了球員就把姓名與背號一起帶入（存快照），並沿用他的主要守位。 */
function onPlayerChange(index: number, playerId: string) {
  const entry = model.value[index]
  if (!entry) return

  const player = props.players.find((item) => item.id === playerId)
  const next = [...model.value]
  next[index] = player
    ? {
        ...entry,
        playerId: player.id,
        name: player.name,
        number: player.number,
        position: player.positions[0] ?? entry.position,
      }
    : { ...entry, playerId: '' }
  model.value = next
}

function updateEntry(index: number, patch: Partial<LineupEntry>) {
  const next = [...model.value]
  const entry = next[index]
  if (!entry) return
  next[index] = { ...entry, ...patch }
  model.value = next
}

/**
 * 一鍵帶入前九人，省去逐格挑選。
 *
 * 有出席統計時帶的是「回報出席的前九位」—— 那才是當天真的排得出來的人。
 */
function fillFromRoster() {
  const starters = availablePlayers.value.slice(0, 9)
  model.value = starters.map((player, index) => ({
    order: index + 1,
    playerId: player.id,
    name: player.name,
    number: player.number,
    position: player.positions[0] ?? DEFAULT_POSITION,
  }))
}
</script>

<template>
  <div class="space-y-3">
    <!-- 出席篩選的狀態要讓人看得到，否則會以為某些球員「不見了」 -->
    <p v-if="hasAttendance" class="flex flex-wrap items-center gap-2 text-fluid-sm">
      <template v-if="showAll">
        <span class="text-content-muted"
          >目前可挑選全隊 {{ availablePlayers.length }} 位球員。</span
        >
        <button
          type="button"
          class="font-medium text-brand-600 underline underline-offset-4 dark:text-brand-300"
          @click="showAll = false"
        >
          只顯示回報出席的
        </button>
      </template>
      <template v-else>
        <span class="text-content-muted">
          只顯示回報出席的 {{ availablePlayers.length }} 位球員。
        </span>
        <button
          type="button"
          class="font-medium text-brand-600 underline underline-offset-4 dark:text-brand-300"
          @click="showAll = true"
        >
          顯示全部球員
        </button>
      </template>
    </p>

    <!--
      候補人數。排打線時最容易忽略的就是「還有誰沒排到」——
      這一行讓它不必自己對照出席名單去數。前台會把這些人列成「候補」。
    -->
    <p v-if="hasAttendance && model.length" class="text-fluid-sm text-content-muted">
      <template v-if="bench.length">
        還有
        <strong class="text-content tabular-nums">{{ bench.length }}</strong>
        位出席隊員不在先發名單上，前台會顯示為候補：
        <span class="text-content">{{ bench.map((entry) => entry.name).join('、') }}</span>
      </template>
      <template v-else>回報出席的隊員都已排進先發，沒有候補。</template>
    </p>

    <p v-else class="text-fluid-sm text-content-muted">
      還沒有人回報出席，目前可挑選全隊球員。到「出席統計」登記之後，這裡會自動只列當天會到的人。
    </p>

    <p v-if="model.length > 1" class="text-fluid-sm text-content-muted">
      拖曳任一列可以調整棒次，手機上請用右側的 ↑ ↓ 按鈕。
    </p>

    <UiBaseEmpty
      v-if="!model.length"
      title="尚未安排打線"
      description="按「新增棒次」逐棒安排，或直接用名單前九人帶入後再調整。"
      icon="📋"
    />

    <ul v-else class="space-y-2">
      <li
        v-for="(entry, index) in model"
        :key="index"
        draggable="true"
        class="grid items-end gap-3 rounded-xl border bg-surface p-3 transition sm:grid-cols-[3rem_1fr_1fr_auto]"
        :class="[
          draggingIndex === index ? 'opacity-40' : 'opacity-100',
          dragOverIndex === index && draggingIndex !== index
            ? 'border-brand-500 ring-2 ring-brand-500/40'
            : 'border-border',
        ]"
        @dragstart="onDragStart(index, $event)"
        @dragover="onDragOver(index, $event)"
        @drop="onDrop(index)"
        @dragend="resetDrag"
      >
        <!-- 整列都可以拖，這個把手只是告訴使用者「可以拖」 -->
        <div
          class="flex size-10 cursor-grab items-center justify-center gap-1 rounded-lg bg-brand-600/10 text-fluid-lg font-bold tabular-nums text-brand-600 active:cursor-grabbing dark:text-brand-300"
          :title="`第 ${entry.order} 棒，可拖曳調整順序`"
        >
          {{ entry.order }}
        </div>

        <div class="space-y-2">
          <UiBaseSelect
            label="球員"
            :model-value="entry.playerId"
            :options="optionsFor(index)"
            @update:model-value="onPlayerChange(index, $event)"
          />
          <!-- 沒有從名單選人時，姓名要自己打（支援球員） -->
          <UiBaseInput
            v-if="!entry.playerId"
            label="姓名"
            :model-value="entry.name"
            placeholder="支援球員姓名"
            @update:model-value="updateEntry(index, { name: $event })"
          />
        </div>

        <UiBaseSelect
          label="守備位置"
          :model-value="entry.position"
          :options="positionOptions"
          @update:model-value="updateEntry(index, { position: $event })"
        />

        <div class="flex gap-1">
          <UiBaseButton
            variant="ghost"
            size="sm"
            :disabled="index === 0"
            aria-label="上移"
            @click="move(index, -1)"
          >
            ↑
          </UiBaseButton>
          <UiBaseButton
            variant="ghost"
            size="sm"
            :disabled="index === model.length - 1"
            aria-label="下移"
            @click="move(index, 1)"
          >
            ↓
          </UiBaseButton>
          <UiBaseButton variant="ghost" size="sm" aria-label="移除" @click="removeEntry(index)">
            ✕
          </UiBaseButton>
        </div>
      </li>
    </ul>

    <!--
      操作列固定在畫面底部。

      排打線是「一直往下加棒次」的工作，按鈕放在最上面的話，排到第七、八棒時
      就得捲回去才按得到；放最下面則每加一棒它就往下跑一次。`sticky bottom-0`
      讓它在需要捲動時黏在視窗底部，內容短到不必捲動時則待在正常位置。

      負的橫向 margin 是為了讓它的底色撐滿內容區的寬度（版面本身有左右內距），
      看起來才像一條真正的工具列，而不是一個浮在中間的方塊。
    -->
    <div
      class="sticky bottom-0 z-20 -mx-4 flex flex-wrap items-center gap-2 border-t border-border bg-surface/95 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur md:-mx-8 md:px-8"
    >
      <UiBaseButton variant="secondary" size="sm" @click="addEntry">＋ 新增棒次</UiBaseButton>

      <UiBaseButton v-if="!model.length" variant="ghost" size="sm" @click="fillFromRoster">
        用{{ hasAttendance && !showAll ? '出席' : '名單' }}前九人帶入
      </UiBaseButton>

      <AdminDeleteButton
        v-if="model.length"
        label="全部清空"
        confirm-label="確定清空？"
        @confirm="model = []"
      />

      <span v-if="model.length" class="text-fluid-sm text-content-muted tabular-nums">
        共 {{ model.length }} 棒
      </span>

      <!-- 儲存按鈕由使用這個元件的頁面提供 —— 它才知道要存到哪裡、存了要做什麼 -->
      <div class="ml-auto">
        <slot name="actions" />
      </div>
    </div>
  </div>
</template>
