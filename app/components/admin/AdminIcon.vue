<script setup lang="ts">
/**
 * 後台的線條圖示（`<AdminIcon name="…" />`）。
 *
 * 取代原本散在各處的 emoji。emoji 有三個問題，而且在後台都碰得到：
 *
 * - **每個平台長得不一樣**（iOS、Android、Windows 各一套），同一個分頁列在
 *   不同手機上看起來像不同的 App。
 * - **吃不到 `currentColor`**：分頁列選中時字變成品牌色，emoji 照舊是彩色的，
 *   選中狀態只剩那一行小字在表達。
 * - **字形基線與尺寸各自為政**，排在文字旁邊對不齊。
 *
 * 路徑取自 Lucide 的造型（ISC 授權）再簡化，全部畫在 24×24、2px 線寬上。
 * 只收這個專案用得到的那幾個 —— 不引整套圖示庫，後台一頁只用十來個。
 *
 * 預設大小跟著字級走（1.25em）。寫在 SVG 的 `width`／`height` **屬性**上而不是
 * class —— 屬性的權重最低，呼叫端給 `class="size-5"` 就會蓋過它；兩邊都用
 * class 的話，哪一個贏要看 Tailwind 產生的順序。
 *
 * 圖示一律是裝飾（`aria-hidden`）：意思由旁邊的文字承擔。少數只有圖示的
 * 按鈕要自己在按鈕上補 `aria-label`。
 */
const props = defineProps<{ name: AdminIconName }>()

type IconTag = 'path' | 'circle' | 'rect'

