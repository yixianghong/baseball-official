// @vitest-environment nuxt
import { defineComponent, h, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { useAutosave } from '../../app/composables/useAutosave'

/**
 * 自動儲存。
 *
 * 取代「按儲存」這個步驟之後，有三件事變得比原本更重要：
 * 不能每次按鍵都寫一次資料庫、離開前要把變更送完、失敗必須看得見。
 * 這裡把這幾點釘住。
 */

/** 在元件的 setup 裡建立 autosave，回傳它與一個可修改的資料來源。 */
async function setup(save: (value: { text: string }) => Promise<unknown>, delay = 10) {
  const source = ref({ text: 'initial' })
  let api: ReturnType<typeof useAutosave<{ text: string }>> | null = null

  const Harness = defineComponent({
    setup() {
      api = useAutosave(() => source.value, save, { delay })
      api.markAsSaved()
      return () => h('div')
    },
  })

  await mountSuspended(Harness)
  return { source, api: api! }
}

/** 等待 debounce 與後續的 promise 解析。 */
const settle = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms))

describe('useAutosave', () => {
  it('載入當下不會寫入資料庫', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    await setup(save)
    await settle()

    // 光是打開頁面就寫一次，是這個功能最容易犯的錯
    expect(save).not.toHaveBeenCalled()
  })

  it('有變更時會在停止操作後送出', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const { source, api } = await setup(save)

    source.value = { text: 'changed' }
    await settle(5)
    // 還在 debounce 期間，不該送出
    expect(save).not.toHaveBeenCalled()
    expect(api.status.value).toBe('pending')

    await settle()
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith({ text: 'changed' })
    expect(api.status.value).toBe('saved')
  })

  it('連續輸入只會送出一次（否則每打一個字就寫一次資料庫）', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const { source } = await setup(save)

    for (const text of ['a', 'ab', 'abc', 'abcd']) {
      source.value = { text }
      await settle(2)
    }
    await settle()

    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith({ text: 'abcd' })
  })

  it('改回原本的內容就不算變更，不會送出', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const { source } = await setup(save)

    source.value = { text: 'changed' }
    await settle(2)
    source.value = { text: 'initial' }
    await settle()

    expect(save).not.toHaveBeenCalled()
  })

  it('flush 會立刻送出還沒送出的變更（換頁、關閉元件時用）', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const { source, api } = await setup(save, 5000)

    source.value = { text: 'changed' }
    await api.flush()

    // debounce 還沒到，但 flush 不等它
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('儲存失敗時狀態變成 error，而且可以重試', async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error('網路斷線'))
      .mockResolvedValueOnce(undefined)

    const { source, api } = await setup(save)

    source.value = { text: 'changed' }
    await settle()

    // 「以為存好了，其實沒有」是自動儲存最危險的失敗模式
    expect(api.status.value).toBe('error')
    expect(api.error.value).not.toBeNull()
    expect(api.isDirty.value).toBe(true)

    await api.retry()
    expect(api.status.value).toBe('saved')
    expect(api.isDirty.value).toBe(false)
  })

  it('儲存期間又改了東西，那些變更不會被當成已儲存', async () => {
    let release: (() => void) | null = null
    const save = vi
      .fn()
      // 第一次停在送出中，第二次（重新排定的那次）正常完成
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            release = resolve
          }),
      )
      .mockResolvedValue(undefined)

    const { source, api } = await setup(save)

    source.value = { text: 'first' }
    await settle()
    expect(api.status.value).toBe('saving')

    // 送出還沒回來就又改了
    source.value = { text: 'second' }
    release!()
    await settle()

    expect(save).toHaveBeenLastCalledWith({ text: 'second' })
    expect(api.isDirty.value).toBe(false)
  })
})
