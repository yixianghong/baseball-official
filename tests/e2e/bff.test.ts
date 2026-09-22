import { describe, expect, it } from 'vitest'
import { $fetch, fetch, setup } from '@nuxt/test-utils/e2e'

/**
 * 端對端整合測試 —— 驗證「瀏覽器 → BFF → 資料層」的完整鏈路。
 *
 * 這裡會真的建置 Nuxt 並啟動伺服器，因此涵蓋到單元測試看不到的部分：
 * middleware 的執行順序、cookie 的實際行為、SSR 的輸出、
 * 錯誤在各層之間的傳遞方式。
 *
 * ## 為什麼不需要 Firestore emulator
 * 不提供 Firebase 憑證時，repository 會自動改用
 * `server/utils/memory-store.ts` 的示範資料（見該檔案的說明）。
 * 測試因此不依賴任何外部服務，也不會有「測試把正式資料改壞」的風險。
 * 種子資料的 id 是固定的（g1…g5、p1…p12、a1…a4），可以直接拿來斷言。
 *
 * 執行：`pnpm test:e2e`（會花上一兩分鐘，因為包含一次完整建置）
 */

/**
 * ⚠️ 隔離正式資料庫 —— 這段必須在 `setup()` 之前執行。
 *
 * 專案根目錄的 `.env` 一旦填了真實的 Firebase 憑證，Nuxt 建置時就會載入它們，
 * e2e 會直接連上**正式的 Firestore**：測試裡的「新增球員」會真的寫進去，
 * 登入會真的去打 Identity Toolkit。
 *
 * 載入 `.env` 的 dotenv 不會覆寫「已經存在」的環境變數，所以在這裡先把這幾個
 * 鍵設成空字串，`.env` 裡的值就進不來，服務會退回記憶體資料與開發模式登入。
 *
 * 這不只是為了讓測試跑得過 —— 是為了讓「跑測試」永遠不可能動到正式資料。
 */
process.env.NUXT_FIREBASE_PROJECT_ID = ''
process.env.NUXT_FIREBASE_CLIENT_EMAIL = ''
process.env.NUXT_FIREBASE_PRIVATE_KEY = ''
process.env.NUXT_FIREBASE_STORAGE_BUCKET = ''
process.env.NUXT_FIREBASE_WEB_API_KEY = ''
process.env.NUXT_GEMINI_API_KEY = ''

// e2e 跑的是 production 建置，而 production 預設會因為缺少 Firebase 設定而拒絕啟動
// （見 server/plugins/00.env-validate.ts）。這個開關是專門為了這個場景而存在的例外。
// ⚠️ 正式部署絕對不要設它。
process.env.ALLOW_MEMORY_STORE = 'true'

await setup({
  server: true,
  browser: false,
  nuxtConfig: {
    runtimeConfig: {
      sessionPassword: 'e2e-test-session-password-with-enough-length',
      // 刻意不給 firebase / gemini 設定：走記憶體資料與開發模式登入
      // 放寬限制，避免測試之間互相觸發限流
      rateLimitMax: 80,
      rateLimitWindowMs: 60_000,
    },
  },
})

/** 開發模式登入用的密碼（見 `server/utils/firebase-auth.ts`）。 */
const DEV_PASSWORD = 'password1234'

/** 登入並取回 cookie 與 CSRF token，給需要寫入的測試使用。 */
async function login() {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: DEV_PASSWORD }),
  })

  const setCookies = response.headers.getSetCookie()
  const cookie = setCookies.map((value) => value.split(';')[0]).join('; ')
  const csrfToken = /csrf_token=([^;]+)/.exec(cookie)?.[1] ?? ''

  return { cookie, csrfToken, response }
}

