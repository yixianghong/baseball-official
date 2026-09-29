<script setup lang="ts">
import type { SlotState } from '#shared/schemas/batting-order'
import type { Play } from '#shared/schemas/play'
import { POSITION_LABELS } from '#shared/schemas/player'

/**
 * 我隊打擊時的打線：整份列出來，輪到的那一棒亮起來。
 *
 * ## 為什麼不是下拉選單
 * 下拉選單只看得到「現在是誰」，看不到前後棒 —— 而登錄的人要核對的正是
 * 「剛剛那位打完了嗎、下一個是不是他」。整份攤開，一眼就對得起來。
 *
 * ## 三種操作
 * - **什麼都不點**：照打線輪到的那一棒（`nextSlot`）。絕大多數打席是這樣。
 * - **點別的棒次**：這一個打席改由那一棒打。用來修正「前面漏登一個打席」
 *   或「真的打錯棒次」。亮起來的棒次和照打線應該輪到的不同時，下面會講出來，
 *   避免是手滑點到的。
 * - **代打**：在亮起來的那一棒按「代打」，從板凳挑人（或填臨時球員）。
 *   代打的人**從這個打席起永久站那一棒** —— 那是棒球的規則，不是這裡的設計。
 *   他打完之後，下一輪輪到那一棒時列表上就是他。
 *
 * 代打是**推導的**：不另外存一份「換人紀錄」，而是打席上記了第幾棒
 * （`battingSlot`），「第 5 棒現在是誰」就是最後一個記在第 5 棒的人
 * （見 `battingOrderAt()`）。選了代打但還沒登錄任何打席就換半局的話，
 * 什麼都不會留下 —— 那本來就代表他還沒上場。
 *
 * 業餘聯賽常允許先發重新上場，所以被換下的先發也列在板凳上，選回來就是回場。
 */
const props = defineProps<{
  slots: SlotState[]
  /** 照打線應該輪到第幾棒。 */
  nextSlot: number
  /** 板凳：可以上來代打的人（已經站在打線上的不列）。 */
  bench: Play['batter'][]
  disabled?: boolean
}>()

/** 這一個打席由第幾棒打。 */
const selectedSlot = defineModel<number>('slot', { required: true })
/** 這一個打席的代打（還沒登錄之前都只是「選好了」）。 */
const pinch = defineModel<Play['batter'] | null>('pinch', { required: true })

const picking = ref(false)
const tempName = ref('')
const tempNumber = ref('')

watch(selectedSlot, () => {
  // 換了棒次，原本為另一棒選的代打就不算數
  pinch.value = null
  picking.value = false
})

const selected = computed(() => props.slots.find((slot) => slot.slot === selectedSlot.value))

function label(person: Play['batter']): string {
  if (person.number && person.name) return `#${person.number} ${person.name}`
  return person.number ? `#${person.number}` : person.name || '（未填）'
}

function choosePinch(person: Play['batter']): void {
  pinch.value = { ...person }
  picking.value = false
}

function chooseTemporary(): void {
  const name = tempName.value.trim()
  const number = tempNumber.value.replace(/\D/g, '').slice(0, 3)
  if (!name && !number) return
  choosePinch({ playerId: '', name, number })
  tempName.value = ''
  tempNumber.value = ''
}
</script>

