<script setup lang="ts">
/**
 * 內頁頁首橫幅。
 *
 * 首頁有滿版主視覺，內頁若只放一行黑字標題，兩者看起來會像兩個網站。
 * 這條深藍橫幅用同樣的雙語標題語彙，讓每一頁一進來就有一致的識別，
 * 同時把內容與導覽列在視覺上分開。
 *
 * 高度刻意壓得比首頁主視覺矮很多 —— 內頁的主角是內容，不是橫幅。
 *
 * ## 放置位置
 * 必須放在 `.container-content` **外面**（版面的 `<main>` 沒有寬度限制），
 * 它才會自然貼齊視窗兩側。用負 margin 把它從容器裡「撐」出去看似也可以，
 * 但那要用 `100vw`，而 `100vw` 包含垂直捲軸的寬度，結果會橫向溢出十幾像素。
 */
defineProps<{ en: string; zh: string; description?: string }>()
</script>

<template>
  <section class="relative overflow-hidden bg-ink text-white">
    <div class="field-pattern absolute inset-0 opacity-70" aria-hidden="true" />

    <div class="container-content relative py-10 md:py-14">
      <p class="text-fluid-sm font-bold tracking-[0.3em] text-accent-400 uppercase">{{ en }}</p>
      <h1 class="mt-2 max-w-full text-fluid-2xl font-black break-words">{{ zh }}</h1>
      <span class="mt-4 block h-1 w-12 bg-accent-500" aria-hidden="true" />
      <p v-if="description" class="mt-4 max-w-2xl text-fluid-sm text-white/75">
        {{ description }}
      </p>
    </div>
  </section>
</template>
