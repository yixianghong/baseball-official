import type { Ref } from 'vue'

/**
 * 「把頭像拖到球隊上」的互動（限期活動，見 `docs/ws-bracket.md`）。
 *
 * ## 為什麼是 Pointer Events 而不是 HTML5 拖放
 * `draggable="true"` 那一套在 **iOS Safari 上完全不會觸發** —— 而這支球隊
 * 的人幾乎都是拿手機開網站的，等於做了一個一半的人用不了的功能。
 * Pointer Events 滑鼠與觸控共用同一組事件，寫一次兩邊都對。
 *
 * ## 同時支援「點兩下」
 * 拖曳不是唯一的路徑：點一下頭像選起來、再點一下球隊也算下注。
 * 這不只是方便 —— 鍵盤使用者只有這條路可以走，而拖曳在橫向捲動的樹狀圖上
 * 本來就容易手滑。兩種操作共用同一個 `place()`，規則不會有兩套。
 *
 * ## 拖到邊緣會自動捲動
 * 樹狀圖比手機螢幕寬，畫面上看不到的球隊本來就拖不過去。
 * 捲動用 `requestAnimationFrame` 持續跑，不是靠 `pointermove` ——
 * 手指停在邊緣不動時不會有 move 事件，捲動就會停住。
 */

export interface BetDragSource {
  playerId: string
  playerName: string
  playerNumber: string
  photoUrl: string
}

/** 手指移動不到這個距離就當成「點一下」，不是拖曳。 */
const DRAG_THRESHOLD_PX = 12

/** 離可視範圍的邊緣多近就開始自動捲動。 */
const EDGE_PX = 56
const EDGE_SPEED_PX_PER_FRAME = 14