<template>
  <div class="space-y-2">
    <p class="text-fluid-sm font-medium">打線</p>

    <ol class="overflow-hidden rounded-lg border border-border" aria-label="打線">
      <li v-for="slot in slots" :key="slot.slot" class="border-b border-border last:border-b-0">
        <div
          class="flex min-h-11 items-center gap-2 px-2 transition"
          :class="
            slot.slot === selectedSlot
              ? 'bg-brand-600 text-white'
              : 'bg-surface hover:bg-surface-muted'
          "
        >
          <button
            type="button"
            class="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left text-fluid-sm disabled:cursor-not-allowed"
            :aria-current="slot.slot === selectedSlot ? 'true' : undefined"
            :disabled="disabled"
            @click="selectedSlot = slot.slot"
          >
            <span class="w-5 shrink-0 text-center font-bold">{{ slot.slot }}</span>

            <!-- 選好了代打、還沒登錄：顯示代打的人，原本的人劃掉 -->
            <template v-if="slot.slot === selectedSlot && pinch">
              <span class="truncate font-bold">{{ label(pinch) }}</span>
              <span class="shrink-0 text-xs opacity-80">代打（原 {{ label(slot.current) }}）</span>
            </template>
            <template v-else>
              <span class="truncate font-bold">{{ label(slot.current) }}</span>
              <span
                v-if="slot.substituted"
                class="shrink-0 rounded px-1 text-xs"
                :class="slot.slot === selectedSlot ? 'bg-white/20' : 'bg-warning/15 text-warning'"
              >
                代
              </span>
              <span v-else class="shrink-0 text-xs opacity-70">
                {{ POSITION_LABELS[slot.starter.position] }}
              </span>
            </template>
          </button>

          <template v-if="slot.slot === selectedSlot && !disabled">
            <span class="shrink-0 text-xs font-bold">打擊中</span>
            <button
              v-if="pinch"
              type="button"
              class="min-h-9 shrink-0 rounded-md bg-white/20 px-2 text-xs font-bold"
              @click="pinch = null"
            >
              取消代打
            </button>
            <button
              v-else
              type="button"
              class="min-h-9 shrink-0 rounded-md bg-white/20 px-2 text-xs font-bold"
              :aria-expanded="picking"
              @click="picking = !picking"
            >
              代打
            </button>
          </template>
        </div>
      </li>
    </ol>

    <!-- 跳棒時講出來：多半是手滑，真的要跳才繼續 -->
    <p v-if="selectedSlot !== nextSlot && !disabled" class="text-fluid-sm text-warning">
      照打線應該輪到第 {{ nextSlot }} 棒。
      <button
        type="button"
        class="ml-1 underline underline-offset-4"
        @click="selectedSlot = nextSlot"
      >
        改回第 {{ nextSlot }} 棒
      </button>
    </p>

    <!-- 代打人選 -->
    <div
      v-if="picking && selected"
      class="space-y-2 rounded-lg border border-brand-600/40 bg-surface p-3"
    >
      <p class="text-fluid-sm font-bold">
        誰代打第 {{ selected.slot }} 棒（原 {{ label(selected.current) }}）？
      </p>
      <p class="text-xs text-content-muted">
        代打的人從這個打席起站這一棒，之後輪到第 {{ selected.slot }} 棒都是他。
      </p>

      <div v-if="bench.length" class="flex flex-wrap gap-1.5">
        <button
          v-for="person in bench"
          :key="person.playerId || `${person.number}-${person.name}`"
          type="button"
          class="min-h-10 rounded-full border border-border px-3 text-fluid-sm hover:bg-surface-muted"
          @click="choosePinch(person)"
        >
          {{ label(person) }}
        </button>
      </div>
      <p v-else class="text-fluid-sm text-content-muted">板凳上沒有人了。</p>

      <!-- 名冊上沒有的人（臨時來支援的球友）也要代打得進來 -->
      <form class="flex flex-wrap items-end gap-2" @submit.prevent="chooseTemporary">
        <input
          v-model="tempNumber"
          inputmode="numeric"
          placeholder="背號"
          aria-label="臨時球員背號"
          class="min-h-10 w-16 rounded-lg border border-border bg-surface-muted px-2 text-fluid-sm"
        />
        <input
          v-model="tempName"
          placeholder="臨時球員姓名"
          aria-label="臨時球員姓名"
          class="min-h-10 min-w-0 flex-1 rounded-lg border border-border bg-surface-muted px-2 text-fluid-sm"
        />
        <UiBaseButton type="submit" variant="secondary" size="sm">臨時球員代打</UiBaseButton>
      </form>
    </div>
  </div>
</template>
