import { describe, expect, it } from 'vitest'
import {
  MAX_PUSH_FAILURES,
  classifyPushFailure,
  isKnownPushService,
  pushPayloadSchema,
  pushSubscriptionSchema,
} from '../../shared/schemas/push'
import { isSameApplicationServerKey, urlBase64ToUint8Array } from '../../app/utils/push-key'

/**
 * 推播訂閱是這個專案唯一一支「匿名也能寫入」的端點，它的驗證就是全部的防線。
 * 這裡測的每一條都對應一個具體的攻擊或故障。
 */

describe('isKnownPushService', () => {
  it('接受各家瀏覽器真實的推送服務網域', () => {
    expect(isKnownPushService('https://fcm.googleapis.com/fcm/send/abc123')).toBe(true)
    expect(isKnownPushService('https://updates.push.services.mozilla.com/wpush/v2/abc')).toBe(true)
    expect(isKnownPushService('https://web.push.apple.com/QF1a2b3c')).toBe(true)
  })

  it('接受 WNS 的編號子網域（萬用字元）', () => {
    expect(isKnownPushService('https://wns2-par02p.notify.windows.com/w/?token=x')).toBe(true)
  })

  /**
   * 這幾條是重點：少了主機名稱比對，這支端點就變成
   * 「任何人都能叫我們的伺服器去打任意網址」，也就是 SSRF。
   */
  it('拒絕把已知網域藏在網址其他位置的偽造 endpoint', () => {
    // 放在 query 裡 —— 用字串 includes 判斷就會中招
    expect(isKnownPushService('https://evil.example.com/?x=fcm.googleapis.com')).toBe(false)
    // 放在路徑裡
    expect(isKnownPushService('https://evil.example.com/fcm.googleapis.com/send')).toBe(false)
    // 後綴偽裝
    expect(isKnownPushService('https://fcm.googleapis.com.evil.example.com/x')).toBe(false)
    // 前綴偽裝
    expect(isKnownPushService('https://notfcm.googleapis.com/x')).toBe(false)
    // 藏在使用者資訊欄位
    expect(isKnownPushService('https://fcm.googleapis.com@evil.example.com/x')).toBe(false)
  })

  it('拒絕非 https 與無法解析的網址', () => {
    expect(isKnownPushService('http://fcm.googleapis.com/fcm/send/abc')).toBe(false)
    expect(isKnownPushService('file:///etc/passwd')).toBe(false)
    expect(isKnownPushService('http://169.254.169.254/latest/meta-data/')).toBe(false)
    expect(isKnownPushService('not a url')).toBe(false)
    expect(isKnownPushService('')).toBe(false)
  })
})

describe('pushSubscriptionSchema', () => {
  const valid = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
    keys: { p256dh: 'BPxxx', auth: 'AAAA' },
  }

  it('接受瀏覽器產生的訂閱', () => {
    expect(pushSubscriptionSchema.safeParse(valid).success).toBe(true)
  })

  it('endpoint 不是已知推送服務就擋下來', () => {
    const result = pushSubscriptionSchema.safeParse({ ...valid, endpoint: 'https://evil.test/x' })
    expect(result.success).toBe(false)
  })

  it('缺少金鑰就擋下來（少了它根本無法加密酬載）', () => {
    expect(pushSubscriptionSchema.safeParse({ endpoint: valid.endpoint }).success).toBe(false)
    expect(
      pushSubscriptionSchema.safeParse({ ...valid, keys: { p256dh: '', auth: 'AAAA' } }).success,
    ).toBe(false)
  })

  it('超長欄位擋下來（避免有人把這裡當免費儲存空間）', () => {
    const result = pushSubscriptionSchema.safeParse({
      ...valid,
      keys: { p256dh: 'B'.repeat(500), auth: 'AAAA' },
    })
    expect(result.success).toBe(false)
  })
})

describe('pushPayloadSchema', () => {
  it('補上預設值', () => {
    const parsed = pushPayloadSchema.parse({ title: '本週六比賽改期' })
    expect(parsed).toEqual({ title: '本週六比賽改期', body: '', url: '/', tag: 'hgm-general' })
  })

  /**
   * 通知的 url 會被 service worker 拿去開啟。允許外部網址等於做了一個
   * 開放重導向：通知看起來來自球隊，點下去卻是別人的網站。
   */
  it('只接受站內路徑', () => {
    expect(pushPayloadSchema.safeParse({ title: 'x', url: '/news' }).success).toBe(true)
    expect(pushPayloadSchema.safeParse({ title: 'x', url: 'https://evil.test' }).success).toBe(
      false,
    )
  })

  /**
   * 協定相對網址是這裡最容易漏掉的一種：它以 `/` 開頭，卻會被
   * `new URL(value, origin)` 解析成外部網站 —— 也就是開放重導向。
   */
  it('擋下協定相對網址（開頭是 / 但其實指向外站）', () => {
    expect(pushPayloadSchema.safeParse({ title: 'x', url: '//evil.test' }).success).toBe(false)
    expect(pushPayloadSchema.safeParse({ title: 'x', url: '/\\evil.test' }).success).toBe(false)
    expect(new URL('//evil.test', 'https://hgm.example').origin).toBe('https://evil.test')
  })

  it('標題不能空白', () => {
    expect(pushPayloadSchema.safeParse({ title: '   ' }).success).toBe(false)
  })
})