/** 每個圖示是一串 SVG 子元素：[標籤, 屬性]。 */
const ICONS = {
  dashboard: [
    ['rect', { x: '3', y: '3', width: '7', height: '9', rx: '1' }],
    ['rect', { x: '14', y: '3', width: '7', height: '5', rx: '1' }],
    ['rect', { x: '14', y: '12', width: '7', height: '9', rx: '1' }],
    ['rect', { x: '3', y: '16', width: '7', height: '5', rx: '1' }],
  ],
  baseball: [
    ['circle', { cx: '12', cy: '12', r: '10' }],
    ['path', { d: 'M6 4.9a12 12 0 0 1 0 14.2' }],
    ['path', { d: 'M18 4.9a12 12 0 0 0 0 14.2' }],
  ],
  users: [
    ['path', { d: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2' }],
    ['circle', { cx: '9', cy: '7', r: '4' }],
    ['path', { d: 'M22 21v-2a4 4 0 0 0-3-3.87' }],
    ['path', { d: 'M16 3.13a4 4 0 0 1 0 7.75' }],
  ],
  'user-check': [
    ['path', { d: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2' }],
    ['circle', { cx: '9', cy: '7', r: '4' }],
    ['path', { d: 'm16 11 2 2 4-4' }],
  ],
  megaphone: [
    ['path', { d: 'm3 11 18-5v12L3 14v-3z' }],
    ['path', { d: 'M11.6 16.8a3 3 0 1 1-5.8-1.6' }],
  ],
  bell: [
    ['path', { d: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9' }],
    ['path', { d: 'M10.3 21a1.94 1.94 0 0 0 3.4 0' }],
  ],
  'bell-off': [
    ['path', { d: 'M8.7 3A6 6 0 0 1 18 8a21.3 21.3 0 0 0 .6 5' }],
    ['path', { d: 'M17 17H3s3-2 3-9a4.67 4.67 0 0 1 .3-1.7' }],
    ['path', { d: 'M10.3 21a1.94 1.94 0 0 0 3.4 0' }],
    ['path', { d: 'm2 2 20 20' }],
  ],
  trophy: [
    ['path', { d: 'M6 9H4.5a2.5 2.5 0 0 1 0-5H6' }],
    ['path', { d: 'M18 9h1.5a2.5 2.5 0 0 0 0-5H18' }],
    ['path', { d: 'M4 22h16' }],
    ['path', { d: 'M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22' }],
    ['path', { d: 'M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22' }],
    ['path', { d: 'M18 2H6v7a6 6 0 0 0 12 0V2Z' }],
  ],
  settings: [
    ['path', { d: 'M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4' }],
  ],
  home: [
    ['path', { d: 'm3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' }],
    ['path', { d: 'M9 22V12h6v10' }],
  ],
  moon: [['path', { d: 'M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z' }]],
  sun: [
    ['circle', { cx: '12', cy: '12', r: '4' }],
    [
      'path',
      {
        d: 'M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41',
      },
    ],
  ],
  logout: [
    ['path', { d: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4' }],
    ['path', { d: 'm16 17 5-5-5-5' }],
    ['path', { d: 'M21 12H9' }],
  ],
  upload: [
    ['path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }],
    ['path', { d: 'm17 8-5-5-5 5' }],
    ['path', { d: 'M12 3v12' }],
  ],
  camera: [
    [
      'path',
      {
        d: 'M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z',
      },
    ],
    ['circle', { cx: '12', cy: '13', r: '3' }],
  ],
  pencil: [['path', { d: 'M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z' }]],
  clipboard: [
    ['rect', { x: '8', y: '2', width: '8', height: '4', rx: '1' }],
    ['path', { d: 'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2' }],
    ['path', { d: 'M9 12h6M9 16h4' }],
  ],
  'list-ordered': [
    ['path', { d: 'M10 6h11M10 12h11M10 18h11' }],
    ['path', { d: 'M4 6h1v4' }],
    ['path', { d: 'M4 10h2' }],
    ['path', { d: 'M6 18H4c0-1 2-2 2-3s-1-1.5-2-1' }],
  ],
  clapperboard: [
    ['path', { d: 'M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z' }],
    ['path', { d: 'm6.2 5.3 3.1 3.9' }],
    ['path', { d: 'm12.4 3.4 3.1 4' }],
    ['path', { d: 'M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z' }],
  ],
  video: [
    ['path', { d: 'm16 13 5.2 3.5a.5.5 0 0 0 .8-.4V7.9a.5.5 0 0 0-.8-.4L16 11' }],
    ['rect', { x: '2', y: '6', width: '14', height: '12', rx: '2' }],
  ],
  search: [
    ['circle', { cx: '11', cy: '11', r: '8' }],
    ['path', { d: 'm21 21-4.3-4.3' }],
  ],
  image: [
    ['rect', { x: '3', y: '3', width: '18', height: '18', rx: '2' }],
    ['circle', { cx: '9', cy: '9', r: '2' }],
    ['path', { d: 'm21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21' }],
  ],
  x: [['path', { d: 'M18 6 6 18M6 6l12 12' }]],
  check: [['path', { d: 'M20 6 9 17l-5-5' }]],
  sparkles: [
    ['path', { d: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z' }],
    ['path', { d: 'M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z' }],
  ],
  mic: [
    ['rect', { x: '9', y: '2', width: '6', height: '12', rx: '3' }],
    ['path', { d: 'M19 10v2a7 7 0 0 1-14 0v-2' }],
    ['path', { d: 'M12 19v3' }],
  ],
  folder: [
    [
      'path',
      {
        d: 'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z',
      },
    ],
  ],
  lock: [
    ['rect', { x: '3', y: '11', width: '18', height: '11', rx: '2' }],
    ['path', { d: 'M7 11V7a5 5 0 0 1 10 0v4' }],
  ],
  plus: [['path', { d: 'M12 5v14M5 12h14' }]],
} as const satisfies Record<string, ReadonlyArray<readonly [IconTag, Record<string, string>]>>

export type AdminIconName = keyof typeof ICONS

const elements = computed(() => ICONS[props.name])
</script>

<template>
  <svg
    class="shrink-0"
    width="1.25em"
    height="1.25em"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <component :is="tag" v-for="([tag, attrs], i) in elements" :key="i" v-bind="attrs" />
  </svg>
</template>
