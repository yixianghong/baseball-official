<script setup lang="ts">
/**
 * 區塊標題：英文大標 ＋ 中文副標，右側可放「查看全部」。
 *
 * 職業球團官網常見的雙語標題形式。英文負責視覺節奏（字距拉開、粗體），
 * 中文負責實際閱讀 —— 兩者疊在一起比單獨一行中文有份量得多。
 *
 * 左側那條粗色線是整站區塊的共同起手式，讓各個段落有一致的視覺韻律。
 */
defineProps<{ en: string; zh: string; to?: string; linkLabel?: string }>()
</script>

<template>
  <div class="mb-6 flex flex-wrap items-end justify-between gap-4">
    <div class="border-l-4 border-accent-500 pl-4">
      <p class="text-fluid-xl font-black tracking-widest text-brand-700 dark:text-brand-300">
        {{ en }}
      </p>
      <h2 class="text-fluid-sm font-semibold text-content-muted">{{ zh }}</h2>
    </div>

    <NuxtLink
      v-if="to"
      :to="to"
      class="text-fluid-sm font-semibold text-brand-600 transition hover:text-brand-700 dark:text-brand-300"
    >
      {{ linkLabel ?? '查看全部' }} →
    </NuxtLink>
  </div>
</template>
