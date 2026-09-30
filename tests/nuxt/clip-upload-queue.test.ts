// @vitest-environment nuxt
import { describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'

/**
 * 上傳佇列活在 plugin 上，不在頁面上。
 *
 * 這一組守的就是那句話的兩半：**換頁不會弄丟佇列**（元件卸載之後再掛一個
 * 新的，看到的是同一批），以及**一場比賽只看得到自己的**（佇列是全站共用的，
 * 錄影頁不該看到別場的上傳）。
 *
 * 兩條都曾經是反過來的：佇列跟著頁面生滅時，換一頁就會變成「正在傳的那一個
 * 在背景繼續、還沒開始的那幾個安靜地失敗」，而畫面上兩邊都看不到。
 */

// 這個環境不連網。上傳一定會失敗，但那不影響這裡要測的事 ——
// 失敗的項目照樣留在佇列裡，而且帶著它屬於哪一場。
mockNuxtImport('useApi', () => () => ({
  post: () => Promise.reject(new Error('測試環境不連網')),
}))

type Uploads = ReturnType<typeof useClipUpload>

/** setup 裡拿到的那一份。`expose` 在這個環境下取不到，所以用模組層變數接。 */
let captured: Uploads

function viewFor(gameId: string) {
  return defineComponent({
    setup() {
      captured = useClipUpload({ gameId: () => gameId, title: () => '測試標題' })
      return () => h('div')
    },
  })
}

async function settle() {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

describe('上傳佇列（plugin 層）', () => {
  it('卸載頁面之後佇列還在 —— 換頁不會中斷上傳', async () => {
    const first = await mountSuspended(viewFor('g1'))
    captured.enqueue({ inning: 3, half: 'top', blob: new Blob(['x']), label: 'VID_1.mp4' })
    await settle()
    first.unmount()

    const second = await mountSuspended(viewFor('g1'))
    expect(captured.queue.value.map((item) => item.label)).toContain('VID_1.mp4')
    second.unmount()
  })

  it('只看得到自己那一場的上傳', async () => {
    const other = await mountSuspended(viewFor('g2'))
    expect(captured.queue.value).toEqual([])
    other.unmount()
  })

  it('label 沒給時用半局當名字（錄影頁就是這樣）', async () => {
    const view = await mountSuspended(viewFor('g3'))
    captured.enqueue({ inning: 5, half: 'bottom', blob: new Blob(['x']) })
    await settle()

    expect(captured.queue.value[0]!.label).toBe('第 5 局下')
    view.unmount()
  })
})
