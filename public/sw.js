/* eslint-env serviceworker */
/**
 * Service Worker —— 離線快取與推播。
 *
 * ## 為什麼是手寫的，不是 Workbox
 * 這個站要的策略就三條（建置產物 cache-first、頁面 network-first、API 不碰），
 * 而推播的 `push` / `notificationclick` / `pushsubscriptionchange` 本來就得自己寫。
 * 為了三條規則引進一整套建置期外掛與 precache manifest，維護成本大於收益 ——
 * 跟 `server/middleware/10.security-headers.ts` 不用 nuxt-security 是同一個判斷。
 *
 * ## 快取策略
 * ```
 * /_nuxt/**        cache-first   檔名含內容雜湊，改了就是新網址，可以放心永久快取
 * 導覽（HTML）      network-first 先要新的，失敗才用快取 —— 資料新鮮度優先
 * 其他同源靜態檔    stale-while-revalidate
 * /api/**          不處理        BFF 的回應永遠要即時，尤其後台
 * /admin**         不處理        個人狀態不進任何快取
 * ```
 *
 * ## 沒有 precache，也沒有 /offline 頁面
 * 預先快取一份 HTML 會帶來版本問題：那份 HTML 指向的 `_nuxt` 檔名會隨著下一次
 * 部署失效，而 SW 沒有被動更新的時機。改成「使用者看過的頁面才快取」，
 * 完全沒去過又離線時才回傳下面那份由 SW 自己組出來的極簡頁面。
 */

/** 改這個值會讓舊快取在下次啟用時被清掉。 */
const VERSION = 'v1'
const ASSET_CACHE = `hgm-assets-${VERSION}`
const PAGE_CACHE = `hgm-pages-${VERSION}`

/** 頁面快取的上限。球隊官網頁數不多，40 筆綽綽有餘。 */
const PAGE_CACHE_LIMIT = 40

/** 離線又沒有快取時的兜底頁面。樣式直接內嵌，因為此時可能連 CSS 都拿不到。 */
const OFFLINE_HTML = `<!doctype html>
<html lang="zh-TW"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>目前離線</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
       background:#071221;color:#f2f5f8;text-align:center;padding:1.5rem;
       font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang TC","Noto Sans TC",sans-serif}
  h1{font-size:1.5rem;margin:0 0 .75rem}
  p{color:#9fb0c0;line-height:1.7;margin:0 0 1.5rem}
  button{min-height:2.75rem;padding:0 1.75rem;border:0;cursor:pointer;
         background:#ddb63b;color:#071221;font-weight:700;font-size:1rem}
</style></head>
<body><div>
  <h1>目前離線</h1>
  <p>這個頁面還沒有離線版本。<br>連上網路後再試一次。</p>
  <button onclick="location.reload()">重新載入</button>
</div></body></html>`

self.addEventListener('install', (event) => {
  // 沒有 precache，直接接手：使用者不必關掉所有分頁才等到新版
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(
        keys.filter((key) => key !== ASSET_CACHE && key !== PAGE_CACHE).map((key) => caches.delete(key)),
      )
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event

  // 只處理同源的 GET。其他一律讓瀏覽器照原本的方式走。
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // BFF 的回應與後台頁面永遠不進快取
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/admin')) return

  if (url.pathname.startsWith('/_nuxt/')) {
    event.respondWith(cacheFirst(request, ASSET_CACHE))
    return
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request))
    return
  }

  event.respondWith(staleWhileRevalidate(request, ASSET_CACHE))
})

/** 內容雜湊過的檔案：快取有就直接用，不必問網路。 */
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request)
  if (cached) return cached

  const response = await fetch(request)
  if (isCacheable(response)) {
    const cache = await caches.open(cacheName)
    await cache.put(request, response.clone())
  }
  return response
}

