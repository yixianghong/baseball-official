import type {
  ParseAttendanceResponse,
  ParseRosterResponse,
  ParseScheduleResponse,
  ParseScoreboardResponse,
} from '#shared/schemas/ai'
import { prepareImage } from '~/utils/image'

/**
 * Gemini 圖片辨識。
 *
 * ## 呼叫端要記得的一件事
 * 這裡回傳的是**建議**，不是已經存好的資料。拿到結果之後要把它帶進表單
 * 讓人確認、修改，再呼叫 `useGameActions()` 的 `createGame` / `updateGame`
 * 真正寫入。後端也不會因為辨識成功就寫任何東西。
 *
 * ## 逾時比一般請求長
 * 視覺推理通常要 10～30 秒。`useApi()` 本身不設限，逾時控制在 BFF
 * （`gemini.timeoutMs`，預設 60 秒），所以這裡不需要額外處理，
 * 但 UI 一定要顯示進行中的狀態，否則使用者會以為當掉了。
 */

const ENDPOINTS = {
  parseSchedule: '/admin/ai/parse-schedule',
  parseScoreboard: '/admin/ai/parse-scoreboard',
  parseRoster: '/admin/ai/parse-roster',
  parseAttendance: '/admin/ai/parse-attendance',
} as const

export function useAiActions() {
  const { post, loading, error, attempt } = useApi()

  return {
    /** 辨識進行中。務必綁到畫面上 —— 這個請求可能要跑 30 秒。 */
    loading,
    error,
    attempt,

    /**
     * 辨識賽程公告圖，取出所有屬於我隊的場次。
     *
     * @param file 使用者選的圖片，會在瀏覽器先壓縮
     * @param teamNames 我方隊名的各種寫法，來自後台的網站設定
     */
    async parseSchedule(
      file: File,
      teamNames: string[],
      defaultYear?: number,
    ): Promise<ParseScheduleResponse> {
      const image = await prepareImage(file)
      return await post<ParseScheduleResponse>(ENDPOINTS.parseSchedule, {
        imageBase64: image.base64,
        mimeType: image.mimeType,
        teamNames,
        defaultYear,
      })
    },

    /**
     * 辨識球員名冊截圖（Excel／試算表的截圖），取出每一列的球員資料。
     *
     * 守備位置與慣用手由後端正規化成系統的列舉值，前端拿到的就能直接填進表單。
     */
    async parseRoster(file: File): Promise<ParseRosterResponse> {
      const image = await prepareImage(file)
      return await post<ParseRosterResponse>(ENDPOINTS.parseRoster, {
        imageBase64: image.base64,
        mimeType: image.mimeType,
      })
    },

    /**
     * 辨識出席調查的截圖（LINE 投票、接龍訊息等）。
     *
     * 一定要把現有名單傳進來 —— 名字對應是由模型完成的，沒有名單它只能回
     * 暱稱字串，後台還是得一個一個手動指定。
     */
    async parseAttendance(
      file: File,
      roster: Array<{ id: string; name: string; number: string }>,
    ): Promise<ParseAttendanceResponse> {
      const image = await prepareImage(file)
      return await post<ParseAttendanceResponse>(ENDPOINTS.parseAttendance, {
        imageBase64: image.base64,
        mimeType: image.mimeType,
        roster,
      })
    },

    /** 辨識計分板照片，取出逐局得分與 R／H／E。 */
    async parseScoreboard(file: File, teamNames: string[]): Promise<ParseScoreboardResponse> {
      const image = await prepareImage(file)
      return await post<ParseScoreboardResponse>(ENDPOINTS.parseScoreboard, {
        imageBase64: image.base64,
        mimeType: image.mimeType,
        teamNames,
      })
    },
  }
}
