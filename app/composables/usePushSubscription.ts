import type { PushSubscriptionJSON } from '~/composables/api/usePushApi'
import { isSameApplicationServerKey, urlBase64ToUint8Array } from '~/utils/push-key'

/**
 * 瀏覽器端的推播訂閱狀態。
 *
 * ## 狀態比想像中多
 * 「訂閱推播」不是開關兩個狀態，中間有好幾種「想開也開不了」的情況，
 * 每一種要對使用者講的話都不一樣。把它們攤成一個列舉，UI 才不會變成
 * 一堆互相矛盾的 `v-if`。
 *
 * ```
 * unavailable   站台沒設定 VAPID 金鑰 → 功能整個不顯示
 * unsupported   瀏覽器不支援（桌面 Safari 舊版、某些內嵌瀏覽器）
 * needs-install iOS 專屬：必須先「加入主畫面」，在分頁裡永遠訂閱不了
 * denied        使用者拒絕過通知權限 → 只能請他去瀏覽器設定改
 * off           可以訂閱，還沒訂
 * on            已訂閱
 * ```
 */
export type PushState = 'unavailable' | 'unsupported' | 'needs-install' | 'denied' | 'off' | 'on'

export function usePushSubscription() {
  const { public: publicConfig } = useRuntimeConfig()
  const { subscribe, unsubscribe } = usePushSubscriptionActions()

  const state = ref<PushState>('unavailable')
  const busy = ref(false)
  const message = ref('')

  /** 已訂閱時保留 endpoint，退訂時要送回後端。 */
  const endpoint = ref('')

  const isBusy = computed(() => busy.value)

  onMounted(async () => {
    await refresh()
  })

  async function refresh(): Promise<void> {
    if (!publicConfig.vapidPublicKey) {
      state.value = 'unavailable'
      return
    }

    if (
      !('serviceWorker' in navigator) ||
      !('PushManager' in window) ||
      !('Notification' in window)
    ) {
      // iOS 在「還沒加入主畫面」的分頁裡就是這個情況，訊息要講得具體
      state.value = isIosSafari() ? 'needs-install' : 'unsupported'
      return
    }

    if (Notification.permission === 'denied') {
      state.value = 'denied'
      return
    }

    const registration = await navigator.serviceWorker.getRegistration()
    const existing = await registration?.pushManager.getSubscription()

    // 用舊 VAPID 公鑰建立的訂閱等同失效：伺服器已經簽不出它認得的推播了
    if (
      existing &&
      !isSameApplicationServerKey(
        existing.options.applicationServerKey,
        publicConfig.vapidPublicKey,
      )
    ) {
      state.value = 'off'
      return
    }

    if (existing) {
      endpoint.value = existing.endpoint
      state.value = 'on'
      return
    }

    state.value = 'off'
  }

  /**
   * 清掉用舊 VAPID 公鑰建立的訂閱。
   *
   * 不先退掉的話，接下來用新公鑰呼叫 `subscribe()` 會拋 `InvalidStateError`——
   * 規格不允許同一個 registration 存在兩個不同 applicationServerKey 的訂閱。
   */
  async function dropStaleSubscription(registration: ServiceWorkerRegistration): Promise<void> {
    const existing = await registration.pushManager.getSubscription()
    if (!existing) return
    if (
      isSameApplicationServerKey(existing.options.applicationServerKey, publicConfig.vapidPublicKey)
    )
      return

    const staleEndpoint = existing.endpoint
    await existing.unsubscribe()
    // 後端那筆也要清掉，否則會一直對一個永遠送不成功的 endpoint 重試
    await unsubscribe(staleEndpoint).catch(() => undefined)
  }

  /**
   * 開啟通知。
   *
   * `Notification.requestPermission()` **必須由使用者的點擊觸發**，
   * 不能在頁面載入時自己呼叫 —— 瀏覽器會直接忽略，而且反覆嘗試會讓
   * 這個網站被列入「濫用通知」名單。所以這個函式只從按鈕呼叫。
   */
  async function enable(): Promise<void> {
    busy.value = true
    message.value = ''

    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        state.value = permission === 'denied' ? 'denied' : 'off'
        message.value = '你沒有允許通知權限'
        return
      }

      // SW 可能還在註冊中。ready 會等到它啟用為止。
      const registration = await navigator.serviceWorker.ready
      await dropStaleSubscription(registration)

      const subscription = await registration.pushManager.subscribe({
        // 規格要求：收到推播就一定要顯示通知。靜默推播不允許。
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicConfig.vapidPublicKey),
      })

      await subscribe(subscription.toJSON() as PushSubscriptionJSON, navigator.userAgent)

      endpoint.value = subscription.endpoint
      state.value = 'on'
      message.value = '已開啟，有新公告時會通知你'
    } catch (error) {
      message.value = '開啟失敗，請稍後再試'
      console.error('[push] 訂閱失敗', error)
      await refresh()
    } finally {
      busy.value = false
    }
  }

  /**
   * 關閉通知。
   *
   * 順序是「先退瀏覽器的訂閱，再通知後端」。反過來的話，後端刪掉了、
   * 瀏覽器那邊還留著，使用者就進入一個「顯示已關閉但實際還訂著」的狀態，
   * 而且再也沒辦法從介面上修好。
   */
  async function disable(): Promise<void> {
    busy.value = true
    message.value = ''

    try {
      const registration = await navigator.serviceWorker.getRegistration()
      const subscription = await registration?.pushManager.getSubscription()
      const target = subscription?.endpoint ?? endpoint.value

      if (subscription) await subscription.unsubscribe()
      if (target) await unsubscribe(target)

      endpoint.value = ''
      state.value = 'off'
      message.value = '已關閉通知'
    } catch (error) {
      message.value = '關閉失敗，請稍後再試'
      console.error('[push] 退訂失敗', error)
      await refresh()
    } finally {
      busy.value = false
    }
  }

  return { state, isBusy, message, enable, disable, refresh }
}

/**
 * iOS 的 Safari（含所有 iOS 上的瀏覽器 —— 它們底層都是 WebKit）。
 *
 * 用 `maxTouchPoints` 一起判斷是因為 iPad 從 iPadOS 13 起預設回報
 * 桌面版的 user agent，只看 `iPhone|iPad` 會漏掉 iPad。
 */
function isIosSafari(): boolean {
  const ua = navigator.userAgent
  const isIos =
    /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1)
  return isIos
}
