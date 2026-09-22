import { ofetch, type FetchOptions } from 'ofetch'
import type { H3Event } from 'h3'
import { AppError, ERROR_CODE } from './errors'
import { getCircuitBreaker } from './circuit-breaker'
import { logger as rootLogger } from './logger'

/**
 * 外部服務客戶端 —— BFF 對外的唯一出口。
 *
 * ## 這個專案的外部服務有哪些
 * 資料存取走 Firebase Admin SDK（見 `firebase.ts`），不經過這裡。
 * 這裡負責的是兩個 REST 上游：
 *
 * | 服務 | 用途 | 定義在 |
 * |---|---|---|
 * | Firebase Identity Toolkit | 後台登入時驗證帳密 | `firebase-auth.ts` |
 * | Gemini API | 賽程圖與計分板的圖片辨識 | `gemini.ts` |
 *
 * 兩者都在 Node 層呼叫，API key 永遠不進前端 bundle。
 *
 * ## 內建的韌性機制
 * 1. **Timeout**：預設 10 秒，避免請求無限期卡住（Gemini 另外指定較長的值）。
 * 2. **指數退避重試**：只重試冪等方法且狀態碼可重試（408/429/5xx）或網路錯誤。
 *    POST 預設不重試 —— 對 Gemini 來說重送等於多付一次錢，對登入來說
 *    重送只會加速觸發帳號鎖定。
 * 3. **斷路器**：上游連續失敗後快速失敗。Gemini 偶爾會整段時間不穩，
 *    有斷路器才不會讓後台每個操作都卡 60 秒才失敗。
 */

/** 可重試的 HTTP 狀態碼。這些狀態代表「暫時性失敗」，再試一次可能就成功。 */
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504])

/** 冪等方法：重複執行結果相同，所以重試是安全的。 */
const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE'])

export interface ExternalOptions extends Omit<
  FetchOptions<'json'>,
  'baseURL' | 'retry' | 'timeout'
> {
  /** 逾時毫秒數，預設取自 runtimeConfig。 */
  timeoutMs?: number
  /** 最大重試次數（不含第一次）。冪等方法預設 2，其餘預設 0。 */
  retries?: number
}

interface ExternalClientConfig {
  /** 服務代號，用於 log 與斷路器分組。 */
  name: string
  /** 取得 base URL 的函式（延遲求值，才能讀到執行期的 runtimeConfig）。 */
  baseUrl: () => string
  /** 每次請求都要附加的靜態 header，例如 API key。 */
  staticHeaders?: () => Record<string, string>
  /** 預設逾時，未指定時取 runtimeConfig 的 `upstreamTimeoutMs`。 */
  defaultTimeoutMs?: () => number
}

/**
 * 建立一個綁定特定外部服務的呼叫函式。
 *
 * @returns `(event, path, options) => Promise<T>`
 */
