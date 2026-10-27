#!/usr/bin/env node
/**
 * 重新產生部落格文章的截圖（`docs/blog/images/`）。
 *
 * ```bash
 * pnpm screenshots              # 沿用現有的 .output（快）
 * pnpm screenshots --build      # 強制重新建置
 * pnpm screenshots home schedule  # 只拍指定的場景
 * ```
 *
 * 場景清單在 `scripts/screenshot-scenes.mjs` —— 要加新畫面改那一個檔案。
 *
 * ## 做了什麼
 * 1. 用**正式建置**（`.output`）起一個跑在示範資料上的伺服器（`ALLOW_MEMORY_STORE=true`）
 * 2. 用開發模式登入換一個 session cookie，給後台場景用
 * 3. 開一個無頭 Chrome，照場景清單逐一拍照
 *
 * ## 為什麼是正式建置而不是 `nuxt dev`
 * 和 e2e 同一個理由：dev 的畫面不是使用者看到的畫面（devtools 浮標、沒有壓縮的
 * 字體、不同的 hydration 時序）。而文章裡的圖就是要給人看「它長什麼樣子」。
 *
 * ## ⚠️ 外部服務一律隔離
 * 下面那串環境變數和 `tests/e2e/bff.test.ts` 開頭是同一份清單：`.env` 一旦有真
 * 憑證，截圖就會連上**正式的 Firestore**、真的去打氣象署與 Gemini。
 * **新增任何外部服務的金鑰時，記得回來加一行。**
 *
 * ## 為什麼不用 Puppeteer
 * Node 內建的 `WebSocket` 直接講得了 Chrome DevTools Protocol，而這支腳本只需要
 * 「開分頁、設視窗、拍照」三件事。少一個 devDependency，就少一次「Chromium 下載
 * 失敗導致 CI 掛掉」。
 */
import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SCENES, VIEWPORTS } from './screenshot-scenes.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = path.join(ROOT, 'docs/blog/images')
const PORT = 3100
const CDP_PORT = 9333
const ORIGIN = `http://localhost:${PORT}`

/** 整頁截圖的高度上限。超過的話那張圖在文章裡也沒有人看得完。 */
const MAX_FULL_PAGE_HEIGHT = 12_000

const CHROME_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
]

/**
 * ⚠️ 和 `tests/e2e/bff.test.ts` 同一份隔離清單。
 *
 * MLB 那一支沒有金鑰可以清，要清的是基底網址 —— 它躲得過「清掉所有 `*_API_KEY`」
 * 那條檢查。
 */
const ISOLATED_ENV = {
  NUXT_FIREBASE_PROJECT_ID: '',
  NUXT_FIREBASE_CLIENT_EMAIL: '',
  NUXT_FIREBASE_PRIVATE_KEY: '',
  NUXT_FIREBASE_STORAGE_BUCKET: '',
  NUXT_FIREBASE_WEB_API_KEY: '',
  NUXT_GEMINI_API_KEY: '',
  NUXT_CWA_API_KEY: '',
  NUXT_YOUTUBE_CLIENT_ID: '',
  NUXT_YOUTUBE_CLIENT_SECRET: '',
  NUXT_YOUTUBE_REFRESH_TOKEN: '',
  NUXT_PUBLIC_WS_BRACKET_DATABASE_URL: '',
  NUXT_MLB_BASE_URL: '',
  // 一次拍十幾張圖、每張又帶好幾支內部請求，預設額度會撞到 429
  NUXT_RATE_LIMIT_MAX: '100000',
  // 比賽頁的輪詢對截圖只是雜訊
  NUXT_PUBLIC_GAME_POLL_MS: '0',
}

/**
 * 拍照前注入的樣式。
 *
 * ⚠️ `.reveal.is-pending` 這一條不能省 —— 捲動淺入的元素在視窗外是
 * `opacity: 0`，而整頁截圖拍的正是「視窗外」的那一大半。少了它，首頁以下的
 * 每一個區塊都會是一片空白，而且**畫面上完全看不出原因**（看起來就像頁面只
 * 畫了第一屏）。
 */
