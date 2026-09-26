import { ApiError } from '~/utils/api-error'

/**
 * 自動儲存。
 *
 * 後台的編輯畫面不該要求使用者記得按儲存 —— 尤其是出席登記這種「點十幾下、
 * 每下都是一個獨立決定」的操作，按鈕只是多一個會忘記的步驟。
 *
 * ## 它處理掉的四件事
 *
 * ### 1. 不是每次改動都送一次請求
 * 輸入框每打一個字就寫一次資料庫，會讓 Firestore 的寫入次數（與費用）暴增，
 * 也容易撞上限流。這裡用 debounce：停止操作 `delay` 毫秒之後才真的送出。
 *
 * ### 2. 離開前把還沒送出的變更送完
 * debounce 期間離開頁面，那段變更就消失了 —— 而且使用者完全不會知道。
 * 元件卸載與換頁時會先 flush，瀏覽器關閉／重新整理則用 `beforeunload` 提醒。
 *
 * ### 3. 狀態要看得見
 * 自動儲存最危險的地方是「以為存好了，其實沒有」。所以狀態變化會**自己送出
 * toast**（`useToast`），使用這個 composable 的頁面不必、也不該再做一次：
 *
 * | 狀態 | 提示 |
 * | --- | --- |
 * | `saved` | 「已自動儲存」，2.5 秒後自己消失 |
 * | `error` | 「儲存失敗：…」，**不會自己消失**，附一顆「重試」 |
 * | `pending`／`saving` | 不提示 |
 *
 * 用 toast 而不是釘在表單上方的一行字：後台的編輯頁很長，使用者捲到計分板
 * 的時候看不到頁首那一行，而那正是最想確認「到底存進去了沒有」的時候。
 *
 * `pending` 與 `saving` 通常只持續幾百毫秒，替它們發提示的結果是每次打字
 * 停頓畫面都閃一下。「還沒存完就離開」不靠使用者看到提示來擋，
 * 而是 `flush()` 與 `beforeunload`（見下面兩點）。
 *
 * 所有提示共用同一個 key，所以連續儲存是**同一則訊息就地更新**，
 * 不會從畫面下方長出一串一模一樣的「已自動儲存」。
 *
 * ### 4. 載入當下不會寫入
 * 只有「載入之後」的變更才算數，否則光是打開頁面就會寫一次資料庫。
 *
 * @example
 * ```ts
 * const autosave = useAutosave(
 *   () => ({ attendance: attendance.value }),
 *   (payload) => updateGame(gameId.value, payload),
 * )
 * ```
 */
export type AutosaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error'

/** 全站的自動儲存共用同一則提示（見上面的說明）。 */
const TOAST_KEY = 'autosave'

export function useAutosave<T>(
  source: () => T,
  save: (value: T) => Promise<unknown>,
  options: {
    /** 停止操作多久之後才送出，預設 900ms。 */
    delay?: number
    /** 回傳 false 時暫停自動儲存（例如資料還沒載入完）。 */
    enabled?: () => boolean
  } = {},
) {
  const { delay = 900, enabled } = options

  const toast = useToast()
  const status = ref<AutosaveStatus>('idle')
  const error = ref<ApiError | null>(null)
  /** 最後一次成功寫入的內容，用來判斷有沒有真的變過。 */
  const savedSnapshot = ref<string>('')
  const initialized = ref(false)

  let timer: ReturnType<typeof setTimeout> | undefined
  let inFlight: Promise<void> | null = null

  const serialize = (value: T) => JSON.stringify(value)

  /** 記錄目前的內容為「已儲存」，不送出任何請求。載入資料後呼叫。 */
  function markAsSaved() {
    savedSnapshot.value = serialize(source())
    initialized.value = true
    status.value = 'idle'
    error.value = null
  }

  /** 是否還有沒送出的變更。 */
  const isDirty = computed(() => initialized.value && serialize(source()) !== savedSnapshot.value)

  async function persist(): Promise<void> {
    const snapshot = serialize(source())
    if (snapshot === savedSnapshot.value) return

    status.value = 'saving'
    error.value = null

    try {
      await save(source())
      // 用送出當下的快照，而不是回來時的 —— 儲存期間使用者可能又改了東西，
      // 那些變更必須繼續被視為未儲存。
      savedSnapshot.value = snapshot
      status.value = serialize(source()) === snapshot ? 'saved' : 'pending'
      if (status.value === 'pending') schedule()
    } catch (err) {
      error.value = ApiError.from(err)
      status.value = 'error'
    }
  }

  function schedule() {
    clearTimeout(timer)
    timer = setTimeout(() => {
      inFlight = persist().finally(() => {
        inFlight = null
      })
    }, delay)
  }

  /** 立刻送出還沒送出的變更（換頁、卸載時使用）。 */
  async function flush(): Promise<void> {
    clearTimeout(timer)
    if (inFlight) await inFlight
    if (isDirty.value) await persist()
  }

  /** 失敗後重試。 */
  async function retry(): Promise<void> {
    await persist()
  }

  /**
   * 狀態變化 → 提示。
   *
   * 寫在 composable 裡而不是交給頁面：自動儲存的呈現方式全站一致，
   * 而且「新增一個自動儲存的畫面時忘記把狀態顯示出來」是這個功能最貴的
   * 漏接 —— 症狀是使用者以為存好了。
   *
   * `markAsSaved()` 把狀態設成 `idle` 而不是 `saved`，所以光是打開頁面
   * 不會冒出一則「已自動儲存」。
   */
  watch(status, (next) => {
    if (next === 'saved') {
      toast.show({ key: TOAST_KEY, tone: 'success', message: '已自動儲存' })
      return
    }

    if (next === 'error') {
      toast.show({
        key: TOAST_KEY,
        tone: 'error',
        message: `儲存失敗${error.value ? `：${error.value.message}` : ''}`,
        // 重試的等待狀態由 `ToastHost` 自己處理（按鈕會停用），
        // 所以這裡不必再管一個 loading 旗標
        action: { label: '重試', handler: retry },
      })
    }
  })

  watch(
    source,
    () => {
      if (!initialized.value) return
      if (enabled && !enabled()) return
      if (!isDirty.value) return

      status.value = 'pending'
      schedule()
    },
    { deep: true },
  )

  // 換頁前先把變更送完
  onBeforeRouteLeave(async () => {
    await flush()
  })

  onBeforeUnmount(() => {
    clearTimeout(timer)
    void flush()
  })

  // 關閉分頁或重新整理時，瀏覽器不會等待非同步的儲存完成，
  // 所以只能提醒使用者，讓他自己決定要不要等一下。
  if (import.meta.client) {
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!isDirty.value && status.value !== 'error') return
      event.preventDefault()
    }
    window.addEventListener('beforeunload', warnBeforeUnload)
    onBeforeUnmount(() => window.removeEventListener('beforeunload', warnBeforeUnload))
  }

  return {
    /** `idle` 沒有變更／`pending` 等待送出／`saving` 送出中／`saved` 已儲存／`error` 失敗。 */
    status,
    error,
    isDirty,
    markAsSaved,
    flush,
    retry,
  }
}
