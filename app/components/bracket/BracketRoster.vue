<script setup lang="ts">
import type { Player } from '#shared/schemas/player'
import type { BetDragSource } from '~/composables/useWsBetDrag'

/**
 * 可拖曳的隊員頭像列（限期活動，見 `docs/ws-bracket.md`）。
 *
 * 釘在畫面下緣：下注時要同時看得到「我」與「要押的球隊」，而球隊在上面的
 * 樹狀圖裡。放在頁面頂端的話，捲到樹狀圖時頭像就不見了。
 *
 * ⚠️ **`touch-action` 是 `pan-x` 而不是 `none`。**
 * 這一列本身要橫向捲（隊員有二十幾個），而 `none` 會把捲動一起吃掉 ——
 * 結果是排在後面的人**永遠選不到**，畫面上看起來就是「名單只有這幾個」。
 * `pan-x` 讓瀏覽器保留橫向捲動、把上下方向的手勢留給我們，
 * 而拖去樹狀圖的動作本來就是往上的。
 *
 * ⚠️ 拖曳來源還要禁止圖片長按 callout。iOS 會把長按頭像接手成圖片預覽、
 * Android 則可能開原生選單；兩者都會送 `pointercancel`，中斷我們的拖曳。
 */
const props = defineProps<{
  players: Player[]
  /** `playerId → 這個人總共下了幾注`。 */
  betCounts: Record<string, number>
  /**
   * 一個人最多能押幾注。到了這個數字，那個人的頭像**整個收起來** ——
   * 不是等他拖到某一格才被拒絕。這是最常見的情況（大多數人一下就是兩注），
   * 值得直接擋在起點，而不是每次都要等一次失敗的嘗試才知道。
   *
   * 「押過某一隊」則不在這裡擋：那是每個球隊各自的事，這個人的頭像本身
   * 還有效（還沒押滿），沒有理由整個人變成不能拖，安全規則與 `place()`
   * 裡的檢查會在放開的那一刻擋下並說明原因（跟「淘汰」走的是同一套模式）。
   */
  maxBetsPerPlayer: number
  /** 點選模式選起來的那個人。 */
  selectedId: string | null
  /** 正在被拖的那個人（要在原位留一個淡淡的影子）。 */
  draggingId: string | null
  disabled: boolean
}>()

function reachedMax(playerId: string): boolean {
  return (props.betCounts[playerId] ?? 0) >= props.maxBetsPerPlayer
}

const emit = defineEmits<{
  /** 按下去（開始判斷是拖曳還是點一下）。 */
  grab: [event: PointerEvent, source: BetDragSource]
  /**
   * 點一下（選取）。⚠️ 一定要綁 `click` 而不是只靠 `pointerup` ——
   * 鍵盤按 Enter／空白鍵只會發 `click`，一個指標事件都不會發。
   */
  select: [source: BetDragSource]
}>()

function toSource(player: Player): BetDragSource {
  return {
    playerId: player.id,
    playerName: player.name,
    playerNumber: player.number,
    photoUrl: player.photoUrl,
  }
}
</script>

<template>
  <div
    class="border-t border-border bg-surface-raised/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
  >
    <div class="container-content flex items-baseline justify-between gap-3 pt-3">
      <p class="text-fluid-sm font-bold">把自己的頭像拖到球隊上</p>
      <p class="text-xs text-content-muted">或點頭像再點球隊</p>
    </div>

    <!-- overscroll-x-contain：滑到底時不要把整個頁面一起往旁邊帶 -->
    <ul class="flex touch-pan-x gap-3 overflow-x-auto overscroll-x-contain px-4 py-3">
      <li v-for="player in players" :key="player.id" class="shrink-0">
        <button
          type="button"
          :disabled="disabled || reachedMax(player.id)"
          class="flex w-16 touch-pan-x flex-col items-center gap-1 rounded-xl p-1 transition select-none [-webkit-touch-callout:none] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:opacity-40"
          :class="[
            selectedId === player.id ? 'bg-brand-500/15' : 'hover:bg-surface-muted',
            draggingId === player.id ? 'opacity-30' : '',
          ]"
          :aria-pressed="selectedId === player.id"
          :aria-label="
            reachedMax(player.id)
              ? `${player.name}，已經押滿 ${maxBetsPerPlayer} 注`
              : `${player.name}，已下 ${betCounts[player.id] ?? 0} 注`
          "
          @pointerdown.prevent="emit('grab', $event, toSource(player))"
          @contextmenu.prevent
          @click="emit('select', toSource(player))"
        >
          <BracketAvatar
            :name="player.name"
            :number="player.number"
            :photo-url="player.photoUrl"
            :count="betCounts[player.id] ?? 0"
            :selected="selectedId === player.id"
          />
          <span class="w-full truncate text-center text-[11px] leading-tight font-semibold">
            {{ player.name }}
          </span>
        </button>
      </li>

      <li v-if="!players.length" class="py-3 text-fluid-sm text-content-muted">
        名單裡還沒有現役隊員。
      </li>
    </ul>
  </div>
</template>
