<script setup lang="ts">
/**
 * 表格列的操作選單（⋮ 點開）。
 *
 * ## 為什麼不是一排按鈕
 * 後台的表格在手機上是橫向捲動的（`min-w-max`）。操作按鈕排在最後一欄時，
 * 手機使用者得**先把整張表往左拖到底**才看得到「編輯」與「刪除」——
 * 而那正是他點進這一頁要做的事。收成一顆圖示之後只佔一格的寬度，
 * 才塞得進黏在邊緣的欄位（`sticky right-0`，見 `pages/admin/games/index.vue`）。
 *
 * ## ⚠️ 選單一定要 teleport 出去
 * 它的容器是 `overflow-x-auto`。CSS 規定**只要有一軸不是 `visible`，
 * 另一軸就不會是 `visible`** —— 所以絕對定位的選單會被上下裁掉，
 * 或是讓容器長出一條多餘的垂直捲軸。這不是加 `z-index` 能解決的事。
 *
 * 所以選單是 `position: fixed` 並 teleport 到 `body`，座標由觸發鈕的
 * `getBoundingClientRect()` 當下算出來。代價是它不會跟著捲動走，
 * 因此**捲動就關閉** —— 那比讓選單浮在錯誤的位置上好。
 *
 * ## 二次確認直接做在選項裡
 * 刪除這類不可逆的動作，按第一下只會把文字換成 `confirmLabel`，
 * 再按一下才真的執行（和 `AdminDeleteButton` 同一個設計，理由見那裡：
 * 原生 `confirm()` 會凍結整個分頁）。選單一關就解除待確認狀態。
 */
interface RowMenuItem {
  label: string
  /** 有值代表要二次確認：按第一下先變成這句話。 */
  confirmLabel?: string
  /** 危險動作用紅字。 */
  danger?: boolean
  disabled?: boolean
  onSelect: () => void
}

const props = withDefaults(
  defineProps<{
    items: RowMenuItem[]
    /**
     * 觸發鈕的無障礙名稱。一張表裡有幾十顆一模一樣的 ⋮，
     * 只寫「操作」的話讀螢幕軟體念出來全都一樣 —— 要帶上這一列是誰。
     */
    label?: string
  }>(),
  { label: '操作' },
)

const open = ref(false)
/** 定位要等選單畫出來才量得到，量好之前先藏著，避免在左上角閃一下。 */
const placed = ref(false)
const position = reactive({ top: 0, left: 0 })
/** 哪一項正在等第二次點擊。關閉選單就歸零。 */
const armedIndex = ref(-1)

const triggerRef = ref<HTMLButtonElement | null>(null)
const menuRef = ref<HTMLElement | null>(null)

/** 視窗邊緣至少留這麼多，選單才不會貼著邊 */
const MARGIN = 8
const GAP = 4

function place() {
  const trigger = triggerRef.value?.getBoundingClientRect()
  const menu = menuRef.value?.getBoundingClientRect()
  if (!trigger || !menu) return

  // 預設開在按鈕下方；下面不夠就翻到上方，上下都不夠就貼著視窗底部
  let top = trigger.bottom + GAP
  if (top + menu.height > window.innerHeight - MARGIN) {
    const above = trigger.top - GAP - menu.height
    top = above >= MARGIN ? above : Math.max(MARGIN, window.innerHeight - MARGIN - menu.height)
  }

  /*
   * 預設靠左對齊觸發鈕；放不下就改成**靠右對齊觸發鈕**。
   *
   * 操作欄黏在表格右緣，所以實際上幾乎每次都走第二條 —— 選單會貼著 ⋮ 的
   * 右邊展開，而不是從畫面外硬擠回來。最後再夾一次邊界，視窗比選單還窄時
   * （極端的小螢幕）才不會跑出去。
   */
  let left = trigger.left
  if (left + menu.width > window.innerWidth - MARGIN) left = trigger.right - menu.width
  left = Math.min(left, window.innerWidth - MARGIN - menu.width)

  position.top = Math.round(top)
  position.left = Math.round(Math.max(MARGIN, left))
}

async function openMenu() {
  open.value = true
  placed.value = false
  await nextTick()
  place()
  placed.value = true

  // ⚠️ 還要再等一次：`visibility: hidden` 的元素**不能被 focus**，
  // `placed` 尚未寫進 DOM 的那一幀裡 `.focus()` 會靜靜地沒有作用。
  await nextTick()
  focusItem(0)
}