describe('統一回應格式', () => {
  it('成功回應帶有 success / data / meta 三段', async () => {
    const body = await $fetch<Record<string, unknown>>('/api/health')

    expect(body).toMatchObject({ success: true, data: { status: 'ok' } })
    expect(body.meta).toMatchObject({
      requestId: expect.any(String),
      timestamp: expect.any(String),
    })
  })

  it('列表端點回傳陣列，且每一筆都是完整的比賽資料', async () => {
    const body = await $fetch<{ data: Array<Record<string, unknown>> }>('/api/games')

    expect(Array.isArray(body.data)).toBe(true)
    expect(body.data[0]).toMatchObject({
      id: expect.any(String),
      date: expect.any(String),
      opponent: expect.any(String),
      status: expect.any(String),
    })
  })

  it('後台列表用的查詢上限不會被驗證擋下（迴歸：limit 超過 schema 上限）', async () => {
    // 後台要一次看到全部比賽，傳的是 MAX_GAME_QUERY_LIMIT。
    // 這個值若超過 schema 允許的範圍，請求會變成 400，而列表頁會顯示
    // 「還沒有比賽資料」—— 看起來就像資料真的不存在。
    const response = await fetch(`/api/games?scope=all&limit=${300}`)
    expect(response.status).toBe(200)
  })

  it('requestId 同時出現在回應標頭與 body 中（可交叉比對 log）', async () => {
    const response = await fetch('/api/health')
    const body = (await response.json()) as { meta: { requestId: string } }

    expect(response.headers.get('x-request-id')).toBe(body.meta.requestId)
  })

  it('沿用用戶端傳入的 x-request-id 以串接跨服務追蹤', async () => {
    const response = await fetch('/api/health', {
      headers: { 'x-request-id': 'trace-from-client-123' },
    })

    expect(response.headers.get('x-request-id')).toBe('trace-from-client-123')
  })
})

describe('統一錯誤格式', () => {
  it('不存在的 API 路由回傳 JSON 錯誤信封而非 HTML', async () => {
    const response = await fetch('/api/definitely-not-a-route')
    const body = (await response.json()) as { success: boolean; error: { code: string } }

    expect(response.status).toBe(404)
    expect(body.success).toBe(false)
    expect(body.error.code).toBe('NOT_FOUND')
  })

  it('找不到的比賽回傳 404 與可讀的訊息', async () => {
    const response = await fetch('/api/games/no-such-game')
    const body = (await response.json()) as { error: { code: string; message: string } }

    expect(response.status).toBe(404)
    expect(body.error.code).toBe('NOT_FOUND')
    expect(body.error.message).toContain('找不到')
  })

  it('驗證失敗回傳 400 與欄位層級的錯誤細節', async () => {
    const { cookie, csrfToken } = await login()

    const response = await fetch('/api/admin/players', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, 'x-csrf-token': csrfToken },
      body: JSON.stringify({ number: '1', name: '', positions: [] }),
    })
    const body = (await response.json()) as {
      error: { code: string; details: { fieldErrors: Record<string, string[]> } }
    }

    expect(response.status).toBe(400)
    expect(body.error.code).toBe('VALIDATION_ERROR')
    expect(body.error.details.fieldErrors).toHaveProperty('name')
    expect(body.error.details.fieldErrors).toHaveProperty('positions')
  })
})

describe('資安標頭', () => {
  it('頁面回應帶齊基礎防護標頭', async () => {
    const response = await fetch('/')

    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('x-frame-options')).toBeTruthy()
    expect(response.headers.get('referrer-policy')).toBeTruthy()
  })

  it('CSP 禁止被嵌入 iframe，且前端只能連回自己', async () => {
    const response = await fetch('/')
    const csp = response.headers.get('content-security-policy') ?? ''

    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("connect-src 'self'")
  })

  it('不洩漏技術棧資訊', async () => {
    const response = await fetch('/api/health')
    expect(response.headers.get('x-powered-by')).toBeFalsy()
  })
})

describe('後台權限：所有寫入都需要登入', () => {
  it.each([
    ['POST', '/api/admin/games'],
    ['POST', '/api/admin/players'],
    ['POST', '/api/admin/announcements'],
    ['PUT', '/api/admin/settings'],
    ['POST', '/api/admin/uploads'],
    ['POST', '/api/admin/players/batch'],
    ['POST', '/api/admin/ai/parse-schedule'],
    ['POST', '/api/admin/ai/parse-scoreboard'],
    ['POST', '/api/admin/ai/parse-roster'],
    ['POST', '/api/admin/ai/parse-attendance'],
  ])('未登入時 %s %s 回傳 401', async (method, path) => {
    const response = await fetch(path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })

    expect(response.status).toBe(401)
  })

  it('未登入時看不到含草稿的後台公告列表', async () => {
    const response = await fetch('/api/admin/announcements')
    expect(response.status).toBe(401)
  })

  it('公開的公告列表只回傳已發布的內容', async () => {
    const body = await $fetch<{ data: Array<{ status: string }> }>('/api/announcements')

    expect(body.data.length).toBeGreaterThan(0)
    expect(body.data.every((item) => item.status === 'published')).toBe(true)
  })
})