export function useWsBetDrag(options: {
  /** 放開（或點選）在一個可下注的球隊上時呼叫。 */
  onPlace: (source: BetDragSource, team: string) => void
  /** 橫向捲動的樹狀圖容器，拖到邊緣時自動捲。 */
  scroller: Ref<HTMLElement | null>
  /**
   * 蓋在畫面下緣的隊員列。
   *
   * ⚠️ 它不只是「一個會擋到東西的元素」—— 它定義了**樹狀圖真正看得見的下界**。
   * 少了它，自動捲動會把手指還停在隊員列裡的那一刻也算成「拖到容器左緣了」，
   * 於是**拿起最左邊那個人就會讓整張賽程圖自己滑走**（實測到的）。
   */
  keepClear: Ref<HTMLElement | null>
}) {
  /** 點選模式選起來的人。拖曳時不用它。 */
  const selected = ref<BetDragSource | null>(null)
  /** 正在被拖的人。`null` 代表沒有在拖。 */
  const dragging = ref<BetDragSource | null>(null)
  /** 拖曳中的指標座標（視窗座標），畫浮動頭像用。 */
  const pointer = ref({ x: 0, y: 0 })
  /** 指標底下那一隊的代碼。 */
  const hovered = ref<string | null>(null)

  let start = { x: 0, y: 0 }
  let source: BetDragSource | null = null
  let frame = 0
  /**
   * 剛剛那一次是拖曳，所以接下來那個 `click` 要吞掉。
   *
   * 拖曳結束時瀏覽器仍然會補一個 `click`（指標在同一個元素上放開時），
   * 而選取是綁在 `click` 上的 —— 不擋的話「拖曳下注」會順便把那個人選起來，
   * 畫面上多一圈金色外框，下一次點球隊就又下了一注。
   */
  let draggedJustNow = false

  function targetAt(x: number, y: number): string | null {
    const el = document.elementFromPoint(x, y)
    const slot = el?.closest<HTMLElement>('[data-bet-team]')
    // 已淘汰的球隊照樣標著 data-bet-team（畫面上還在），但不能當成落點
    if (!slot || slot.dataset.betDisabled === 'true') return null
    return slot.dataset.betTeam ?? null
  }

  /**
   * 樹狀圖**現在真正看得見**的那塊矩形。
   *
   * 不是容器自己的 `getBoundingClientRect()` —— 畫布有 780px 高，容器往往
   * 上下都超出視窗，而下緣還被隊員列蓋住一整條。自動捲動與「這裡能不能放」
   * 兩件事都要以這塊為準，否則會對著看不見的區域做判斷。
   */
  function visibleArea(): DOMRect | null {
    const el = scrollerEl()
    if (!el) return null

    const rect = el.getBoundingClientRect()
    const rosterTop = options.keepClear.value?.getBoundingClientRect().top ?? window.innerHeight

    const top = Math.max(rect.top, 0)
    const bottom = Math.min(rect.bottom, rosterTop)
    if (bottom <= top) return null

    return new DOMRect(rect.left, top, rect.width, bottom - top)
  }

  function autoScroll() {
    frame = requestAnimationFrame(autoScroll)
    if (!dragging.value) return

    const area = visibleArea()
    const el = scrollerEl()
    if (!area || !el) return

    const { x, y } = pointer.value
    // 手指還在隊員列裡（或整個畫布都被捲出視窗）就什麼都不做
    if (y < area.top || y > area.bottom) return

    // 橫向：畫布比視窗寬，看不到的球隊要靠這個才拖得過去
    if (x < area.left + EDGE_PX) el.scrollLeft -= EDGE_SPEED_PX_PER_FRAME
    else if (x > area.right - EDGE_PX) el.scrollLeft += EDGE_SPEED_PX_PER_FRAME

    // 直向捲的是**整個頁面**：畫布 780px 高，手機視窗扣掉隊員列往往只剩五百多
    if (y < area.top + EDGE_PX) window.scrollBy(0, -EDGE_SPEED_PX_PER_FRAME)
    else if (y > area.bottom - EDGE_PX) window.scrollBy(0, EDGE_SPEED_PX_PER_FRAME)
  }

  function scrollerEl(): HTMLElement | null {
    return options.scroller.value
  }

  function onMove(event: PointerEvent) {
    pointer.value = { x: event.clientX, y: event.clientY }

    if (!dragging.value) {
      const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y)
      if (moved < DRAG_THRESHOLD_PX) return
      dragging.value = source
      // 拖曳一開始就取消點選狀態，畫面上不要同時有兩個「正在進行的操作」
      selected.value = null
      frame = requestAnimationFrame(autoScroll)
    }

    hovered.value = targetAt(event.clientX, event.clientY)
  }

  function onUp(event: PointerEvent) {
    detach()

    const wasDragging = dragging.value
    dragging.value = null
    cancelAnimationFrame(frame)

    if (!source) return

    if (wasDragging) {
      const team = targetAt(event.clientX, event.clientY)
      if (team) options.onPlace(source, team)
      hovered.value = null
      draggedJustNow = true
    }

    /*
     * 沒有移動的情況**不在這裡**處理。
     *
     * 「點一下選起來」綁在 `click` 上而不是這裡 —— ⚠️ 鍵盤按 Enter／空白鍵
     * 只會發 `click`，**一個指標事件都不會發**。寫在這裡的話，鍵盤使用者
     * 永遠選不起任何人，而那是這個功能唯一不靠拖曳的路。
     */
    source = null
  }

  function onCancel() {
    detach()
    dragging.value = null
    hovered.value = null
    source = null
    cancelAnimationFrame(frame)
  }

  function detach() {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onCancel)
  }

  /** 綁在頭像上的 `@pointerdown`。 */
  function grab(event: PointerEvent, next: BetDragSource) {
    // 只接主鍵／單指。右鍵與多指留給瀏覽器自己處理
    if (event.button !== 0) return

    source = next
    start = { x: event.clientX, y: event.clientY }
    pointer.value = { x: event.clientX, y: event.clientY }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
  }

  /**
   * 點頭像（滑鼠、觸控、鍵盤都走這裡）。綁 `@click`，不是 `@pointerup`。
   *
   * 拖曳結束後瀏覽器補的那一個 `click` 會被吞掉，否則拖曳下注會順便把人選起來。
   */
  function toggle(next: BetDragSource) {
    if (draggedJustNow) {
      draggedJustNow = false
      return
    }
    selected.value = selected.value?.playerId === next.playerId ? null : next
  }

  /** 點球隊（點選模式與鍵盤都走這裡）。沒有選人時什麼都不做。 */
  function placeSelected(team: string) {
    if (!selected.value) return false
    options.onPlace(selected.value, team)
    selected.value = null
    return true
  }

  onBeforeUnmount(() => {
    detach()
    cancelAnimationFrame(frame)
  })

  return { selected, dragging, pointer, hovered, grab, toggle, placeSelected }
}
