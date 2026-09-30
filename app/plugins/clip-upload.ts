import { createClipUploadQueue } from '~/composables/useClipUpload'

/**
 * 影片上傳佇列。**整個 app 只有一個，而且活在頁面之外。**
 *
 * ## 為什麼不是一般的 composable
 * 一個 4K 半局的檔案有好幾 GB，傳完要幾十分鐘 —— 在那段時間裡切去看一下
 * 別的後台頁是常態。佇列如果跟著頁面生滅，換頁的結果是「正在傳的那一個
 * 在背景繼續（XHR 不綁元件生命週期），還沒開始的那幾個卻因為 Blob 被清掉
 * 而失敗」，一半一半，而且畫面已經不在，兩邊都看不到。
 *
 * 放在 plugin 上之後，換頁完全不影響上傳，回到頁面看到的還是同一個佇列。
 *
 * ## ⚠️ 為什麼不是 `.client.ts`
 * 上傳本身當然只發生在瀏覽器，但**後台頁面會 SSR** —— 只註冊在 client 的話，
 * 伺服器端渲染 `/admin/record/[id]` 時 `$clipUploads` 是 `undefined`，
 * 讀它的 computed 當場就爆，整頁掛掉。所以 plugin 兩邊都跑，
 * 只有真的要碰 `window` 的那一行才擋在 `import.meta.client` 後面。
 *
 * 每個請求各自建立一份（`defineNuxtPlugin` 的 setup 每個 app 實例跑一次），
 * 所以伺服器上不會有跨請求共用狀態的問題。
 *
 * 關掉分頁還是會斷（plugin 撐不過重新載入），所以挑檔案的那一種會把斷點
 * 寫進 IndexedDB，回到頁面能接著傳。見 `~/utils/upload-store.ts`。
 */
export default defineNuxtPlugin(() => {
  const queue = createClipUploadQueue()

  /*
   * 重新整理／關閉分頁的提醒。
   *
   * 掛在這裡而不是頁面上 —— 上傳既然不綁頁面，提醒也不該綁：使用者很可能
   * 是在別的後台頁上按了重新整理。
   *
   * ⚠️ 這攔得住「不小心」，攔不住「真的要關」。真正的防線是斷點已經寫進
   * IndexedDB，回到「上傳影片檔」那一頁可以接著傳。
   */
  if (import.meta.client) {
    window.addEventListener('beforeunload', (event) => {
      if (queue.pending.value === 0) return
      event.preventDefault()
      event.returnValue = ''
    })
  }

  return { provide: { clipUploads: queue } }
})