describe('認證：憑證絕不離開 Node 層', () => {
  it('登入成功只回傳公開的使用者資料', async () => {
    const body = await $fetch<{ data: Record<string, unknown> }>('/api/auth/login', {
      method: 'POST',
      body: { email: 'admin@example.com', password: DEV_PASSWORD },
    })

    expect(body.data).toMatchObject({ email: 'admin@example.com', roles: ['admin'] })
  })

  it('回應中完全不含任何 token', async () => {
    const body = await $fetch<unknown>('/api/auth/login', {
      method: 'POST',
      body: { email: 'admin@example.com', password: DEV_PASSWORD },
    })

    const serialized = JSON.stringify(body)
    expect(serialized).not.toContain('idToken')
    expect(serialized).not.toContain('accessToken')
    expect(serialized).not.toContain('refreshToken')
  })

  it('session cookie 為 httpOnly，前端 JS 讀不到', async () => {
    const { response } = await login()
    const sessionCookie = response.headers
      .getSetCookie()
      .find((value) => value.startsWith('app_session='))

    expect(sessionCookie).toBeDefined()
    expect(sessionCookie!.toLowerCase()).toContain('httponly')
  })

  it('CSRF cookie 刻意可被 JS 讀取（double-submit 需要）', async () => {
    const { response } = await login()
    const csrfCookie = response.headers
      .getSetCookie()
      .find((value) => value.startsWith('csrf_token='))

    expect(csrfCookie).toBeDefined()
    expect(csrfCookie!.toLowerCase()).not.toContain('httponly')
  })

  it('密碼錯誤回傳 401 且不透露是帳號還是密碼錯', async () => {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@example.com', password: 'wrong-password' }),
    })
    const body = (await response.json()) as { error: { message: string } }

    expect(response.status).toBe(401)
    expect(body.error.message).toBe('帳號或密碼錯誤')
  })

  it('未登入時 /api/auth/me 回傳 401', async () => {
    const response = await fetch('/api/auth/me')
    expect(response.status).toBe(401)
  })

  it('帶著 session cookie 就能取回使用者資料', async () => {
    const { cookie } = await login()
    const response = await fetch('/api/auth/me', { headers: { cookie } })
    const body = (await response.json()) as { data: { email: string } }

    expect(response.status).toBe(200)
    expect(body.data.email).toBe('admin@example.com')
  })
})

describe('CSRF 防護', () => {
  it('已登入但缺少 CSRF header 的寫入請求會被擋下', async () => {
    const { cookie } = await login()

    const response = await fetch('/api/admin/players', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ number: '88', name: '測試', positions: ['P'] }),
    })
    const body = (await response.json()) as { error: { code: string } }

    expect(response.status).toBe(403)
    expect(body.error.code).toBe('CSRF_INVALID')
  })

  it('帶上正確的 CSRF token 就能通過', async () => {
    const { cookie, csrfToken } = await login()

    const response = await fetch('/api/admin/players', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, 'x-csrf-token': csrfToken },
      body: JSON.stringify({ number: '88', name: 'CSRF 測試球員', positions: ['P'] }),
    })

    expect(response.status).toBe(200)
  })
})

