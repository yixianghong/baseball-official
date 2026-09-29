import type { GameHalf } from '#shared/schemas/half-inning'
import type { Play } from '#shared/schemas/play'
import { replaceHalfInning } from '#shared/schemas/play'
import { draftKey, getPlayStore, type PlayDraft } from '~/utils/play-store'

/**
 * 逐打席紀錄的寫入與離線草稿。
 *
 * ## 為什麼不走 `useAutosave`
 * 那一支是為了「整份表單、一個 debounce、一份 PATCH」設計的，而逐打席
 * 完全相反：
 *
 * - 寫入的單位是**一個半局**，不是整份表單（`PATCH /admin/games/[id]`
 *   會 read-merge-write 整份文件，把兩百筆打席塞進每次自動儲存的 payload
 *   等於改一個場地名稱就重送整場紀錄）。
 * - 使用者可能在**球場邊、沒有網路**的情況下登錄，所以每一次變更都必須
 *   先落到本機磁碟，而 `useAutosave` 的失敗只活在記憶體裡。
 *
 * ## 順序：先寫本機，再送伺服器
 * 和錄影「先存到裝置、再排進上傳佇列」是同一條規則。反過來的話，送出失敗
 * 就等於那半局沒了 —— 而在球場的行動網路上，失敗是常態。
 *
 * 重送是安全的：端點以 `(inning, half)` 為鍵整個半局覆蓋，所以是冪等的。
 */

export type PlayLogStatus = 'idle' | 'saving' | 'saved' | 'offline'

const TOAST_KEY = 'play-log'

export function usePlayLog(gameId: () => string) {
  const { savePlays } = useGameActions()
  const toast = useToast()

  /** 這一場的全部打席。送出成功後由伺服器回來的那一份取代。 */
  const plays = ref<Play[]>([])
  /** 還沒同步成功的半局草稿。 */
  const pending = ref<PlayDraft[]>([])
  const status = ref<PlayLogStatus>('idle')

  /** 伺服器回來的計分板 —— 逐局得分是推導的，前端不要自己再算一次。 */
  const scoreboard = ref<Awaited<ReturnType<typeof savePlays>>['scoreboard'] | null>(null)

  function setPlays(next: Play[]): void {
    plays.value = next
  }

  async function refreshPending(): Promise<void> {
    if (!import.meta.client) return
    try {
      pending.value = await getPlayStore().list(gameId())
    } catch {
      // 草稿讀不出來不該讓整頁掛掉 —— 它是安全網，不是資料來源
      pending.value = []
    }
  }

  /**
   * 寫入一個半局。
   *
   * 畫面先更新（樂觀），本機草稿先落地，最後才送伺服器 —— 場邊登錄的人
   * 每按一下都要立刻看到結果，不能等一個來回。
   */
  async function saveHalf(inning: number, half: GameHalf, next: Play[]): Promise<void> {
    plays.value = replaceHalfInning(plays.value, inning, half, next)

    const key = draftKey(gameId(), inning, half)
    const store = import.meta.client ? getPlayStore() : null

    await store
      ?.put({ key, gameId: gameId(), inning, half, plays: next, savedAt: Date.now() })
      .catch(() => {
        // 本機寫不進去（無痕視窗、配額滿）時繼續往下送 —— 退回「沒有安全網
        // 但功能照常」，而不是整個擋下來
      })

    status.value = 'saving'
    try {
      const result = await savePlays(gameId(), inning, half, next)
      plays.value = result.plays
      scoreboard.value = result.scoreboard
      await store?.remove(key).catch(() => {})
      status.value = 'saved'
      toast.show({ key: TOAST_KEY, tone: 'success', message: '已儲存' })
    } catch {
      status.value = 'offline'
      // ⚠️ 這一則**不會自己消失**，而且附一顆重試 —— 資料還在本機，
      // 但使用者必須知道它還沒上去（見 `useToast` 的界線說明）
      toast.show({
        key: TOAST_KEY,
        tone: 'error',
        message: '還沒同步到伺服器，紀錄先存在這台裝置上',
        action: { label: '重試', handler: syncPending },
      })
    } finally {
      await refreshPending()
    }
  }

  /**
   * 把本機還沒送出去的草稿全部重送一次。
   *
   * 逐筆送而不是一次打包：一個半局失敗不該讓其他半局也卡住，而且端點本來
   * 就是一個半局一次。
   */
  async function syncPending(): Promise<void> {
    if (!import.meta.client) return
    const drafts = await getPlayStore().list(gameId())
    if (drafts.length === 0) return

    status.value = 'saving'
    let failed = 0

    for (const draft of drafts) {
      try {
        const result = await savePlays(draft.gameId, draft.inning, draft.half, draft.plays)
        plays.value = result.plays
        scoreboard.value = result.scoreboard
        await getPlayStore().remove(draft.key)
      } catch {
        failed += 1
      }
    }

    await refreshPending()

    if (failed > 0) {
      status.value = 'offline'
      toast.show({
        key: TOAST_KEY,
        tone: 'error',
        message: `還有 ${failed} 個半局沒同步成功`,
        action: { label: '重試', handler: syncPending },
      })
      return
    }

    status.value = 'saved'
    toast.show({ key: TOAST_KEY, tone: 'success', message: '全部同步完成' })
  }

  return { plays, pending, status, scoreboard, setPlays, saveHalf, syncPending, refreshPending }
}
