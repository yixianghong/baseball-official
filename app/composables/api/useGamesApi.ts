import type { MaybeRefOrGetter } from 'vue'
import type { Game, GameClip, GameInput, GamePatch, GameQuery } from '#shared/schemas/game'

/**
 * 「比賽」這個功能領域的所有 API 呼叫。
 *
 * 頁面只呼叫這裡的函式，永遠不寫端點路徑 —— 後端改路徑、加參數時
 * 只要改這個檔案，不必翻遍所有頁面找字串。
 */

/** 端點路徑集中定義。這是本檔案唯一出現路徑字串的地方。 */
const ENDPOINTS = {
  list: '/games',
  detail: (id: string) => `/games/${encodeURIComponent(id)}`,
  create: '/admin/games',
  batch: '/admin/games/batch',
  update: (id: string) => `/admin/games/${encodeURIComponent(id)}`,
  clipsRefresh: (id: string) => `/admin/games/${encodeURIComponent(id)}/clips/refresh`,
  clip: (id: string, videoId: string) =>
    `/admin/games/${encodeURIComponent(id)}/clips/${encodeURIComponent(videoId)}`,
} as const

/**
 * 【宣告式】比賽列表。
 *
 * @example 近期賽程（由近到遠）
 * ```ts
 * const { data: games } = await useGames({ scope: 'upcoming' })
 * ```
 *
 * @example 比賽結果（由新到舊）
 * ```ts
 * const { data: games } = await useGames({ scope: 'past' })
 * ```
 */
export function useGames(
  options: {
    scope?: MaybeRefOrGetter<GameQuery['scope']>
    status?: MaybeRefOrGetter<GameQuery['status']>
    year?: MaybeRefOrGetter<number | undefined>
    limit?: MaybeRefOrGetter<number>
  } = {},
) {
  // 包成 computed 才能保留響應性：直接 toValue() 會斷開追蹤，
  // 之後條件改變也不會重新載入。
  const query = computed(() => ({
    scope: toValue(options.scope) ?? 'all',
    status: toValue(options.status),
    year: toValue(options.year),
    limit: toValue(options.limit) ?? 50,
  }))

  return useApiFetch<Game[]>(ENDPOINTS.list, { query })
}

/**
 * 【宣告式】單場比賽。
 *
 * 一次拿到完整資料（含打線、出席、計分板），詳情頁不需要第二次請求。
 */
export function useGame(id: MaybeRefOrGetter<string>) {
  return useApiFetch<Game>(() => ENDPOINTS.detail(String(toValue(id))))
}

/**
 * 【命令式】後台的比賽寫入操作。
 *
 * @example
 * ```ts
 * const { createGame, loading, error } = useGameActions()
 * const game = await createGame(form)
 * ```
 */
export function useGameActions() {
  const { get, post, patch, del, loading, error, attempt } = useApi()

  return {
    loading,
    error,
    attempt,

    /** 命令式取單場（例如按下「編輯」才載入）。 */
    fetchGame: (id: string) => get<Game>(ENDPOINTS.detail(id)),

    createGame: (payload: GameInput) => post<Game>(ENDPOINTS.create, payload),

    /** 批次建立 —— AI 辨識賽程圖後一次匯入多場。 */
    createGames: (games: GameInput[]) => post<Game[]>(ENDPOINTS.batch, { games }),

    /**
     * 部分更新。後台四個分頁各自只送自己那部分的欄位，
     * 編輯打線時不會覆蓋掉出席名單。
     */
    updateGame: (id: string, payload: GamePatch) => patch<Game>(ENDPOINTS.update(id), payload),

    removeGame: (id: string) => del<{ deleted: boolean }>(ENDPOINTS.update(id)),

    /**
     * 把 YouTube 上的可見度同步回來。
     *
     * API 上傳的影片一律是私人的，管理者手動改成公開之後要按一下這個，
     * 前台才知道哪幾段可以顯示（見 `docs/game-recording-plan.md`）。
     */
    refreshClips: (id: string) => post<{ clips: GameClip[] }>(ENDPOINTS.clipsRefresh(id), {}),

    /** 只移除本站的紀錄，不刪 YouTube 上的影片。 */
    removeClip: (id: string, videoId: string) =>
      del<{ clips: GameClip[] }>(ENDPOINTS.clip(id, videoId)),
  }
}
