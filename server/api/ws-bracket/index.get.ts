import { defineApiHandler } from '../../utils/handler'
import { getBracket } from '../../utils/mlb'

/**
 * 季後賽樹狀圖（限期活動，見 `docs/ws-bracket.md`）。
 *
 * **下注資料不在這裡** —— 那份由瀏覽器直接讀寫 Realtime Database，
 * 完全不經過 BFF 也不進 Firestore。這支端點只做一件事：把 MLB 的公開資料
 * 轉成畫面要的形狀。兩邊分開的好處是活動結束時刪掉這個資料夾就乾淨了。
 *
 * 刻意**不擋登入**：這是公開頁面的一部分。也刻意**不加 CDN 快取** ——
 * 樹狀圖在比賽進行中會變，而前台是靠輪詢這支端點更新的，
 * 套上共用快取只會讓所有人一起看到同一份過期資料。
 * 真正的節流在 `getBracket()` 的伺服器端快取（5 分鐘），它擋的是打向 MLB 的請求。
 */
export default defineApiHandler(async (event) => {
  /*
   * 球季用「現在的年份」推。
   *
   * 世界大賽最晚打到十一月初，所以一月到十一月之間問「今年」都是對的；
   * 十二月之後這個活動早就結束了，那時回傳一張空樹是正確的行為
   * （明年的季後賽賽程表還不存在）。
   */
  const season = new Date().getUTCFullYear()
  return await getBracket(event, season)
})