const SCREENSHOT_CSS = `
  .reveal.is-pending { opacity: 1 !important; transform: none !important; }
  /*
   * ⚠️ 全站的 scroll-behavior 是 smooth（main.css），而平滑捲動是**非同步**的 ——
   * 聚焦某一區的場景捲完立刻拍照，拍到的是還停在頁首的那一幀，而且
   * 「捲過去了沒」在圖上看不出來（只是拍到別的地方）。
   */
  html { scroll-behavior: auto !important; }
  *, *::before, *::after {
    transition-duration: 0s !important;
    animation-duration: 0s !important;
    animation-delay: 0s !important;
    caret-color: transparent !important;
  }
  #nuxt-devtools-anchor, .nuxt-devtools-anchor { display: none !important; }
`

// ── 小工具 ──────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function exists(target) {
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}

function log(message) {
  console.log(message)
}

/** 跑一個指令並把輸出直接接到終端機（建置要看得到進度）。 */
function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      env: { ...process.env, ...env },
      stdio: 'inherit',
    })
    child.on('error', reject)
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} 結束於 exit code ${code}`)),
    )
  })
}

// ── Chrome DevTools Protocol（只用到最小的一組） ────────────────────

/**
 * 連上 CDP 並包成「送指令／等回應」的介面。
 *
 * 用 flat session（`flatten: true`）：所有分頁共用同一條 WebSocket，指令靠
 * `sessionId` 分流，不必替每個分頁各開一條連線。
 */
async function connectCdp(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', () => reject(new Error('無法連上 Chrome 的除錯介面')), {
      once: true,
    })
  })

  let nextId = 0
  const pending = new Map()
  const waiters = []

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.id !== undefined) {
      const entry = pending.get(message.id)
      if (!entry) return
      pending.delete(message.id)
      if (message.error) entry.reject(new Error(`${entry.method}: ${message.error.message}`))
      else entry.resolve(message.result ?? {})
      return
    }
    // 事件：喚醒所有在等這個 method 的人
    for (let i = waiters.length - 1; i >= 0; i -= 1) {
      const waiter = waiters[i]
      if (waiter.method !== message.method) continue
      if (waiter.sessionId && waiter.sessionId !== message.sessionId) continue
      waiters.splice(i, 1)
      waiter.resolve(message.params ?? {})
    }
  })

  return {
    send(method, params = {}, sessionId) {
      const id = (nextId += 1)
      const payload = { id, method, params }
      if (sessionId) payload.sessionId = sessionId
      socket.send(JSON.stringify(payload))
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject, method }))
    },
    /** 等一個事件，逾時就放棄（頁面可能根本不會發 load，例如完全由快取回應）。 */
    waitForEvent(method, sessionId, timeoutMs = 15_000) {
      return new Promise((resolve) => {
        const waiter = { method, sessionId, resolve }
        waiters.push(waiter)
        setTimeout(() => {
          const index = waiters.indexOf(waiter)
          if (index !== -1) {
            waiters.splice(index, 1)
            resolve(null)
          }
        }, timeoutMs)
      })
    },
    close() {
      socket.close()
    },
  }
}

/** 在分頁裡跑一段程式碼，回傳它的值。 */
async function evaluate(cdp, sessionId, expression) {
  const result = await cdp.send(
    'Runtime.evaluate',
    { expression, awaitPromise: true, returnByValue: true },
    sessionId,
  )
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? '頁面內的程式碼拋出例外')
  }
  return result.result?.value
}

/** 輪詢等一個選擇器出現。比固定延遲可靠，而且失敗時說得出等的是什麼。 */
async function waitForSelector(cdp, sessionId, selector, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const found = await evaluate(
      cdp,
      sessionId,
      `!!document.querySelector(${JSON.stringify(selector)})`,
    )
    if (found) return true
    await sleep(120)
  }
  return false
}

// ── 伺服器 ──────────────────────────────────────────────────────────

async function waitForServer(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${ORIGIN}/api/health`)
      if (response.ok) return
    } catch {
      // 還沒起來
    }
    await sleep(300)
  }
  throw new Error('伺服器在時限內沒有起來')
}

