/**
 * 浮動提示（toast）。
 *
 * 給「做完了」「沒做成」這種**短暫、不需要使用者回應**的訊息用。
 * 它固定在畫面角落，所以和內容捲到哪裡無關 —— 這是它取代行內狀態文字的
 * 主要理由：後台的編輯頁很長，釘在表單上方的「已自動儲存」在使用者捲到
 * 計分板時完全看不到，而那正是他最想確認的時候。
 *
 * ## 不適用的情況
 * - **需要使用者做決定的事不要用 toast** —— 它會自己消失。刪除確認、
 *   離開頁面的警告要用當下的 UI（`AdminDeleteButton`、`beforeunload`）。
 * - **欄位級的錯誤不要用 toast** —— 那要顯示在那個欄位旁邊，
 *   使用者才知道是哪一格有問題（`UiBaseInput` 的 `error`）。
 * - **整頁載入失敗不要用 toast** —— 那要用 `UiBaseError` 佔住版面並提供重試，
 *   否則畫面上是一片空白加一則會消失的訊息。
 *
 * @example
 * ```ts
 * const toast = useToast()
 * toast.show({ tone: 'success', message: '已建立公告' })
 * toast.show({
 *   tone: 'error',
 *   message: '上傳失敗',
 *   action: { label: '重試', handler: () => upload() },
 * })
 * ```
 */
export type ToastTone = 'success' | 'error' | 'info'

export interface ToastAction {
  label: string
  /** 回傳 Promise 時，按鈕在等待期間會顯示載入中並停用（見 `ToastHost.vue`）。 */
  handler: () => unknown
}

export interface ToastOptions {
  message: string
  tone?: ToastTone
  /** 幾毫秒後自動關閉，`0` 代表不會自己消失。預設見 `DEFAULT_DURATION`。 */
  duration?: number
  action?: ToastAction
  /**
   * 同一個 `key` 的提示會**就地取代**前一則，不會疊成一串。
   *
   * 會重複發生的提示（自動儲存、上傳進度）一定要給 key，否則連續操作
   * 十次就有十則一模一樣的訊息從畫面下方長出來。
   */
  key?: string
}

export interface Toast extends ToastOptions {
  id: number
  tone: ToastTone
  duration: number
}

/**
 * 畫面上最多同時存在幾則，超過就丟掉最舊的。
 *
 * 沒有上限的話，一連串失敗（球場網路不穩時是常態）會把整個畫面糊掉，
 * 而底下那幾則講的通常是同一件事。
 */
const MAX_TOASTS = 3

const DEFAULT_DURATION: Record<ToastTone, number> = {
  success: 2_500,
  info: 4_000,
  /** 失敗不自己消失 —— 沒被看到的錯誤等於沒發生過。 */
  error: 0,
}

/**
 * 自動關閉的計時器。
 *
 * 放在模組層而不是狀態裡：`setTimeout` 的 handle 不能序列化進 SSR payload，
 * 而且只有瀏覽器會用到（`show()` 只在 client 設計時器）。
 */
const timers = new Map<number, ReturnType<typeof setTimeout>>()

/** id 只需要唯一，不需要在 SSR 與瀏覽器之間一致（伺服器端不會有任何提示）。 */
let nextId = 0

export function useToast() {
  const toasts = useState<Toast[]>('toasts', () => [])

  function clearTimer(id: number): void {
    const timer = timers.get(id)
    if (timer === undefined) return
    clearTimeout(timer)
    timers.delete(id)
  }

  function dismiss(id: number): void {
    clearTimer(id)
    const index = toasts.value.findIndex((toast) => toast.id === id)
    if (index !== -1) toasts.value.splice(index, 1)
  }

  function show(options: ToastOptions): number {
    const tone = options.tone ?? 'info'
    nextId += 1

    const toast: Toast = {
      ...options,
      id: nextId,
      tone,
      // 有按鈕的提示一律不自動關閉 —— 手還沒伸到按鈕它就消失了，
      // 使用者只會看到「剛剛那個東西不見了」，而且不知道要去哪裡找。
      duration: options.duration ?? (options.action ? 0 : DEFAULT_DURATION[tone]),
    }

    const replacing = options.key ? toasts.value.findIndex((item) => item.key === options.key) : -1

    if (replacing !== -1) {
      // 就地取代，位置不動：否則「儲存失敗 → 已自動儲存」會在畫面上跳一下
      const [previous] = toasts.value.splice(replacing, 1, toast)
      if (previous) clearTimer(previous.id)
    } else {
      toasts.value.push(toast)
      while (toasts.value.length > MAX_TOASTS) {
        const oldest = toasts.value.shift()
        if (oldest) clearTimer(oldest.id)
      }
    }

    if (import.meta.client && toast.duration > 0) {
      timers.set(
        toast.id,
        setTimeout(() => dismiss(toast.id), toast.duration),
      )
    }

    return toast.id
  }

  return { toasts, show, dismiss }
}