export function createExternalClient(config: ExternalClientConfig) {
  return async function call<T = unknown>(
    event: H3Event,
    path: string,
    options: ExternalOptions = {},
  ): Promise<T> {
    const runtimeConfig = useRuntimeConfig(event)
    const log = event.context.logger ?? rootLogger
    const method = (options.method ?? 'GET').toString().toUpperCase()

    const timeoutMs =
      options.timeoutMs ?? config.defaultTimeoutMs?.() ?? runtimeConfig.upstreamTimeoutMs
    const maxRetries = options.retries ?? (IDEMPOTENT_METHODS.has(method) ? 2 : 0)

    const breaker = getCircuitBreaker(config.name, {
      failureThreshold: runtimeConfig.circuitBreakerThreshold,
      resetTimeoutMs: runtimeConfig.circuitBreakerResetMs,
    })

    // 電路已跳閘：立即失敗，完全不打上游。
    if (!breaker.canAttempt()) {
      log.warn({ external: config.name, path, method }, 'circuit breaker is open, failing fast')
      throw new AppError(ERROR_CODE.SERVICE_UNAVAILABLE, '外部服務暫時無法使用，請稍後再試', {
        expose: true,
      })
    }

    const headers: Record<string, string> = {
      ...config.staticHeaders?.(),
      ...(options.headers as Record<string, string> | undefined),
    }

    let lastError: unknown
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const startedAt = performance.now()
      try {
        const result = await ofetch<T>(path, {
          ...options,
          baseURL: config.baseUrl(),
          headers,
          timeout: timeoutMs,
          // 用自己的重試迴圈以支援指數退避，關掉 ofetch 內建的固定間隔重試
          retry: false,
        })

        breaker.recordSuccess()
        log.info(
          {
            external: config.name,
            method,
            path,
            durationMs: Math.round(performance.now() - startedAt),
            attempt: attempt + 1,
          },
          'external request succeeded',
        )
        return result
      } catch (err) {
        lastError = err
        const status = extractStatus(err)
        const canRetry =
          attempt < maxRetries &&
          IDEMPOTENT_METHODS.has(method) &&
          (status === undefined || RETRYABLE_STATUS.has(status))

        log.warn(
          {
            external: config.name,
            method,
            path,
            status,
            durationMs: Math.round(performance.now() - startedAt),
            attempt: attempt + 1,
            canRetry,
          },
          'external request failed',
        )

        if (!canRetry) break

        // 指數退避 + 抖動：避免失敗的請求在同一瞬間一起重試，
        // 把剛要恢復的上游再打掛（thundering herd）。
        await sleep(backoffDelay(attempt))
      }
    }

    // 只有「伺服器端／網路層」的失敗才算進斷路器。
    // 4xx 是我們自己請求寫錯，重試或跳閘都無濟於事。
    const finalStatus = extractStatus(lastError)
    if (finalStatus === undefined || finalStatus >= 500) {
      breaker.recordFailure()
    }

    throw mapExternalError(lastError, config.name)
  }
}

/** 從各種 fetch 錯誤形狀中取出 HTTP 狀態碼。網路層錯誤沒有狀態碼，回傳 undefined。 */
export function extractStatus(err: unknown): number | undefined {
  if (err && typeof err === 'object') {
    if ('status' in err && typeof err.status === 'number') return err.status
    if ('statusCode' in err && typeof err.statusCode === 'number') return err.statusCode
    if ('response' in err) {
      const res = (err as { response?: { status?: number } }).response
      if (res && typeof res.status === 'number') return res.status
    }
  }
  return undefined
}

/** 取出上游回傳的 body，供呼叫端判斷細部錯誤（例如 Identity Toolkit 的錯誤碼）。 */
export function extractResponseBody(err: unknown): unknown {
  if (err && typeof err === 'object' && 'data' in err) return (err as { data: unknown }).data
  if (err && typeof err === 'object' && 'response' in err) {
    return (err as { response?: { _data?: unknown } }).response?._data
  }
  return undefined
}

/**
 * 把上游的錯誤轉成我們的 `AppError`。
 *
 * 重點：**不要把上游的錯誤訊息原封不動丟給前端**。上游的錯誤可能包含
 * 內部服務名稱與實作細節。這裡只保留狀態碼語意，訊息用我們自己的。
 */
function mapExternalError(err: unknown, serviceName: string): AppError {
  const isTimeout =
    err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')

  if (isTimeout) {
    return new AppError(ERROR_CODE.UPSTREAM_TIMEOUT, undefined, { cause: err })
  }

  const status = extractStatus(err)

  switch (status) {
    case 400:
      return new AppError(ERROR_CODE.BAD_REQUEST, undefined, { cause: err })
    case 401:
      return new AppError(ERROR_CODE.UNAUTHORIZED, undefined, { cause: err })
    case 403:
      return new AppError(ERROR_CODE.FORBIDDEN, undefined, { cause: err })
    case 404:
      return new AppError(ERROR_CODE.NOT_FOUND, undefined, { cause: err })
    case 409:
      return new AppError(ERROR_CODE.CONFLICT, undefined, { cause: err })
    case 429:
      return new AppError(ERROR_CODE.RATE_LIMITED, '外部服務限流中，請稍後再試', { cause: err })
    default:
      return new AppError(ERROR_CODE.UPSTREAM_ERROR, undefined, {
        cause: err,
        details: { service: serviceName, status },
      })
  }
}

/** 指數退避 + 隨機抖動：200ms、400ms、800ms…（各自再乘上 0.5～1.5 的隨機係數）。 */
export function backoffDelay(attempt: number, baseMs = 200): number {
  const exponential = baseMs * 2 ** attempt
  const jitter = 0.5 + Math.random()
  return Math.round(exponential * jitter)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
