import type { H3Event } from 'h3'
import { getFirebaseCredentials } from './firebase'
import { AppError, ERROR_CODE } from './errors'

/**
 * 鎖盤設定的寫入（限期活動「預測世界大賽冠軍」，見 `docs/ws-bracket.md`）。
 *
 * 下注資料是瀏覽器直接讀寫 Realtime Database 的，**只有鎖盤這一格例外** ——
 * 它決定所有人還能不能下注，所以不能讓前台改得動。安全規則對
 * `ws-bracket/config` 完全不開放寫入，而 service account 不受規則限制，
 * 所以唯一的寫入途徑就是這裡（而這裡擋在 `requireUser()` 後面）。
 *
 * ## 為什麼用一個具名的 admin app
 * 主站那一個（`server/utils/firebase.ts`）初始化時沒有帶 `databaseURL`，
 * 而且它是整個網站的核心。為了一個限期活動去改它的初始化參數，等於把
 * 「拆掉活動」變成「動到核心」。具名 app 各自獨立，刪掉這個檔案就乾淨了。
 */

/** 和前端用同一個名字的概念，但這是 server 端的另一個 app 實例。 */
const APP_NAME = 'ws-bracket-admin'

function databaseUrl(event: H3Event): string {
  const config = useRuntimeConfig(event).public.wsBracket as { databaseUrl?: string }
  return config?.databaseUrl ?? ''
}

/**
 * 寫入鎖盤時間。`null` 代表解除鎖盤（把那個鍵整個移除）。
 *
 * 移除而不是寫 `0`：規則判斷的是「`lockAt` 存不存在」加上「現在有沒有超過它」，
 * 留一個 `0` 在那裡等於「1970 年就鎖了」—— 意思剛好相反。
 */
export async function setWsBracketLock(event: H3Event, lockAt: number | null): Promise<void> {
  const url = databaseUrl(event)
  const credentials = getFirebaseCredentials()

  if (!url || !credentials) {
    throw new AppError(ERROR_CODE.SERVICE_UNAVAILABLE, '尚未設定下注資料庫，無法鎖盤', {
      expose: true,
    })
  }

  const [{ getApps, initializeApp, cert }, { getDatabase }] = await Promise.all([
    import('firebase-admin/app'),
    import('firebase-admin/database'),
  ])

  const existing = getApps().find((a) => a.name === APP_NAME)
  const app =
    existing ??
    initializeApp(
      {
        // ADC 模式不傳 credential —— 執行環境的服務帳戶本身就有權限
        ...(credentials.mode === 'service-account'
          ? {
              credential: cert({
                projectId: credentials.projectId,
                clientEmail: credentials.clientEmail,
                privateKey: credentials.privateKey,
              }),
            }
          : {}),
        projectId: credentials.projectId,
        databaseURL: url,
      },
      APP_NAME,
    )

  await getDatabase(app).ref('ws-bracket/config/lockAt').set(lockAt)
}
