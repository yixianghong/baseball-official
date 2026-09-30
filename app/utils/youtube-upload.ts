/**
 * 把一個影片檔送上 YouTube（resumable upload 協定）。
 *
 * 這裡只有「怎麼把位元組送上去」。**誰要傳、傳完要登錄到哪一個半局**是
 * 呼叫端的事 —— 目前有兩個呼叫端，而且它們共用這一份實作：
 *
 * - `useClipUpload()`：球場邊錄完一段就排進佇列（`/admin/record/[id]`）
 * - `/admin/upload/[id]`：從裝置挑現成的影片檔上傳（外接相機拍的）
 *
 * ## 檔案不經過我們的伺服器
 * BFF 只發一個短效權杖（`/api/admin/youtube/upload-token`），瀏覽器拿著它
 * **直傳 YouTube**。一段 1080p 有 85～140 MB，外接相機的 4K 檔案甚至上看
 * 幾 GB —— 經過 Cloud Run 就是記憶體、逾時與雙倍流量三個問題一起來。
 *
 * ## ⚠️ 為什麼要分塊傳，不是一次 PUT
 * 原本是一次 `xhr.send(blob)` 把整段送完。錄影頁錄出來的 140 MB 還撐得住，
 * 但外接相機（Insta360 GO Ultra 這類）一個半局動輒 1～6 GB —— 在球場或家裡
 * 的網路上，一次送完的成功率會低到「重試」變成主要路徑，而**單次 PUT 的重試
 * 是從第 0 個位元組重來**。傳了四十分鐘在 92% 斷掉，然後從頭開始。
 *
 * 分塊之後，斷線只損失**當前這一塊**（8 MB），而且 `offset` 記在佇列項目上，
 * 隔一段時間再按重試也接得回去。
 *
 * ⚠️ **塊的大小必須是 256 KiB 的倍數**（Google 的硬性要求，最後一塊除外）。
 * 不是倍數時伺服器會回 400，而訊息只說 range 不合法。
 *
 * ## 伺服器確認到哪裡，優先聽它的
 * 每一塊送完，伺服器回 308 並在 `Range` 標頭上說「我收到 0-N 了」。
 * ⚠️ 跨網域能不能讀到那個標頭取決於 `Access-Control-Expose-Headers`，
 * 讀不到時就退回「這一塊完整送達」的假設（回 308 本來就代表這件事）。
 * 兩條路都對，只是前者在「送到一半才斷」時能少重傳一點。
 */

/** 開一個上傳工作階段。`part` 決定我們能在 metadata 裡帶哪些欄位。 */
const UPLOAD_INIT_URL =
  'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status'

/**
 * 每一塊 8 MiB。
 *
 * 太小的話，一個 4 GB 的檔案要送五百多次請求，每一次的來回延遲都是純成本；
 * 太大的話，一次失敗要重傳的量又回到原點。8 MiB 在行動網路上大約幾秒鐘，
 * 是「失敗損失」與「請求數」之間還算舒服的位置。
 */
export const CHUNK_BYTES = 8 * 1024 * 1024

/** Google 要求每一塊（最後一塊除外）都是這個數字的倍數。 */
export const CHUNK_ALIGNMENT = 256 * 1024

/**
 * YouTube 頻道每天可以上傳幾支影片是有上限的，而且**和 API 的配額是兩回事**。
 * Google 沒有公布確切數字，會依頻道的歷史與帳號信譽浮動（實務上約 15～50），
 * 觸頂後要等 24 小時。一場七局十四段很容易在一天之內撞到。
 */
export class UploadLimitError extends Error {}

export const UPLOAD_LIMIT_MESSAGE =
  '已達 YouTube 今日的上傳數量上限。影片都還在這台裝置上，24 小時後再按重試，或自己上傳後到後台補登。'

/** 缺任何一個環境變數都會走到這裡，訊息要講清楚要去哪裡補。 */
export const NOT_CONFIGURED_MESSAGE =
  '尚未設定 YouTube 上傳（缺 NUXT_YOUTUBE_CLIENT_ID／SECRET／REFRESH_TOKEN）'

