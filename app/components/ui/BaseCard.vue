<script setup lang="ts">
/**
 * 基礎卡片容器。提供 header / default / footer 三個插槽。
 */
withDefaults(defineProps<{ title?: string; padded?: boolean }>(), { padded: true })
</script>

<template>
  <!--
    不加 hover 效果：這是一個容器，本身不能點。邊框一變色就是在說「點我」，
    而點下去什麼都不會發生。要做成可以點的卡片，hover 寫在那個連結上。
  -->
  <article class="rounded-xl border border-border bg-surface-raised">
    <header v-if="title || $slots.header" class="border-b border-border px-5 py-4">
      <slot name="header">
        <h2 class="text-fluid-lg font-semibold">{{ title }}</h2>
      </slot>
    </header>

    <div :class="padded ? 'px-5 py-4' : ''">
      <slot />
    </div>

    <footer v-if="$slots.footer" class="border-t border-border px-5 py-3">
      <slot name="footer" />
    </footer>
  </article>
</template>
