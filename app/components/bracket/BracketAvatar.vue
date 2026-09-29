<script setup lang="ts">
/**
 * 隊員的圓形小頭像。下注列、樹狀圖上的下注堆、彩池統計都用同一個。
 *
 * 沒有照片時畫背號 —— 不是灰色剪影。這個活動裡頭像是**識別用**的，
 * 而球隊裡沒有人是靠一個通用剪影被認出來的，背號才是。
 */
const props = withDefaults(
  defineProps<{
    name: string
    number?: string
    photoUrl?: string
    /** 疊在右下角的數字，代表這個人在這一隊押了幾注。1 注時不顯示。 */
    count?: number
    size?: 'sm' | 'md' | 'lg'
    /** 已選取（點選下注模式）。 */
    selected?: boolean
  }>(),
  { number: '', photoUrl: '', count: 1, size: 'md', selected: false },
)

const SIZES = {
  sm: 'size-7 text-[10px]',
  md: 'size-11 text-xs',
  lg: 'size-14 text-sm',
} as const

const ring = computed(() =>
  props.selected ? 'ring-3 ring-accent-400 ring-offset-2 ring-offset-surface' : 'ring-2 ring-white',
)
</script>

<template>
  <span class="relative inline-flex shrink-0">
    <span
      class="flex items-center justify-center overflow-hidden rounded-full bg-ink font-bold text-white shadow-md transition"
      :class="[SIZES[size], ring]"
    >
      <img
        v-if="photoUrl"
        :src="photoUrl"
        :alt="`${name} 的頭像`"
        loading="lazy"
        draggable="false"
        class="size-full object-cover"
      />
      <span v-else class="tabular-nums">{{ number || name.slice(0, 1) }}</span>
    </span>

    <span
      v-if="count > 1"
      class="absolute -bottom-1 -right-1 flex min-w-4.5 items-center justify-center rounded-full bg-accent-500 px-1 text-[10px] font-black text-ink shadow"
    >
      ×{{ count }}
    </span>
  </span>
</template>