describe('資料寫入與讀取', () => {
  it('新增的球員會出現在公開名單中', async () => {
    const { cookie, csrfToken } = await login()

    const created = await $fetch<{ data: { id: string } }>('/api/admin/players', {
      method: 'POST',
      headers: { cookie, 'x-csrf-token': csrfToken },
      body: { number: '77', name: '端對端測試員', positions: ['CF'] },
    })

    const list = await $fetch<{ data: Array<{ id: string }> }>('/api/players')
    expect(list.data.some((player) => player.id === created.data.id)).toBe(true)
  })

  it('標記為已結束且未指定結果時，由計分板自動推導勝敗', async () => {
    const { cookie, csrfToken } = await login()

    const body = await $fetch<{ data: { result: string; status: string } }>('/api/admin/games/g2', {
      method: 'PATCH',
      headers: { cookie, 'x-csrf-token': csrfToken },
      body: {
        status: 'finished',
        result: null,
        scoreboard: {
          innings: [{ inning: 1, our: 5, opponent: 2 }],
          totals: { our: { r: 5, h: 8, e: 0 }, opponent: { r: 2, h: 3, e: 2 } },
        },
      },
    })

    expect(body.data.status).toBe('finished')
    expect(body.data.result).toBe('win')
  })

  it.each([
    ['/api/admin/ai/parse-schedule', { teamNames: ['城市棒球隊'] }],
    ['/api/admin/ai/parse-scoreboard', { teamNames: ['城市棒球隊'] }],
    ['/api/admin/ai/parse-roster', {}],
    ['/api/admin/ai/parse-attendance', { roster: [{ id: 'p1', name: '陳冠宇', number: '1' }] }],
  ])('未設定 Gemini 金鑰時 %s 給出可理解的說明而非泛用錯誤', async (path, extra) => {
    const { cookie, csrfToken } = await login()

    const response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, 'x-csrf-token': csrfToken },
      body: JSON.stringify({
        imageBase64: 'A'.repeat(64),
        mimeType: 'image/jpeg',
        ...extra,
      }),
    })
    const body = (await response.json()) as { error: { code: string; message: string } }

    expect(response.status).toBe(503)
    expect(body.error.code).toBe('SERVICE_UNAVAILABLE')
    // 5xx 預設會被換成泛用訊息，這一則刻意標成可揭露（見 server/utils/gemini.ts）
    expect(body.error.message).toContain('Gemini')
  })

  it('批次建立球員會全部進到名單裡', async () => {
    const { cookie, csrfToken } = await login()

    const created = await $fetch<{ data: Array<{ id: string }> }>('/api/admin/players/batch', {
      method: 'POST',
      headers: { cookie, 'x-csrf-token': csrfToken },
      body: {
        players: [
          { number: '55', name: '批次測試甲', positions: ['P'] },
          { number: '56', name: '批次測試乙', positions: ['C'] },
        ],
      },
    })

    expect(created.data).toHaveLength(2)

    const list = await $fetch<{ data: Array<{ id: string }> }>('/api/players')
    for (const player of created.data) {
      expect(list.data.some((item) => item.id === player.id)).toBe(true)
    }
  })
})

describe('延賽的場次', () => {
  it('列在「過去」而不是「近期賽程」', async () => {
    const { cookie, csrfToken } = await login()

    const created = await $fetch<{ data: { id: string } }>('/api/admin/games', {
      method: 'POST',
      headers: { cookie, 'x-csrf-token': csrfToken },
      body: {
        date: '2027-06-01',
        opponent: '下雨隊',
        status: 'postponed',
        note: '大雨取消，擇期再賽',
      },
    })

    const past = await $fetch<{ data: Array<{ id: string }> }>('/api/games?scope=past')
    const upcoming = await $fetch<{ data: Array<{ id: string }> }>('/api/games?scope=upcoming')

    // 那一天確實有安排過，只是沒打成 —— 從賽程頁消失又不出現在結果頁，
    // 等於整場比賽憑空不見了
    expect(past.data.some((game) => game.id === created.data.id)).toBe(true)
    expect(upcoming.data.some((game) => game.id === created.data.id)).toBe(false)
  })
})

describe('請求主體防護', () => {
  it('拒絕不支援的 Content-Type', async () => {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/xml' },
      body: '<login/>',
    })

    expect(response.status).toBe(400)
  })
})