describe('urlBase64ToUint8Array', () => {
  it('還原標準的 VAPID 公鑰長度（65 bytes 的未壓縮 P-256 點）', () => {
    const key =
      'BPJQMSOITYtLPyXd98s5BLOwd1tbpcYwz4Ciq-SXWn130PNDMF8Emt_zwNVjTyQZjOtsdonXazIuS4Qp_dL4rxc'
    const bytes = urlBase64ToUint8Array(key)

    expect(bytes.byteLength).toBe(65)
    // 未壓縮橢圓曲線點的第一個 byte 固定是 0x04
    expect(bytes[0]).toBe(0x04)
  })

  it('處理 base64url 的 - 與 _（標準 base64 的 + 與 /）', () => {
    // 0xfb 0xff -> '+/8' in base64, '-_8' in base64url
    expect([...urlBase64ToUint8Array('-_8')]).toEqual([0xfb, 0xff])
  })

  it('補回被省略的 padding', () => {
    // 'AAA' 少了一個 '='；沒補的話 atob 會直接拋錯
    expect([...urlBase64ToUint8Array('AAA')]).toEqual([0, 0])
    expect([...urlBase64ToUint8Array('AA')]).toEqual([0])
  })
})

/**
 * 這是唯一會刪掉使用者資料的判斷。判斷錯了的症狀是「大家的通知莫名其妙
 * 全部失效」，而且沒有任何錯誤訊息 —— 所以每一條分支都要有測試守著。
 */
describe('classifyPushFailure', () => {
  it('推送服務說訂閱不存在（404 / 410）就當場刪除', () => {
    expect(classifyPushFailure(404, 0)).toBe('remove')
    expect(classifyPushFailure(410, 0)).toBe('remove')
  })

  it('暫時性錯誤先留著，不因為一次抖動就讓人收不到通知', () => {
    expect(classifyPushFailure(500, 1)).toBe('retry')
    expect(classifyPushFailure(429, 2)).toBe('retry')
    // 逾時沒有狀態碼
    expect(classifyPushFailure(undefined, 0)).toBe('retry')
  })

  it('連續失敗累積到上限才淘汰', () => {
    expect(classifyPushFailure(500, MAX_PUSH_FAILURES - 1)).toBe('retry')
    expect(classifyPushFailure(500, MAX_PUSH_FAILURES)).toBe('remove')
  })
})

/**
 * 換 VAPID 金鑰之後最容易出的事：瀏覽器裡還留著用舊公鑰建立的訂閱，
 * 這時直接 `subscribe()` 會拋 `InvalidStateError`。症狀是「按了開啟通知
 * 沒反應」，而且只發生在曾經訂閱過的裝置上 —— 乾淨的瀏覽器測不出來。
 */
describe('isSameApplicationServerKey', () => {
  const keyA =
    'BPJQMSOITYtLPyXd98s5BLOwd1tbpcYwz4Ciq-SXWn130PNDMF8Emt_zwNVjTyQZjOtsdonXazIuS4Qp_dL4rxc'
  const keyB =
    'BKVNEayHqyJTwD15O6_1-FgoXPH8SlrS0s_JprelV8PxB8XyqOqNEM__09-Pmpy6oZXzNUw24kYXAl-nwSHOkSU'

  it('同一把金鑰視為相同', () => {
    const buffer = urlBase64ToUint8Array(keyA).buffer
    expect(isSameApplicationServerKey(buffer, keyA)).toBe(true)
  })

  it('換過金鑰就視為不同（正式環境與本機各一組時會遇到）', () => {
    const buffer = urlBase64ToUint8Array(keyA).buffer
    expect(isSameApplicationServerKey(buffer, keyB)).toBe(false)
  })

  it('沒有既有訂閱、或金鑰壞掉時一律回 false（寧可重訂一次）', () => {
    expect(isSameApplicationServerKey(null, keyA)).toBe(false)
    expect(isSameApplicationServerKey(undefined, keyA)).toBe(false)
    expect(isSameApplicationServerKey(urlBase64ToUint8Array(keyA).buffer, '')).toBe(false)
    expect(isSameApplicationServerKey(urlBase64ToUint8Array(keyA).buffer, '!!!not base64!!!')).toBe(
      false,
    )
  })

  it('長度不同直接視為不同，不會讀到越界', () => {
    expect(isSameApplicationServerKey(new Uint8Array([4, 1, 2]).buffer, keyA)).toBe(false)
  })
})