/** 頁面：先要新的。拿不到才退回快取，再不行就是兜底頁面。 */
async function networkFirst(request) {
  try {
    const response = await fetch(request)
    if (isCacheable(response)) {
      const cache = await caches.open(PAGE_CACHE)
      await cache.put(request, response.clone())
      await trimCache(PAGE_CACHE, PAGE_CACHE_LIMIT)
    }
    return response
  } catch {
    const cached = await caches.match(request)
    if (cached) return cached
    return new Response(OFFLINE_HTML, {
      status: 503,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })
  }
}

/** 先把快取送出去，同時在背景更新。圖示這類偶爾會換的檔案適用。 */
async function staleWhileRevalidate(request, cacheName) {
  const cached = await caches.match(request)
  const network = fetch(request)
    .then(async (response) => {
      if (isCacheable(response)) {
        const cache = await caches.open(cacheName)
        await cache.put(request, response.clone())
      }
      return response
    })
    .catch(() => undefined)

  return cached ?? (await network) ?? fetch(request)
}

/**
 * 只快取「自己站上、狀態 200、非 partial」的回應。
 *
 * `response.type === 'basic'` 這條不能省：不透明回應（opaque，跨域的 no-cors）
 * 的 status 一律是 0，存進去之後永遠拿不回內容，只會佔空間。
 */
function isCacheable(response) {
  return Boolean(response) && response.status === 200 && response.type === 'basic'
}

/** 超過上限就從最舊的開始丟。Cache API 的 keys() 是插入順序。 */
async function trimCache(cacheName, limit) {
  const cache = await caches.open(cacheName)
  const keys = await cache.keys()
  if (keys.length <= limit) return
  await Promise.all(keys.slice(0, keys.length - limit).map((key) => cache.delete(key)))
}

/* ══ 推播 ══════════════════════════════════════════════════════════ */

/**
 * 收到推播。
 *
 * payload 由 BFF 送出（見 `server/utils/push.ts`），格式固定是
 * `{ title, body, url, tag }`。解析失敗也要顯示通知 —— 規格要求收到 push
 * 事件就必須顯示一則，否則瀏覽器會對這個網站降級甚至撤銷推播權限。
 */
self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = { body: event.data ? event.data.text() : '' }
  }

  const title = payload.title || 'HG MERCENARIES'
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      // 同 tag 的通知會取代前一則，避免同一件事洗版
      tag: payload.tag || 'hgm-general',
      data: { url: payload.url || '/' },
      lang: 'zh-TW',
    }),
  )
})

/**
 * 點通知：已經開著就聚焦那個分頁，否則開新的。
 *
 * 目標網址強制限制在本站。後端的 `pushPayloadSchema` 已經擋過一次，
 * 這裡再擋一次是因為**推播酬載是從網路來的** —— 只要有任何一條路徑能送出
 * 自訂 payload，這裡就是最後一道防線。開放重導向的通知（外觀來自球隊、
 * 點下去是別人的網站）是釣魚最好用的載體。
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  let target = new URL('/', self.location.origin)
  try {
    const candidate = new URL(event.notification.data?.url || '/', self.location.origin)
    if (candidate.origin === self.location.origin) target = candidate
  } catch {
    // 解析不了就用首頁，不要讓點擊沒有反應
  }

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of windows) {
        if (new URL(client.url).origin !== target.origin) continue
        await client.focus()
        if (client.url !== target.href) await client.navigate(target.href)
        return
      }
      await self.clients.openWindow(target.href)
    })(),
  )
})

/**
 * 訂閱被瀏覽器換掉時自動重新註冊。
 *
 * 推送服務會定期輪替 endpoint。少了這段，使用者不會有任何感覺，
 * 但從某一天開始就再也收不到推播了 —— 而且完全不會有錯誤訊息。
 */
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      const key = event.oldSubscription?.options?.applicationServerKey
      if (!key) return

      const subscription = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key,
      })

      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          subscription: subscription.toJSON(),
          replaces: event.oldSubscription?.endpoint,
        }),
      })
    })(),
  )
})