/**
 * 下一塊要送哪個區間（`end` 含），沒有了就回 `null`。
 *
 * 純函式，因為邊界（最後一塊不滿、offset 剛好等於總長、總長為 0）正是最容易
 * 寫錯而且在真的上傳時最難重現的地方。
 */
export function nextChunk(
  offset: number,
  total: number,
  chunkBytes: number = CHUNK_BYTES,
): { start: number; end: number } | null {
  if (offset >= total) return null
  const size = Math.max(CHUNK_ALIGNMENT, Math.floor(chunkBytes / CHUNK_ALIGNMENT) * CHUNK_ALIGNMENT)
  return { start: offset, end: Math.min(offset + size, total) - 1 }
}

/**
 * 從 308 回應的 `Range` 標頭讀出伺服器確認到哪裡（回傳「下一個位元組的位移」）。
 *
 * 讀不到標頭（跨網域沒 expose）或格式不認得時，退回 `fallbackEnd + 1` ——
 * 也就是「這一塊完整送達」。回 308 本來就代表伺服器收下了我們送的範圍，
 * 所以這個假設是安全的，只是在「送到一半斷線」時會多重傳一點。
 */
export function parseCommittedOffset(rangeHeader: string | null, fallbackEnd: number): number {
  const match = /bytes=0-(\d+)/.exec(rangeHeader ?? '')
  if (!match) return fallbackEnd + 1
  return Number(match[1]) + 1
}

/**
 * 從 Google 的錯誤回應裡撈出原因與可讀訊息。
 *
 * `reason` 是機器判讀用的（例如 `uploadLimitExceeded`、`quotaExceeded`），
 * `message` 是給人看的。只回其中一個都不夠：前者沒法顯示，後者沒法分支。
 */
export function describeUploadFailure(body: string): { reason: string; message: string } {
  try {
    const parsed = JSON.parse(body)
    return {
      reason: parsed?.error?.errors?.[0]?.reason ?? '',
      message: parsed?.error?.message ?? parsed?.error_description ?? '沒有說明',
    }
  } catch {
    return { reason: '', message: body.slice(0, 120) || '沒有說明' }
  }
}

/**
 * 第一步：告訴 YouTube 要傳什麼，拿回一個上傳網址。
 *
 * 這個網址本身就是憑證（帶著它就能把位元組送進這支影片），有效期約一週。
 */
