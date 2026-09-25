/**
 * 一次性取得 YouTube 的 refresh token。
 *
 * 賽事錄影要把片段上傳到球隊的 YouTube 頻道（見 `docs/game-recording-plan.md`）。
 * BFF 手上只會有一個 refresh token，用它去換短效的 access token ——
 * 而那個 refresh token 必須由真人授權一次才拿得到。這支腳本就是那一次。
 *
 * ## 用法
 * ```bash
 * NUXT_YOUTUBE_CLIENT_ID=xxx NUXT_YOUTUBE_CLIENT_SECRET=yyy pnpm youtube:auth
 * ```
 *
 * 它會開瀏覽器、等你登入同意、然後把 refresh token 印在終端機上。
 *
 * ## ⚠️ 授權時要用「放影片的那個帳號」登入
 * Client ID／Secret 代表的是**哪一個應用程式**，refresh token 代表的是
 * **代表哪一個帳號**。兩者可以屬於不同的 Google 帳號 —— 專案在 A 帳號下、
 * 影片傳到 B 帳號的頻道，是完全正常的組合。**所以登入時要選 B。**
 *
 * ## ⚠️ 發布狀態必須是「正式版」
 * OAuth 同意畫面停在「測試中」的話，拿到的 refresh token **7 天就過期**，
 * 功能會每週壞一次。跑這支腳本之前先確認狀態是「正式版」。
 * （未驗證沒關係 —— 授權時會看到「Google 尚未驗證這個應用程式」的警告，
 * 點「進階」→「前往…」即可。）
 */
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'

const PORT = 8787
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`

/**
 * 要求的範圍。
 *
 * - `youtube.upload`：上傳影片，這是主要用途
 * - `youtube.readonly`：把影片的可見度讀回來
 *
 * 為什麼需要第二個：透過 API 上傳的影片一律是私人的（未通過 YouTube 合規
 * 稽核的專案強制如此），管理者要手動改成公開。改完之後後台要能問 YouTube
 * 「現在是什麼狀態了」，否則前台不知道哪幾段可以顯示。
 *
 * 刻意**不要**整個 `youtube` 範圍：那還包含修改與刪除。目前的功能不需要，
 * 而這個 token 會長期存在 Secret Manager 裡。
 */
const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
]

const clientId = process.env.NUXT_YOUTUBE_CLIENT_ID
const clientSecret = process.env.NUXT_YOUTUBE_CLIENT_SECRET

if (!clientId || !clientSecret) {
  console.error('\n✖ 缺少設定。請這樣執行：\n')
  console.error('  NUXT_YOUTUBE_CLIENT_ID=xxx NUXT_YOUTUBE_CLIENT_SECRET=yyy pnpm youtube:auth\n')
  console.error('這兩個值在 Google Cloud Console →「憑證」→ 你的 OAuth 2.0 用戶端 ID。\n')
  process.exit(1)
}

/** 防 CSRF：Google 會把它原封不動送回來，對不上就不是我們發起的那次授權。 */
const state = randomBytes(16).toString('hex')

const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
authUrl.searchParams.set('client_id', clientId)
authUrl.searchParams.set('redirect_uri', REDIRECT_URI)
authUrl.searchParams.set('response_type', 'code')
authUrl.searchParams.set('scope', SCOPES.join(' '))
authUrl.searchParams.set('state', state)
// offline 才會給 refresh token；consent 強制重新顯示同意畫面 ——
// 沒有它的話，已經授權過的帳號只會拿到 access token，refresh token 是空的
authUrl.searchParams.set('access_type', 'offline')
authUrl.searchParams.set('prompt', 'consent')

console.log(`
╭──────────────────────────────────────────────────────────╮
│  YouTube 授權                                            │
╰──────────────────────────────────────────────────────────╯

⚠️ 開始之前，這個網址必須已經加進 OAuth 用戶端的「已授權的重新導向 URI」：

     ${REDIRECT_URI}

   （Google Cloud Console →「憑證」→ 你的 OAuth 2.0 用戶端 ID）
   沒加的話會看到 redirect_uri_mismatch。

1. 瀏覽器即將開啟，請用**放影片的那個 Google 帳號**登入
2. 看到「Google 尚未驗證這個應用程式」是正常的
   → 點「進階」→「前往（你的應用程式名稱）」
3. 同意之後這裡會印出 refresh token

如果瀏覽器沒有自動開啟，手動打開這個網址：

