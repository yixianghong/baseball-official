import type { Unsubscribe } from 'firebase/database'
import {
  BET_SLOTS,
  wsBetSchema,
  wsBracketConfigSchema,
  nextEmptySlot,
  type BetSlot,
  type WsBet,
} from '#shared/schemas/ws-bracket'

/**
 * 「預測世界大賽冠軍」的下注資料 —— **前端直接連 Realtime Database**。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ 這裡刻意違反全站的「前端完全不載入 Firebase SDK」紀律。
 *
 * 這是一個**限期的小遊戲活動**，整包設計成隨時可以拆掉（步驟見
 * `docs/ws-bracket.md`）。三個理由：
 *
 * 1. **要真的即時。** 下注時大家會同時開著頁面看，輪詢的幾秒延遲會讓
 *    「我剛剛按了，怎麼沒出現」變成常態。RTDB 的 `onValue` 是推送的。
 * 2. **資料要跟正式資料完全分家。** 它存在另一個資料庫（甚至可以是另一個
 *    Firebase 專案），跟 Firestore 上的比賽、球員、公告沒有任何交集 ——
 *    活動結束時把整棵 `bets` 節點刪掉就乾淨了，正式資料一個位元組都沒動到。
 * 3. **沒有前台登入系統。** 走 BFF 的話 BFF 也只能無條件放行，等於多寫一層
 *    什麼都沒擋住的端點。防線本來就只能是 RTDB 的安全規則。
 *
 * 那條規則是 `database.rules.json`：**沒鎖盤時任何人都能新增，也能移除任何
 * 一筆；沒有人能修改已經存在的那一筆；同一隊同一人最多一筆、一人最多兩筆**。
 * 下錯的注自己拿掉就好，管理者從 Firebase Console 處理的只剩極端狀況。
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ## 下注存在固定的兩個槽位，不是隨機 key
 * `ws-bracket/bets/{playerId}/slot1`／`slot2` —— **不是**用 `push()` 產生亂數
 * key，也不是用球隊代碼當 key。理由是 RTDB 的規則語言**沒有 `numChildren()`**
 * （這點是實測 `firebase deploy` 才發現的），唯一能擋住「這個人最多兩筆」的
 * 寫法，是把可能的鍵名寫死成 `slot1`／`slot2`、其餘一律拒絕。
 * `nextEmptySlot()`（`shared/schemas/ws-bracket.ts`）決定新的一注要寫進哪一格；
 * 「同一隊只能一筆」則是寫入時比對另一格現在存的球隊代碼，不再是路徑保證的。
 *
 * ## SDK 是動態載入的
 * `firebase/app` 與 `firebase/database` 加起來有幾十 KB，而全站只有這一頁
 * 用得到。`import()` 寫在 `onMounted` 裡，其他頁面一個位元組都不會載。
 * 順帶也解決了 SSR —— RTDB 的連線本來就只能在瀏覽器端建立。
 */

/** RTDB 上的節點名稱。整個活動的資料只有這一棵樹。 */
const ROOT_PATH = 'ws-bracket'
const BETS_PATH = `${ROOT_PATH}/bets`

/** Firebase app 用具名的，不要用預設的那一個 —— 萬一日後主站也初始化了一個才不會打架。 */
const APP_NAME = 'ws-bracket'

