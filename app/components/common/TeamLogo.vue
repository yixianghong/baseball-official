<script setup lang="ts">
/**
 * 隊徽／隊名字標。
 *
 * ## 為什麼是「固定高度、寬度自適應」
 * 球隊的識別圖不一定是方的。像 `MERCS` 這種橫式字標（wordmark）寬高比接近
 * 3:1，若塞進一個正方形容器再 `object-contain`，圖會被縮到只剩容器的三分之一高，
 * 周圍全是空白 —— 看起來就像圖破了。
 *
 * 改成只固定高度、寬度讓圖自己決定，方形徽章與橫式字標就都能正常呈現，
 * 網站也不必為了配合圖片而規定「請給我方形的」。
 *
 * ## 沒有圖片時
 * 顯示隊名首字的圓形標記，尺寸與圖片版一致，版面不會因為還沒上傳而塌掉。
 */
withDefaults(
  defineProps<{
    name: string
    logoUrl?: string
    size?: 'sm' | 'md' | 'lg'
    /** 深色底上使用（導覽列、頁尾）。影響沒有圖片時的佔位配色。 */
    onDark?: boolean
    /**
     * 墊一塊白色底板。白底或淺底的隊徽放在深色列上會是一塊突兀的方塊，
     * 加上底板之後看起來就是刻意的徽章牌。由後台的「網站設定」控制。
     */
    plate?: boolean
  }>(),
  { size: 'md', onDark: false, plate: false },
)

/** 有底板時要留一點內距，圖才不會頂到邊緣。 */
const plateClasses: Record<string, string> = {
  sm: 'rounded-md bg-white p-1',
  md: 'rounded-lg bg-white p-1.5',
  lg: 'rounded-xl bg-white p-2',
}

/** 高度固定、寬度自適應；`max-w` 防止超寬的圖把導覽列撐爆。 */
const imageClasses: Record<string, string> = {
  sm: 'h-8 max-w-32',
  md: 'h-10 max-w-44 lg:h-12 lg:max-w-56',
  lg: 'h-16 max-w-72',
}

const fallbackClasses: Record<string, string> = {
  sm: 'size-8 text-sm',
  md: 'size-10 text-lg lg:size-12 lg:text-xl',
  lg: 'size-16 text-2xl',
}
</script>

<template>
  <img
    v-if="logoUrl"
    :src="logoUrl"
    :alt="`${name} 隊徽`"
    class="w-auto object-contain"
    :class="[imageClasses[size], plate ? plateClasses[size] : '']"
  />

  <span
    v-else
    class="flex shrink-0 items-center justify-center rounded-full border-2 font-black"
    :class="[
      fallbackClasses[size],
      onDark ? 'border-accent-500 text-accent-400' : 'border-brand-600 text-brand-700',
    ]"
    aria-hidden="true"
  >
    {{ name.charAt(0) }}
  </span>
</template>