${authUrl}
`)

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)
  if (url.pathname !== '/oauth2callback') {
    res.writeHead(404).end()
    return
  }

  const reply = (message) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(
      `<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:3rem;line-height:1.7">${message}</body>`,
    )
  }

  const error = url.searchParams.get('error')
  if (error) {
    reply(`<h1>授權失敗</h1><p>${error}</p><p>回到終端機看說明。</p>`)
    console.error(`\n✖ 授權被拒絕：${error}`)
    if (error === 'access_denied') {
      console.error('\n如果你沒有按「取消」，那多半是同意畫面的「測試使用者」沒有加到這個帳號。')
    }
    finish(1)
    return
  }

  if (url.searchParams.get('state') !== state) {
    reply('<h1>授權失敗</h1><p>state 不符，可能不是這次流程發起的請求。</p>')
    console.error('\n✖ state 不符，已中止。請重新執行一次。')
    finish(1)
    return
  }

  const code = url.searchParams.get('code')
  if (!code) {
    reply('<h1>授權失敗</h1><p>沒有拿到授權碼。</p>')
    finish(1)
    return
  }

  const token = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  }).then((r) => r.json())

  // 兩種失敗要分開講：Google 明確回錯誤，和「有 access token 但沒有 refresh token」
  if (token.error) {
    reply('<h1>授權失敗</h1><p>回到終端機看說明。</p>')
    console.error(
      `\n✖ 換取權杖失敗：${token.error}` +
        (token.error_description ? ` — ${token.error_description}` : ''),
    )
    if (token.error === 'redirect_uri_mismatch') {
      console.error(
        `\n把這個網址加進 OAuth 用戶端的「已授權的重新導向 URI」再試一次：\n\n  ${REDIRECT_URI}\n`,
      )
    } else if (token.error === 'invalid_client') {
      console.error('\nClient ID 或 Secret 不對，請回 Console 對一次。\n')
    }
    finish(1)
    return
  }

  if (!token.refresh_token) {
    reply('<h1>授權失敗</h1><p>沒有拿到 refresh token，回到終端機看說明。</p>')
    console.error('\n✖ 拿到了 access token，但沒有 refresh token。')
    console.error(
      '\n這通常表示這個帳號之前已經授權過同一個用戶端。' +
        '\n到 https://myaccount.google.com/permissions 移除該應用程式後再跑一次。\n',
    )
    finish(1)
    return
  }

  reply('<h1>✅ 完成</h1><p>可以關掉這個分頁，回到終端機。</p>')

  // 順手問一下這把 token 實際綁到哪個頻道 —— 授權時選錯帳號是很容易發生的事，
  // 而錯了要等到影片傳到別人的頻道才會發現
  let channel = ''
  try {
    const me = await fetch(
      'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
      { headers: { authorization: `Bearer ${token.access_token}` } },
    ).then((r) => r.json())
    channel = me?.items?.[0]?.snippet?.title ?? ''
  } catch {
    // 查不到不影響主要目的，略過
  }

  console.log(`
╭──────────────────────────────────────────────────────────╮
│  ✅ 拿到 refresh token                                   │
╰──────────────────────────────────────────────────────────╯
${channel ? `\n影片會上傳到這個頻道：${channel}\n（不是你要的頻道就重跑一次，登入時選對帳號）\n` : ''}
${token.refresh_token}

接著把三個值寫進 Secret Manager：

  echo -n "${clientId}" | firebase apphosting:secrets:set youtube-client-id --project hg-baseball --data-file -
  echo -n "<你的 client secret>" | firebase apphosting:secrets:set youtube-client-secret --project hg-baseball --data-file -
  echo -n "<上面那串 refresh token>" | firebase apphosting:secrets:set youtube-refresh-token --project hg-baseball --data-file -

⚠️ CLI 問「要不要加進 apphosting.yaml」時選 No（理由見該檔案的註解）。
⚠️ 別把 refresh token 貼進 git、聊天室或任何會留紀錄的地方。
`)
  finish(0)
})

function finish(code) {
  server.close(() => process.exit(code))
}

server.listen(PORT, () => {
  open(authUrl.toString())
})

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n✖ 連接埠 ${PORT} 已被占用。關掉占用它的程式後再試一次。\n`)
    process.exit(1)
  }
  throw err
})

/** 開瀏覽器。失敗不是問題 —— 網址已經印在上面了，手動貼也一樣。 */
function open(target) {
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
  spawn(command, [target], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' })
    .on('error', () => {})
    .unref()
}
