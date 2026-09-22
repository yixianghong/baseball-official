import { describe, expect, it } from 'vitest'
import { $fetch, fetch, setup } from '@nuxt/test-utils/e2e'

/**
 * 迴歸測試：SSR 自己呼叫自己的請求不可以被算進流量限制。
 *
 * ## 這裡防的是一個會靜默發生的正式環境故障
 * 頁面靠 `useApiFetch` 在 SSR 階段取資料，那是 Nitro 內部的 `$fetch`，
 * 一樣會經過 `server/middleware/30.rate-limit.ts`。但內部請求沒有來源 IP，
 * 識別碼會全部落在同一個桶子 —— **全站訪客的 SSR 共用一個計數器**。
 *
 * 一次首頁渲染會發出 4 支內部 API 請求，所以額度設 100／分鐘時，
 * 全站大約每分鐘 25 次瀏覽就會把它打爆。而爆掉的樣子是
 * **頁面照常回 200，只是資料全部消失** —— 沒有錯誤頁、沒有 5xx，
 * 從外面看就只是「網站突然變空白」。
 *
 * ## 為什麼獨立成一個檔案
 * 這個情境需要把額度調到很低才測得出來，而 `bff.test.ts` 裡的其他測試
 * 需要正常的額度。一個檔案只能有一組 `setup()`，所以分開。
 */

process.env.NUXT_FIREBASE_PROJECT_ID = ''
process.env.NUXT_FIREBASE_CLIENT_EMAIL = ''
process.env.NUXT_FIREBASE_PRIVATE_KEY = ''
process.env.NUXT_FIREBASE_STORAGE_BUCKET = ''
process.env.NUXT_FIREBASE_WEB_API_KEY = ''
process.env.NUXT_GEMINI_API_KEY = ''
process.env.ALLOW_MEMORY_STORE = 'true'

/**
 * 刻意設得極低。
 *
 * 用環境變數而不是 `nuxtConfig.runtimeConfig` —— 環境變數的優先權比較高，
 * 本機的 `.env` 若剛好也設了這個鍵才不會把測試的設定蓋掉。
 * （`bff.test.ts` 裡的 `rateLimitMax: 80` 在本機就是這樣被 `.env` 的 100 蓋掉的。）
 */
const LIMIT = 6
process.env.NUXT_RATE_LIMIT_MAX = String(LIMIT)
process.env.NUXT_RATE_LIMIT_WINDOW_MS = '60000'

await setup({
  server: true,
  browser: false,
  nuxtConfig: {
    runtimeConfig: { sessionPassword: 'e2e-rate-limit-session-password-long-enough' },
  },
})

describe('流量限制不能擋到 SSR 自己的請求', () => {
  it(`額度只有 ${LIMIT}，連續渲染 ${LIMIT * 2} 次首頁，每一次的資料都還在`, async () => {
    // 每次渲染會發出 4 支內部 API 請求，總共遠遠超過額度。
    // 修正前：第三次之後隊名與所有區塊就會整個消失（但仍然回 200）。
    for (let round = 1; round <= LIMIT * 2; round++) {
      const html = await $fetch<string>(`/?round=${round}`)

      expect(html, `第 ${round} 次渲染：隊名不見了`).toContain('城市棒球隊')
      expect(html, `第 ${round} 次渲染：下一場比賽區塊消失`).toContain('NEXT GAME')
    }
  })

  it('真正的用戶端請求還是照樣被限流（沒有把防護整個關掉）', async () => {
    // 前面的頁面渲染不該用掉用戶端的額度，所以這裡從滿的開始算
    const statuses: number[] = []
    for (let i = 0; i < LIMIT + 2; i++) {
      statuses.push((await fetch('/api/games')).status)
    }

    expect(statuses.slice(0, LIMIT)).toEqual(Array(LIMIT).fill(200))
    expect(statuses.at(-1)).toBe(429)
  })
})