/** 等 Chrome 的除錯介面開好，順便拿到那條 WebSocket 位址。 */
async function waitForCdp(timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://localhost:${CDP_PORT}/json/version`)
      if (response.ok) return await response.json()
    } catch {
      // 還沒起來
    }
    await sleep(200)
  }
  throw new Error('Chrome 的除錯介面沒有開起來')
}

/** 找一個裝好的 Chrome。找不到就明講，而不是讓 spawn 噴一句 ENOENT。 */
async function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH
  for (const candidate of CHROME_PATHS) {
    if (await exists(candidate)) return candidate
  }
  throw new Error('找不到 Chrome。請安裝 Google Chrome，或用 CHROME_PATH 指定執行檔位置')
}

/**
 * 用開發模式登入換一個 session cookie。
 *
 * 記憶體模式下任何 email 配 `password1234` 都過（`server/utils/firebase-auth.ts`
 * 的 `DEV_PASSWORD`）—— 這也是為什麼那個模式在 production 必須被擋下來。
 */
async function loginCookie() {
  const response = await fetch(`${ORIGIN}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'demo@example.com', password: 'password1234' }),
  })
  if (!response.ok) throw new Error(`登入失敗（${response.status}）`)

  const header = response.headers.getSetCookie?.() ?? []
  const cookies = header.map((line) => {
    const [pair] = line.split(';')
    const index = pair.indexOf('=')
    return { name: pair.slice(0, index).trim(), value: pair.slice(index + 1).trim() }
  })
  if (cookies.length === 0) throw new Error('登入成功但沒有拿到 session cookie')
  return cookies
}

// ── 拍一張 ──────────────────────────────────────────────────────────

async function capture(cdp, scene, sessionCookies) {
  const viewport = VIEWPORTS[scene.viewport ?? 'desktop']
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })

  try {
    await cdp.send('Page.enable', {}, sessionId)
    await cdp.send('Runtime.enable', {}, sessionId)
    await cdp.send('Network.enable', {}, sessionId)
    // service worker 會把上一次拍照時的回應餵回來，而 production 建置真的會註冊它
    await cdp.send('Network.setBypassServiceWorker', { bypass: true }, sessionId)

    await cdp.send(
      'Emulation.setDeviceMetricsOverride',
      {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: viewport.scale,
        mobile: viewport.mobile,
      },
      sessionId,
    )
    /*
     * ⚠️ 配色**不是**跟著 `prefers-color-scheme` 走，所以 `Emulation.setEmulatedMedia`
     * 在這裡一點作用都沒有（試過，拍出來還是深色）。這個站的配色由
     * `<head>` 的開機腳本讀 `color_mode` cookie 決定，沒有 cookie 時一律是
     * 深色（`shared/constants/theme.ts` 的 `DEFAULT_COLOR_MODE`）——
     * 因為公開頁面要讓 CDN 快取，SSR 不能因人而異。
     */
    /*
     * ⚠️ cookie 是**整個瀏覽器**共用的，不是這個分頁的 —— 所以場景會互相污染，
     * 而且是沿著清單順序往下污染：淺色那一張設了 `color_mode=light`，它後面
     * 每一張圖就全部變成淺色；後台場景的 session cookie 留下來之後，前台頁面
     * 會多出只有管理者看得到的「後台編輯這場」。兩種都看起來像「畫面本來就長這樣」。
     *
     * 每張圖都從沒有 cookie 的狀態開始，再把這個場景要的明確設回去。
     */
    await cdp.send('Network.clearBrowserCookies', {}, sessionId)
    const cookies = [{ name: 'color_mode', value: scene.theme ?? 'dark' }]
    if (scene.admin) cookies.push(...sessionCookies)
    await cdp.send(
      'Network.setCookies',
      { cookies: cookies.map((cookie) => ({ ...cookie, domain: 'localhost', path: '/' })) },
      sessionId,
    )

    const loaded = cdp.waitForEvent('Page.loadEventFired', sessionId)
    await cdp.send('Page.navigate', { url: `${ORIGIN}${scene.path}` }, sessionId)
    await loaded

    if (scene.waitFor) {
      const found = await waitForSelector(cdp, sessionId, scene.waitFor)
      if (!found) log(`   ⚠️ 等不到 ${scene.waitFor}，照樣拍一張`)
    }

    // 樣式與浮層
    const hidden = (scene.hide ?? []).map((selector) => `${selector} { display: none !important; }`)
    await evaluate(
      cdp,
      sessionId,
      `(() => {
        const style = document.createElement('style')
        style.textContent = ${JSON.stringify(SCREENSHOT_CSS)} + ${JSON.stringify(hidden.join('\n'))}
        document.head.appendChild(style)
      })()`,
    )

    // 字體：`font-display: swap` 的那一瞬間會被定格進圖裡
    await evaluate(cdp, sessionId, 'document.fonts.ready.then(() => true)')

    // 捲回最上面：有些頁面會還原捲動位置。場景的 `script` 要能覆寫這個決定，
    // 所以它排在後面（聚焦某一區的場景就是靠它捲過去的）
    await evaluate(cdp, sessionId, 'window.scrollTo(0, 0)')

    if (scene.fullPage) {
      /*
       * ⚠️ 整頁截圖裡的 `fixed` 元素會停在**原本那一屏**的位置，於是後台的側邊
       * 導覽列與底部分頁列會憑空出現在長圖的正中間，壓住底下的內容 ——
       * 看起來像版面壞掉。改成 `absolute` 之後它們落回文件流的位置。
       * 只有整頁截圖需要這個：一般的視窗截圖拍的本來就是使用者看到的那一屏。
       */
      await evaluate(
        cdp,
        sessionId,
        `(() => {
          for (const el of document.querySelectorAll('body *')) {
            const style = getComputedStyle(el)
            if (style.position !== 'fixed') continue
            /*
             * 貼著畫面下緣的那幾個（後台的分頁列、toast 的容器）轉成 absolute
             * 之後會落在最近的定位祖先裡，也就是長圖的正中間 —— 橫跨整頁壓住
             * 一列內容。它們在一般的視窗截圖裡本來就看得到，長圖裡直接拿掉。
             * 分頁列自己留了等高的佔位，所以版面不會塌。
             *
             * ⚠️ 不能用 top === 'auto' 認它們：getComputedStyle 回傳的是**解析
             * 後**的值，所以 bottom-0 的那一條量到的 top 是 835px 而不是 auto，
             * 條件永遠不成立。改看「貼著下緣」加「高度不到半屏」—— 滿高的側邊
             * 導覽列同樣貼著下緣，但它要留下來。
             * （這段跑在頁面裡，所以註解不能用反引號 —— 會把外層的字串切斷。）
             */
            const height = el.getBoundingClientRect().height
            if (parseFloat(style.bottom) <= 1 && height < window.innerHeight / 2) {
              el.style.display = 'none'
              continue
            }
            el.style.position = 'absolute'
          }
        })()`,
      )
    }

    if (scene.script) {
      const scrolled = await evaluate(
        cdp,
        sessionId,
        `(async () => { ${scene.script}; return Math.round(window.scrollY) })()`,
      )
      if (scrolled === 0) log(`   ⚠️ ${scene.name}：場景腳本跑完仍停在頁面頂端`)
    }
    await sleep(250)

    /*
     * ⚠️ `captureBeyondViewport` 只能給整頁截圖用。開著它又不給 `clip` 的話，
     * Chrome 會直接拍整份內容、**完全無視捲動位置** —— 症狀是每個聚焦場景都拍回
     * 一模一樣的頁首，而檔案大小一樣是唯一看得出來的線索。
     */
    const options = { format: 'png', captureBeyondViewport: Boolean(scene.fullPage) }
    if (scene.fullPage) {
      const metrics = await cdp.send('Page.getLayoutMetrics', {}, sessionId)
      const content = metrics.cssContentSize ?? metrics.contentSize
      options.clip = {
        x: 0,
        y: 0,
        width: viewport.width,
        height: Math.min(Math.ceil(content.height), MAX_FULL_PAGE_HEIGHT),
        scale: 1,
      }
    }

    const { data } = await cdp.send('Page.captureScreenshot', options, sessionId)
    const file = path.join(OUT_DIR, `${scene.name}.png`)
    await writeFile(file, Buffer.from(data, 'base64'))
    const size = Buffer.from(data, 'base64').length
    return { file, size, height: options.clip?.height ?? viewport.height }
  } finally {
    await cdp.send('Target.closeTarget', { targetId }).catch(() => {})
  }
}

// ── 主流程 ──────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2)
  const forceBuild = args.includes('--build')
  const only = args.filter((arg) => !arg.startsWith('--'))
  const scenes = only.length > 0 ? SCENES.filter((scene) => only.includes(scene.name)) : SCENES

  if (scenes.length === 0) {
    throw new Error(`找不到場景：${only.join(', ')}（可用的在 scripts/screenshot-scenes.mjs）`)
  }

  await mkdir(OUT_DIR, { recursive: true })

  const serverEnv = {
    ...ISOLATED_ENV,
    NODE_ENV: 'production',
    ALLOW_MEMORY_STORE: 'true',
    NITRO_PORT: String(PORT),
    PORT: String(PORT),
    // 示範資料用的 session 密鑰，和正式環境無關
    NUXT_SESSION_PASSWORD: 'screenshot-only-session-password-0123456789',
  }

  if (forceBuild || !(await exists(path.join(ROOT, '.output/server/index.mjs')))) {
    log('▶ 建置（約一分鐘）…')
    await run('pnpm', ['build'], ISOLATED_ENV)
  } else {
    log('▶ 沿用現有的 .output（要重新建置請加 --build）')
  }

  log(`▶ 啟動伺服器（:${PORT}，示範資料）…`)
  const server = spawn('node', ['.output/server/index.mjs'], {
    cwd: ROOT,
    env: { ...process.env, ...serverEnv },
    stdio: ['ignore', 'ignore', 'inherit'],
  })

  let chrome
  let userDataDir
  let cdp
  try {
    await waitForServer()
    const cookies = await loginCookie()

    const chromePath = await findChrome()
    log('▶ 啟動無頭 Chrome…')
    userDataDir = await mkdtemp(path.join(tmpdir(), 'blog-screenshots-'))
    chrome = spawn(
      chromePath,
      [
        '--headless=new',
        `--remote-debugging-port=${CDP_PORT}`,
        `--user-data-dir=${userDataDir}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--hide-scrollbars',
        '--force-color-profile=srgb',
        '--disable-lcd-text',
        'about:blank',
      ],
      { stdio: ['ignore', 'ignore', 'ignore'] },
    )

    const version = await waitForCdp()
    cdp = await connectCdp(version.webSocketDebuggerUrl)

    log(`▶ 拍 ${scenes.length} 張…\n`)
    for (const scene of scenes) {
      const result = await capture(cdp, scene, cookies)
      const kb = Math.round(result.size / 1024)
      log(`   ✓ ${scene.name}.png  ${kb}KB  (h=${result.height})  ${scene.description ?? ''}`)
    }
    log(`\n完成：${path.relative(ROOT, OUT_DIR)}/`)
  } finally {
    cdp?.close()
    chrome?.kill()
    server.kill()
    /*
     * Chrome 被 kill 之後還會再寫一下 profile，所以要等它真的結束 ——
     * 不等的話 `rm` 會噴 ENOTEMPTY，而那發生在截圖已經全部成功之後，
     * 看起來就像整支腳本失敗了。清不掉也只是暫存目錄，不值得讓它變成錯誤。
     */
    if (userDataDir) {
      await sleep(500)
      await rm(userDataDir, { recursive: true, force: true }).catch(() => {})
    }
  }
}

main().catch((error) => {
  console.error(`\n✗ ${error.message}`)
  process.exit(1)
})