/**
 * 關閉。
 *
 * `returnFocus` 預設為真：用鍵盤操作的人按 Escape 之後，焦點必須回到那顆 ⋮，
 * 否則焦點會掉回 `<body>`，下一次 Tab 得從整頁的開頭重新走一遍。
 * 但「捲動」「點到別處」是滑鼠或手指的動作，硬把焦點搶回去反而會讓頁面跳。
 */
function close(returnFocus = true) {
  if (!open.value) return
  open.value = false
  armedIndex.value = -1
  if (returnFocus) triggerRef.value?.focus()
}

function select(index: number) {
  const item = props.items[index]
  if (!item || item.disabled) return

  if (item.confirmLabel && armedIndex.value !== index) {
    armedIndex.value = index
    return
  }

  close()
  item.onSelect()
}

/** 鍵盤在選單內上下移動 —— 這是 `role="menu"` 該有的行為。 */
function focusItem(index: number) {
  const buttons = menuRef.value?.querySelectorAll<HTMLButtonElement>('button:not([disabled])')
  if (!buttons?.length) return
  const target = (index + buttons.length) % buttons.length
  buttons[target]?.focus()
}

function moveFocus(step: number) {
  const buttons = Array.from(
    menuRef.value?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? [],
  )
  const current = buttons.findIndex((button) => button === document.activeElement)
  focusItem(current + step)
}

onKeyStroke('Escape', () => close())

/*
 * 選單是 `fixed` 的，所以它不會跟著捲動走 —— 一捲就會浮在錯誤的位置上。
 * 與其每一幀重算，不如直接關掉。
 *
 * `capture: true` 是必要的：`scroll` 事件**不會冒泡**，但會從 window 往下
 * 捕獲，所以只有捕獲階段聽得到表格容器自己的橫向捲動。
 */
onMounted(() => {
  useEventListener(window, 'scroll', () => close(false), { capture: true, passive: true })
  useEventListener(window, 'resize', () => close(false), { passive: true })
})
</script>

<template>
  <button
    ref="triggerRef"
    type="button"
    class="inline-flex size-9 items-center justify-center rounded-lg text-content-muted transition hover:bg-surface-muted hover:text-content"
    :class="open ? 'bg-surface-muted text-content' : ''"
    :aria-label="label"
    aria-haspopup="menu"
    :aria-expanded="open"
    @click="open ? close() : openMenu()"
  >
    <svg class="size-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path
        d="M12 7a2 2 0 1 1 0-4 2 2 0 0 1 0 4Zm0 7a2 2 0 1 1 0-4 2 2 0 0 1 0 4Zm0 7a2 2 0 1 1 0-4 2 2 0 0 1 0 4Z"
      />
    </svg>
  </button>

  <Teleport v-if="open" to="body">
    <!--
      整頁的遮罩，只為了「點到別處就關」。
      用真的元素而不是監聽 document 的點擊：iOS Safari 不會對沒有互動性的
      元素送出 click，`onClickOutside` 那條路在手機上會時靈時不靈。
    -->
    <div class="fixed inset-0 z-40" @click="close(false)" />

    <!--
      ⚠️ 選項的焦點外框要用 `-outline-offset-2`。全站的 `:focus-visible` 是
      `outline-offset: 2px`（外擴），而選單有 `overflow-hidden` 把圓角切乾淨 ——
      外擴的外框左右兩邊會被切掉，畫面上只剩上下兩條，看起來像多了一條線。
    -->
    <div
      ref="menuRef"
      class="surface-card fixed z-50 min-w-40 overflow-hidden rounded-xl border border-border bg-surface-raised py-1 shadow-lg"
      :class="placed ? '' : 'invisible'"
      :style="{ top: `${position.top}px`, left: `${position.left}px` }"
      role="menu"
      :aria-label="label"
      @keydown.down.prevent="moveFocus(1)"
      @keydown.up.prevent="moveFocus(-1)"
    >
      <button
        v-for="(item, index) in items"
        :key="item.label"
        type="button"
        role="menuitem"
        :disabled="item.disabled"
        class="flex min-h-11 w-full items-center px-4 text-left text-fluid-sm whitespace-nowrap transition focus-visible:-outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        :class="
          item.danger ? 'text-danger hover:bg-danger/10' : 'text-content hover:bg-surface-muted'
        "
        @click="select(index)"
      >
        {{ armedIndex === index && item.confirmLabel ? item.confirmLabel : item.label }}
      </button>
    </div>
  </Teleport>
</template>
