<script setup lang="ts">
import { halfInningLabel, orderedNarratives, type HalfInningNarrative } from '#shared/schemas/game'

/**
 * 逐局戰況。後台按「產生這半局的敘述」存下來的那幾段話。
 *
 * ## 它和影片底下那一行不一樣
 * 影片底下是 `describeHalfInning()` 排出來的一行索引（「#24 三安、#56 三振」），
 * 純函式、不花錢、永遠跟著打席走。這裡是**完整的句子**，由 AI 寫、人按過按鈕
 * 才存下來的 —— 兩者的用途不同，所以沒有互相取代。
 *
 * ## ⚠️ 為什麼不會過時
 * 存這段文字唯一的風險是「打席改了、敘述還在講舊的事」。伺服器在存打席時
 * **就把那一格的敘述刪掉了**（`saveHalfInningPlays()`），所以這裡顯示的永遠是
 * 「針對目前這份打席寫出來的那一段」，不然就是空的（整個區塊不出現）。
 */
const props = defineProps<{ narratives: HalfInningNarrative[] }>()

const items = computed(() => orderedNarratives(props.narratives))
</script>

<template>
  <section v-if="items.length" aria-labelledby="narratives-heading">
    <h2 id="narratives-heading" class="mb-4 text-fluid-xl font-bold">逐局戰況</h2>

    <ol class="space-y-4">
      <li v-for="item in items" :key="`${item.inning}-${item.half}`" class="surface-card p-4">
        <p class="mb-1 text-fluid-sm font-bold text-brand-600 dark:text-brand-300">
          {{ halfInningLabel(item.inning, item.half) }}
        </p>
        <p class="text-fluid-base leading-relaxed">{{ item.text }}</p>
      </li>
    </ol>
  </section>
</template>