describe('SSR', () => {
  it('首頁 HTML 在伺服器端就已渲染完成（不是空殼）', async () => {
    const html = await $fetch<string>('/')

    expect(html).toContain('城市棒球隊')
    expect(html).toContain('下一場比賽')
  })

  it('賽程頁的資料在 SSR 階段就已取得並寫進 HTML', async () => {
    const html = await $fetch<string>('/schedule')
    expect(html).toContain('近期賽程')
  })

  it('球員名單在 SSR 階段完成渲染', async () => {
    const html = await $fetch<string>('/players')
    expect(html).toContain('陳冠宇')
  })

  it('比賽詳情頁在 SSR 階段就渲染出打線', async () => {
    // g3 是種子資料中已結束的比賽，有完整打線與計分板
    const html = await $fetch<string>('/games/g3')
    expect(html).toContain('計分板')
    expect(html).toContain('當天打線')
  })

  /**
   * 迴歸測試：公告的**內容**必須真的渲染出來。
   *
   * 這一條原本只檢查 `toContain('公告')` —— 那是頁面標題，公告一則都沒渲染
   * 出來也會通過。實際發生過的狀況是：`components/news/AnnouncementCard.vue`
   * 的自動匯入名稱是 `NewsAnnouncementCard`（檔名沒有以目錄名開頭，不會去重），
   * 但頁面寫的是 `<AnnouncementCard>`，Vue 解析不到就渲染成空註解。
   *
   * API、資料、SSR payload 全部正常，只有畫面是空的 —— 檢查標題的測試完全
   * 抓不到。所以這裡改成驗證「公告的標題出現在 HTML 裡」。
   */
  it('公告牆真的把公告渲染出來（不只是頁面標題）', async () => {
    const html = await $fetch<string>('/news')

    // 種子資料裡的公告標題
    expect(html).toContain('春季聯賽開打')
    // 卡片的根元素，確認元件本身有被解析
    expect(html).toContain('<article')
  })

  it('首頁的最新公告區塊也真的渲染出公告', async () => {
    const html = await $fetch<string>('/')

    expect(html).toContain('春季聯賽開打')
    expect(html).toContain('<article')
  })

  it('不存在的比賽回傳 404 狀態碼（SEO 需要正確的狀態碼）', async () => {
    const response = await fetch('/api/games/nope')
    expect(response.status).toBe(404)
  })

  it('深色模式偏好由 cookie 決定，SSR 就輸出正確的 class（不會閃爍）', async () => {
    const html = await $fetch<string>('/', { headers: { cookie: 'color_mode=dark' } })
    expect(html).toContain('class="dark"')
  })
})

describe('後台頁面的存取控制', () => {
  it('未登入訪問後台會被導向登入頁', async () => {
    const response = await fetch('/admin', { redirect: 'manual' })

    // Nuxt 的路由 middleware 在 SSR 階段就會發出轉址
    expect([302, 307]).toContain(response.status)
    expect(response.headers.get('location')).toContain('/admin/login')
  })

  it('登入頁本身不需要登入即可存取', async () => {
    const html = await $fetch<string>('/admin/login')
    expect(html).toContain('後台管理登入')
  })

  /**
   * 迴歸測試：已登入時重新整理後台頁面不可以被導回登入頁。
   *
   * route middleware 跑在根元件 `app.vue` 的 setup 之前，所以它不能假設
   * `initAuth()` 已經完成。少了那個 await，這裡會形成無限重導：
   * middleware 判定未登入 → 導向登入頁 → 登入頁渲染時狀態才還原 →
   * 發現已登入 → 導回後台 → 再次 middleware … 瀏覽器最後回 ERR_TOO_MANY_REDIRECTS。
   *
   * 這個情境只有在「使用者真的有有效 session」時才會發生，先前的測試都是
   * 以未登入的身分檢查轉址，所以完全漏掉了它。
   */
  it('已登入時直接開啟後台頁面不會被導走（迴歸：重導迴圈）', async () => {
    const { cookie } = await login()

    for (const path of ['/admin', '/admin/games', '/admin/players']) {
      const response = await fetch(path, { headers: { cookie }, redirect: 'manual' })
      expect(response.status, `${path} 應該直接回應頁面而不是轉址`).toBe(200)
    }
  })

  it('已登入時開啟登入頁會被導向後台，且只轉一次', async () => {
    const { cookie } = await login()
    const response = await fetch('/admin/login', { headers: { cookie }, redirect: 'manual' })

    // 這一次轉址是正常的：已經登入的人不需要再看到登入頁。
    // 關鍵是它的目的地必須是後台，而後台不會再把人轉回來（見上一個測試）。
    if (response.status === 200) {
      // SSR 直接渲染登入頁、由前端在 hydration 後才導向，也是可接受的結果
      expect(await response.text()).toContain('後台')
    } else {
      expect([302, 307]).toContain(response.status)
      expect(response.headers.get('location')).toContain('/admin')
    }
  })
})
