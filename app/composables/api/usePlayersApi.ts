import type { MaybeRefOrGetter } from 'vue'
import type { Player, PlayerInput, PlayerPatch, PlayerStatus } from '#shared/schemas/player'

/** 「球員」功能領域的所有 API 呼叫。 */

const ENDPOINTS = {
  list: '/players',
  detail: (id: string) => `/players/${encodeURIComponent(id)}`,
  create: '/admin/players',
  batch: '/admin/players/batch',
  update: (id: string) => `/admin/players/${encodeURIComponent(id)}`,
} as const

/**
 * 【宣告式】球員名單。
 *
 * 前台傳 `status: 'active'` 只看現役；後台不帶參數拿全部（含已退隊的）。
 */
export function usePlayers(options: { status?: MaybeRefOrGetter<PlayerStatus | undefined> } = {}) {
  const query = computed(() => ({ status: toValue(options.status) }))
  return useApiFetch<Player[]>(ENDPOINTS.list, { query })
}

/** 【宣告式】單一球員。 */
export function usePlayer(id: MaybeRefOrGetter<string>) {
  return useApiFetch<Player>(() => ENDPOINTS.detail(String(toValue(id))))
}

/** 【命令式】後台的球員寫入操作。 */
export function usePlayerActions() {
  const { post, patch, del, loading, error, attempt } = useApi()

  return {
    loading,
    error,
    attempt,
    createPlayer: (payload: PlayerInput) => post<Player>(ENDPOINTS.create, payload),

    /** 批次建立 —— 名冊截圖辨識後一次匯入多位。 */
    createPlayers: (players: PlayerInput[]) => post<Player[]>(ENDPOINTS.batch, { players }),
    updatePlayer: (id: string, payload: PlayerPatch) =>
      patch<Player>(ENDPOINTS.update(id), payload),
    removePlayer: (id: string) => del<{ deleted: boolean }>(ENDPOINTS.update(id)),
  }
}
