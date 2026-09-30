<script setup lang="ts" generic="T extends string">
/**
 * 單場比賽後台的分頁列，**固定在畫面底部**。
 *
 * ## 為什麼在底部
 * 這一頁的每個分頁都很長（計分板、逐局登錄、錄影清單），而管理者在同一場
 * 比賽裡是**來回切**的：登完半局去看計分板、傳完影片回來對打線。分頁列在
 * 頂端的話，每切一次都要先捲回最上面 —— 捲動變成切換的成本。
 * 底部那一排則永遠在拇指旁邊。
 *
 * ## ⚠️ `fixed` 而不是 `sticky`
 * 和錄影頁的錄影鈕同一個理由：`sticky` 不會把元素拉出文件流，分頁列本來
 * 就排在內容後面，所以在捲到底之前完全沒有作用（看起來像沒生效，其實是
 * 規格如此）。
 *
 * ## ⚠️ 兩個會吃掉畫面的坑
 * 1. **底下的內容會被蓋住** —— 所以這個元件自己在文件流裡放一個等高的
 *    佔位方塊，頁面不必記得補 `padding-bottom`（忘記補的症狀是「最後一個
 *    欄位永遠點不到」）。
 * 2. **跨螢幕的 `fixed` 容器會吃掉點擊**（`UiToastHost` 踩過）。外層是
 *    `pointer-events-none`，只有真正那一條 bar 收事件 —— 桌機版左邊那段
 *    （側欄寬度）是透明的，點得到底下的東西。
 *
 * ## 它會把 toast 往上推
 * `UiToastHost` 也貼在畫面下緣而且 z-index 更高，不處理的話「已自動儲存」
 * 會正好蓋住分頁列。掛載時設一個 `--bottom-bar` 的 CSS 變數，卸載時清掉，
 * toast 的內距自己加上去（見 `UiToastHost`）。
 */
defineProps<{
  tabs: ReadonlyArray<{ key: T; label: string; icon: string }>
}>()

const model = defineModel<T>({ required: true })

/** 和 `h-16` 對應。改高度的時候兩個要一起改。 */
const BAR_HEIGHT = '4rem'

onMounted(() => document.documentElement.style.setProperty('--bottom-bar', BAR_HEIGHT))
onBeforeUnmount(() => document.documentElement.style.removeProperty('--bottom-bar'))
</script>

<template>
  <!-- 佔位：讓最後一段內容捲得出來，不會永遠躲在分頁列底下 -->
  <div class="h-[calc(4rem+env(safe-area-inset-bottom))]" aria-hidden="true" />

  <div class="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center">
    <div class="w-full max-w-[100rem] md:pl-60">
      <nav
        class="pointer-events-auto border-t border-border bg-surface pb-[env(safe-area-inset-bottom)]"
        role="tablist"
        aria-label="比賽管理分頁"
      >
        <!--
          圖示旁邊留一行小字。純圖示看起來乾淨，但「打線」和「逐局紀錄」
          沒有大家都認得的符號 —— 少了字，第一次用的人得一個一個點開試。

          （註解放在 `v-for` 外面：模板註解會原樣渲染進 HTML，寫在迴圈裡
          等於同一段文字在 SSR 輸出裡重複五次。）
        -->
        <div class="flex h-16 items-stretch">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            type="button"
            role="tab"
            :aria-selected="model === tab.key"
            :aria-label="tab.label"
            class="flex flex-1 flex-col items-center justify-center gap-0.5 border-t-2 transition"
            :class="
              model === tab.key
                ? 'border-brand-600 text-brand-600 dark:text-brand-300'
                : 'border-transparent text-content-muted hover:text-content'
            "
            @click="model = tab.key"
          >
            <span class="text-xl leading-none" aria-hidden="true">{{ tab.icon }}</span>
            <span class="text-[0.625rem] leading-none font-medium">{{ tab.label }}</span>
          </button>
        </div>
      </nav>
    </div>
  </div>
</template>
