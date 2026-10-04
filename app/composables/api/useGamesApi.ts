import type { MaybeRefOrGetter } from 'vue'
import type {
  AttendanceEntry,
  Game,
  GameClip,
  HalfInningNarrative,
  GameHalf,
  GameInput,
  GamePatch,
  GameQuery,
} from '#shared/schemas/game'
import type { Play } from '#shared/schemas/play'
import type { AttendanceAnswer } from '#shared/schemas/attendance-request'

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
  clips: (id: string) => `/admin/games/${encodeURIComponent(id)}/clips`,
  clipsRefresh: (id: string) => `/admin/games/${encodeURIComponent(id)}/clips/refresh`,
  clip: (id: string, videoId: string) =>
    `/admin/games/${encodeURIComponent(id)}/clips/${encodeURIComponent(videoId)}`,
  plays: (id: string) => `/admin/games/${encodeURIComponent(id)}/plays`,
  narrative: (id: string) => `/admin/games/${encodeURIComponent(id)}/narrative`,
  /** ⚠️ 不在 `/admin` 底下 —— 隊員是在前台自己回報的，沒有登入。 */
  attendance: (id: string) => `/games/${encodeURIComponent(id)}/attendance`,
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
 *
 * **有三個頁面讀這支端點**：後台編輯頁、錄影頁、前台比賽頁。它們會共用
 * 同一筆 `useAsyncData` 快取，所以「進到頁面就重新確認一次」對這一支特別
 * 重要 —— 那是 `useApiFetch` 的預設行為（`revalidateOnEnter`），這裡不必
 * 也不該關掉。這個坑就是在這三頁之間走來走去時踩到的，理由與實測寫在
 * `useApiFetch` 的說明裡。
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
  const { get, post, put, patch, del, loading, error, attempt } = useApi()

  return {
    loading,
    error,
    attempt,

    /** 命令式取單場（例如按下「編輯」才載入）。 */
    fetchGame: (id: string) => get<Game>(ENDPOINTS.detail(id)),

    createGame: (payload: GameInput) => post<Game>(ENDPOINTS.create, payload),

    /**
     * 隊員自己回報出席（**前台**，不需要登入）。
     *
     * 回的是整份名單而不是只回成功 —— 比賽頁走 CDN 快取，畫面上那一份最多
     * 可能是 60 秒前的；回整份是按下去的人唯一能看到最新狀態的機會。
     */
    answerAttendance: (id: string, answer: AttendanceAnswer) =>
      put<{ attendance: AttendanceEntry[] }>(ENDPOINTS.attendance(id), answer),

    /** 批次建立 —— AI 辨識賽程圖後一次匯入多場。 */
    createGames: (games: GameInput[]) => post<Game[]>(ENDPOINTS.batch, { games }),

    /**
     * 部分更新。後台四個分頁各自只送自己那部分的欄位，
     * 編輯打線時不會覆蓋掉出席名單。
     */
    updateGame: (id: string, payload: GamePatch) => patch<Game>(ENDPOINTS.update(id), payload),

    removeGame: (id: string) => del<{ deleted: boolean }>(ENDPOINTS.update(id)),

    /**
     * 存下一個半局的賽況敘述。以「第幾局的哪半局」為鍵覆蓋，空字串＝刪掉那一格。
     *
     * 文字是在 `/admin/ai/describe-half-inning` 產生的，那一支什麼都不寫 ——
     * 「產生」與「保存」是兩個可以各自失敗的動作。
     */
    saveNarrative: (id: string, inning: number, half: GameHalf, text: string) =>
      put<{ narratives: HalfInningNarrative[] }>(ENDPOINTS.narrative(id), {
        inning,
        half,
        text,
      }),

    /**
     * 把 YouTube 上的可見度同步回來。
     *
     * API 上傳的影片一律是私人的，管理者手動改成公開之後要按一下這個，
     * 前台才知道哪幾段可以顯示（見 `docs/game-recording-plan.md`）。
     */
    refreshClips: (id: string) => post<{ clips: GameClip[] }>(ENDPOINTS.clipsRefresh(id), {}),

    /**
     * 補登一段影片。
     *
     * 自動上傳與人工補登走的是**同一支端點** —— 片段的身分是
     * 「第幾局的哪半局」，不是 videoId，所以資料層分不出來源，也不需要分。
     */
    addClip: (id: string, clip: { inning: number; half: GameHalf; videoId: string }) =>
      post<{ clips: GameClip[] }>(ENDPOINTS.clips(id), clip),

    /** 只移除本站的紀錄，不刪 YouTube 上的影片。 */
    removeClip: (id: string, videoId: string) =>
      del<{ clips: GameClip[] }>(ENDPOINTS.clip(id, videoId)),

    /**
     * 寫入一個半局的逐打席紀錄。
     *
     * 送進去的陣列**取代**那個半局既有的全部打席（空陣列＝清空），所以
     * 重送一次不會變成兩份 —— 離線草稿的重試就是靠這一點。
     *
     * 回傳的 `scoreboard` 是套用逐打席之後的：有打席的半局，那一格的得分
     * 由打席加總決定（見 `applyPlayDerivedScores()`）。前端直接用回傳的，
     * 不要自己再算一次。
     */
    savePlays: (id: string, inning: number, half: GameHalf, plays: Play[]) =>
      put<Pick<Game, 'plays' | 'scoreboard'>>(ENDPOINTS.plays(id), { inning, half, plays }),
  }
}
