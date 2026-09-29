<script setup lang="ts">
import type { Player } from '#shared/schemas/player'

/**
 * 隊員頭像列（限期活動，見 `docs/ws-bracket.md`）。
 *
 * 釘在畫面下緣：下注時要同時看得到「我」與「要押的球隊」，而球隊在上面的
 * 樹狀圖裡。放在頁面頂端的話，捲到樹狀圖時頭像就不見了。
 *
 * 這一列可橫向捲動，讓排在後面的隊員也能被選取。
 */
const props = defineProps<{
  players: Player[]
  /** `playerId → 這個人總共下了幾注`。 */
  betCounts: Record<string, number>
  /**
   * 一個人最多能押幾注。到了這個數字，那個人的頭像**整個收起來** ——
   * 不是等他點完球隊才被拒絕。這是最常見的情況（大多數人一下就是兩注），
   * 值得直接擋在起點，而不是每次都要等一次失敗的嘗試才知道。
   *
   * 「押過某一隊」則不在這裡擋：那是每個球隊各自的事，這個人的頭像本身
   * 還有效（還沒押滿），安全規則與 `place()` 裡的檢查會在點選球隊時擋下並說明原因。
   */
  maxBetsPerPlayer: number
  /** 點選模式選起來的那個人。 */
  selectedId: string | null
  disabled: boolean
}>()

function reachedMax(playerId: string): boolean {
  return (props.betCounts[playerId] ?? 0) >= props.maxBetsPerPlayer
}

const emit = defineEmits<{
  /**
   * 點一下（選取）。⚠️ 一定要綁 `click` 而不是只靠 `pointerup` ——
   * 鍵盤按 Enter／空白鍵只會發 `click`，一個指標事件都不會發。
   */
  select: [source: { playerId: string; playerName: string; playerNumber: string }]
}>()

function toSource(player: Player) {
  return {
    playerId: player.id,
    playerName: player.name,
    playerNumber: player.number,
  }
}
</script>

<template>
  <div
    class="border-t border-border bg-surface-raised/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
  >
    <div class="container-content flex items-baseline justify-between gap-3 pt-3">
      <p class="text-fluid-sm font-bold">先點自己的頭像，再點球隊</p>
    </div>

    <!-- overscroll-x-contain：滑到底時不要把整個頁面一起往旁邊帶 -->
    <ul class="flex touch-pan-x gap-3 overflow-x-auto overscroll-x-contain px-4 py-3">
      <li v-for="player in players" :key="player.id" class="shrink-0">
        <button
          type="button"
          :disabled="disabled || reachedMax(player.id)"
          class="flex w-16 touch-pan-x flex-col items-center gap-1 rounded-xl p-1 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:opacity-40"
          :class="[selectedId === player.id ? 'bg-brand-500/15' : 'hover:bg-surface-muted']"
          :aria-pressed="selectedId === player.id"
          :aria-label="
            reachedMax(player.id)
              ? `${player.name}，已經押滿 ${maxBetsPerPlayer} 注`
              : `${player.name}，已下 ${betCounts[player.id] ?? 0} 注`
          "
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