export function useWsBracketBets() {
  const config = useRuntimeConfig().public.wsBracket as { databaseUrl?: string }

  /** 沒設定時整個功能關閉，畫面照樣畫得出來（樹狀圖與戰績不依賴它）。 */
  const configured = computed(() => Boolean(config?.databaseUrl))

  const bets = ref<WsBet[]>([])
  /**
   * 鎖盤時間（毫秒）。`null` = 不鎖。
   *
   * 和下注**同一個 `onValue` 拿到**，所以它們永遠是同一個瞬間的快照 ——
   * 分成兩個監聽器的話，會出現「已經鎖盤了但畫面還在用舊的注數」這種
   * 半新半舊的狀態。
   */
  const lockAt = ref<number | null>(null)
  /** 第一批資料到齊了沒。分得出「還在連」與「真的沒有人下注」。 */
  const ready = ref(false)
  const error = ref<string | null>(null)

  let unsubscribe: Unsubscribe | null = null
  /** 下注時要用，所以連線的結果留著。 */
  let connection: Awaited<ReturnType<typeof connect>> | null = null

  async function connect() {
    const [{ initializeApp, getApps, getApp }, database] = await Promise.all([
      import('firebase/app'),
      import('firebase/database'),
    ])

    /*
     * ⚠️ **強制走 WebSocket，不要讓它退回長輪詢。**
     *
     * RTDB 的 SDK 在 WebSocket 連不上時會自己改用 JSONP 長輪詢 ——
     * 也就是動態插入 `<script src="https://….firebasedatabase.app/.lp?…">`。
     * 那條路需要的是 CSP 的 **`script-src`**，不是 `connect-src`，而我們
     * 只開了後者（開 `script-src` 等於允許從那個網域執行任意 JS，不划算）。
     *
     * 結果是**有時候會動、有時候不會**：WebSocket 搶先連上就正常，慢了
     * 半拍退回長輪詢就整個被 CSP 擋掉，而畫面上**看不出任何異常** ——
     * 只是永遠顯示「共 0 注」，跟「真的沒有人下注」長得一模一樣。
     * 實測就是這樣才抓到的。
     *
     * 關掉退路之後，連不上就是連不上，`onValue` 的錯誤回呼會把原因寫到畫面上。
     */
    database.forceWebSockets()

    const existing = getApps().some((a) => a.name === APP_NAME)
    const app = existing
      ? getApp(APP_NAME)
      : // `databaseURL` 是 RTDB 唯一需要的設定。**不用給 apiKey** ——
        // 那是 Firebase Auth 在用的，而這裡從頭到尾沒有任何登入。
        initializeApp({ databaseURL: config.databaseUrl }, APP_NAME)

    return { db: database.getDatabase(app), database }
  }

  onMounted(async () => {
    if (!configured.value) return

    try {
      connection = await connect()
      const { db, database } = connection
      const node = database.ref(db, ROOT_PATH)

      unsubscribe = database.onValue(
        node,
        (snapshot) => {
          const root = (snapshot.val() ?? {}) as {
            bets?: Record<string, unknown>
            config?: unknown
          }

          /*
           * 讀回來的東西一律重新驗證。
           *
           * 安全規則已經擋掉大部分亂寫，但這棵樹是**任何人都能新增與移除**的 ——
           * 規則是防線，schema 是第二層。壞掉的那一筆直接略過，不要讓它
           * 把整頁的統計弄成 NaN（一筆爛資料毀掉整個畫面是最不值得的失敗）。
           */
          bets.value = Object.entries(root.bets ?? {})
            .flatMap(([playerId, bySlot]) =>
              Object.entries((bySlot ?? {}) as Record<string, unknown>).map(([slot, value]) => {
                // 讀不懂的槽位鍵（不是 slot1／slot2）不該出現 —— 規則已經擋死
                // 其他鍵名，出現的話一定是規則生效前的舊資料，直接略過
                if (!BET_SLOTS.includes(slot as BetSlot)) return null
                const parsed = wsBetSchema.safeParse(value)
                return parsed.success
                  ? ({
                      ...parsed.data,
                      id: `${playerId}/${slot}`,
                      slot: slot as BetSlot,
                    } satisfies WsBet)
                  : null
              }),
            )
            .filter((b): b is WsBet => b !== null)
            .sort((a, b) => a.createdAt - b.createdAt)

          /*
           * 鎖盤設定壞掉時當成**沒有鎖**。
           *
           * 反過來（壞掉就鎖住）看似安全，實際上是把一筆讀不懂的資料變成
           * 「整個活動停擺而且沒有人知道為什麼」。真正擋得住的是安全規則，
           * 它讀的是同一個欄位而且不經過這裡 —— 前端這一份只是畫面。
           */
          lockAt.value = wsBracketConfigSchema.safeParse(root.config ?? {}).data?.lockAt ?? null

          ready.value = true
          error.value = null
        },
        (err) => {
          error.value = err.message
          ready.value = true
        },
      )
    } catch (err) {
      error.value = err instanceof Error ? err.message : '無法連線到下注資料庫'
      ready.value = true
    }
  })

  onBeforeUnmount(() => {
    unsubscribe?.()
    unsubscribe = null
  })

  /**
   * 下一注。
   *
   * 時間戳用 `serverTimestamp()` 而不是 `Date.now()`：下注順序是這份資料
   * 唯一的排序依據，交給各自的手機去決定的話，時鐘慢五分鐘的人下的注
   * 就會排到別人前面。安全規則也要求它必須等於伺服器時間。
   *
   * ⚠️ **寫入用 `set()`，不是 `push()`。** 路徑是固定算出來的
   * （`{playerId}/{slot}`），`push()` 那種隨機 key 在這裡沒有意義。
   * 兩格都滿了會先在這裡擋下，不必等安全規則拒絕才知道。
   */
  async function placeBet(input: {
    playerId: string
    playerName: string
    playerNumber: string
    team: string
  }): Promise<void> {
    if (!connection) throw new Error('尚未連線到下注資料庫')

    const slot = nextEmptySlot(bets.value, input.playerId)
    if (!slot) throw new Error('已經押滿兩注了')

    const { db, database } = connection
    await database.set(database.ref(db, `${BETS_PATH}/${input.playerId}/${slot}`), {
      ...input,
      createdAt: database.serverTimestamp(),
    })
  }

  /**
   * 移除一注。
   *
   * **任何人都能移除任何一筆**，和「任何人都能替任何人下注」是對稱的 ——
   * 沒有登入系統時，硬要分「這是不是你的」只能靠裝置記憶，而那在換手機、
   * 清瀏覽器資料、用無痕視窗之後就失效，結果是「明明是我下的卻刪不掉」。
   * 防手滑靠的是畫面上的兩段式確認（`UiBaseButton` + `AdminDeleteButton` 的作法）。
   *
   * 鎖盤之後這個呼叫會被安全規則擋下並拋錯 —— 畫面本來就已經把按鈕收起來了，
   * 這是第二道。
   */
  async function removeBet(id: string): Promise<void> {
    if (!connection) throw new Error('尚未連線到下注資料庫')
    const { db, database } = connection
    await database.remove(database.ref(db, `${BETS_PATH}/${id}`))
  }

  return { bets, lockAt, ready, error, configured, placeBet, removeBet }
}