export async function createUploadSession(options: {
  accessToken: string
  title: string
  description: string
  size: number
  contentType: string
}): Promise<string> {
  const response = await fetch(UPLOAD_INIT_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${options.accessToken}`,
      'content-type': 'application/json',
      'x-upload-content-type': options.contentType,
      'x-upload-content-length': String(options.size),
    },
    body: JSON.stringify({
      snippet: { title: options.title, description: options.description },
      // 送 private 只是表明意圖 —— 未通過合規稽核的專案本來就強制私人
      status: { privacyStatus: 'private', selfDeclaredMadeForKids: false },
    }),
  })

  if (!response.ok) {
    /*
     * 把 YouTube 真正說的話帶出來。
     *
     * 只回一個狀態碼的話，使用者（和之後除錯的人）完全不知道是配額用完、
     * 權杖沒有上傳範圍、還是頻道沒驗證。這幾種的處理方式完全不同，
     * 而這是唯一會告訴你的地方。
     */
    const { reason, message } = describeUploadFailure(await response.text())
    if (reason === 'uploadLimitExceeded') throw new UploadLimitError()
    throw new Error(`YouTube 拒絕上傳（${response.status}）：${message}`)
  }

  const location = response.headers.get('location')
  if (!location) throw new Error('YouTube 沒有回傳上傳位址')
  return location
}

/** 一塊送完之後伺服器說的話。 */
type ChunkOutcome = { done: true; videoId: string } | { done: false; offset: number }

/**
 * 第二步：把位元組分塊送上去，回傳 videoId。
 *
 * 用 `XMLHttpRequest` 而不是 `fetch` —— 只有它有 `upload.onprogress`。
 * 傳一段要好幾分鐘（大檔案是好幾十分鐘），沒有進度的話使用者不知道是在傳
 * 還是卡住了。
 */
export async function uploadChunks(options: {
  location: string
  blob: Blob
  /** 從這個位移接著傳。重試時帶上一次確認到的位置。 */
  startAt?: number
  chunkBytes?: number
  onProgress: (percent: number, offset: number) => void
  signal?: AbortSignal
}): Promise<string> {
  const total = options.blob.size
  let offset = Math.min(Math.max(options.startAt ?? 0, 0), total)

  for (;;) {
    if (options.signal?.aborted) throw new Error('上傳已取消')

    const chunk = nextChunk(offset, total, options.chunkBytes ?? CHUNK_BYTES)
    if (!chunk) {
      /*
       * 走到這裡代表「位元組都送完了，但伺服器沒給 videoId」。
       * 幾乎只會發生在 startAt 被塞了一個超過檔案大小的值。
       */
      throw new Error('上傳結束但 YouTube 沒有回傳影片 ID')
    }

    const outcome = await sendChunk({
      location: options.location,
      body: options.blob.slice(chunk.start, chunk.end + 1),
      contentType: options.blob.type || 'application/octet-stream',
      start: chunk.start,
      end: chunk.end,
      total,
      signal: options.signal,
      onProgress: (sent) =>
        options.onProgress(Math.round(((chunk.start + sent) / total) * 100), chunk.start + sent),
    })

    if (outcome.done) {
      options.onProgress(100, total)
      return outcome.videoId
    }

    /*
     * ⚠️ 位移沒有往前就停下來，不要再送同一塊。
     *
     * 伺服器持續回一個不動的 Range 時（送的範圍不被接受），照著迴圈跑下去
     * 就是一個無聲的無限迴圈 —— 進度條停在同一格，而請求一直發。
     */
    if (outcome.offset <= offset) {
      throw new Error('YouTube 沒有接受這一段位元組，請重試')
    }
    offset = outcome.offset
  }
}

function sendChunk(options: {
  location: string
  body: Blob
  contentType: string
  start: number
  end: number
  total: number
  signal?: AbortSignal
  onProgress: (sentBytes: number) => void
}): Promise<ChunkOutcome> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', options.location)
    xhr.setRequestHeader('content-type', options.contentType)
    xhr.setRequestHeader('content-range', `bytes ${options.start}-${options.end}/${options.total}`)

    const abort = () => xhr.abort()
    options.signal?.addEventListener('abort', abort, { once: true })
    const cleanup = () => options.signal?.removeEventListener('abort', abort)

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) options.onProgress(event.loaded)
    }

    xhr.onload = () => {
      cleanup()

      // 308 = 收到了，還沒完。fetch 看不到 308（它會當重導向），XHR 看得到。
      if (xhr.status === 308) {
        resolve({
          done: false,
          offset: parseCommittedOffset(xhr.getResponseHeader('range'), options.end),
        })
        return
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const videoId = JSON.parse(xhr.responseText)?.id
          if (typeof videoId === 'string' && videoId) resolve({ done: true, videoId })
          else reject(new Error('YouTube 沒有回傳影片 ID'))
        } catch {
          reject(new Error('無法解析 YouTube 的回應'))
        }
        return
      }

      const { reason, message } = describeUploadFailure(xhr.responseText)
      if (reason === 'uploadLimitExceeded') {
        reject(new UploadLimitError())
        return
      }
      reject(new Error(`上傳失敗（${xhr.status}）：${message}`))
    }

    xhr.onerror = () => {
      cleanup()
      reject(new Error('網路中斷，這一段還沒傳完'))
    }
    xhr.onabort = () => {
      cleanup()
      reject(new Error('上傳已取消'))
    }

    xhr.send(options.body)
  })
}
