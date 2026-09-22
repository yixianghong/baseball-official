import { describe, expect, it } from 'vitest'
import { isAllowed } from '../../server/api/media/remote.get'

/**
 * 圖片轉送端點的白名單。
 *
 * 這支端點沒有登入保護，白名單就是唯一的防線 ——「給我網址、我去抓回來」
 * 正是 SSRF 的標準形狀。破了的話，任何人都能拿我們的伺服器去打內網或
 * 雲端的中繼資料端點，而且從外面完全看不出來。
 */
describe('isAllowed', () => {
  const bucket = 'hg-baseball.firebasestorage.app'

  it('接受本專案自己 bucket 底下的圖片', () => {
    expect(isAllowed(`https://storage.googleapis.com/${bucket}/site/logo.png`, bucket)).toBe(true)
    expect(isAllowed(`https://firebasestorage.googleapis.com/v0/b/${bucket}/o/x`, bucket)).toBe(
      true,
    )
  })

  it('拒絕別人的 bucket', () => {
    expect(isAllowed('https://storage.googleapis.com/someone-else/secret.png', bucket)).toBe(false)
    // 前綴相同但不是同一個 bucket
    expect(isAllowed(`https://storage.googleapis.com/${bucket}-evil/x.png`, bucket)).toBe(false)
  })

  it('拒絕不是 Storage 的網域', () => {
    expect(isAllowed(`https://evil.example.com/${bucket}/x.png`, bucket)).toBe(false)
    // 後綴偽裝：endsWith 比對就會中招
    expect(
      isAllowed(`https://storage.googleapis.com.evil.example.com/${bucket}/x.png`, bucket),
    ).toBe(false)
    // 藏在使用者資訊欄位
    expect(isAllowed(`https://storage.googleapis.com@evil.example.com/${bucket}/x`, bucket)).toBe(
      false,
    )
  })

  it('拒絕非 https 與內網位址', () => {
    expect(isAllowed(`http://storage.googleapis.com/${bucket}/x.png`, bucket)).toBe(false)
    expect(isAllowed('http://169.254.169.254/latest/meta-data/', bucket)).toBe(false)
    expect(isAllowed('http://localhost:3000/api/admin/players', bucket)).toBe(false)
    expect(isAllowed('file:///etc/passwd', bucket)).toBe(false)
  })

  it('沒設定 bucket 時一律拒絕（寧可功能關掉，也不要開一個沒有邊界的轉送）', () => {
    expect(isAllowed('https://storage.googleapis.com/anything/x.png', '')).toBe(false)
  })

  it('不是網址就拒絕', () => {
    expect(isAllowed('not a url', bucket)).toBe(false)
    expect(isAllowed('', bucket)).toBe(false)
  })
})
