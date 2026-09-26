// @vitest-environment nuxt
import { defineComponent, nextTick } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import ToastHost from '../../app/components/ui/ToastHost.vue'
import { useToast } from '../../app/composables/useToast'

/**
 * 浮動提示。
 *
 * 這裡釘住的都是「壞掉的時候在畫面上看不出來」的那幾件事：提示疊成一串、
 * 附按鈕的提示自己消失、以及那個橫跨畫面下緣的容器把底下的按鈕吃掉。
 */

/**
 * 掛上容器，同時取得操作提示的 API。
 *
 * 兩者在同一個 nuxt app 裡，所以共用 `useState('toasts')` —— 這也是
 * 為什麼每次都要先清掉上一個測試留下的提示。
 */
async function mountHost() {
  let api: ReturnType<typeof useToast> | null = null

  const wrapper = await mountSuspended(
    defineComponent({
      components: { ToastHost },
      setup() {
        api = useToast()
      },
      template: '<ToastHost />',
    }),
  )

  api!.toasts.value = []
  await nextTick()
  return { wrapper, toast: api! }
}

/** 畫面上目前有幾則提示（每一則都有一顆關閉鈕）。 */
const countRendered = (wrapper: Awaited<ReturnType<typeof mountHost>>['wrapper']) =>
  wrapper.findAll('button[aria-label="關閉提示"]').length

describe('useToast', () => {
  it('同一個 key 的提示會就地取代，不會疊成一串', async () => {
    const { wrapper, toast } = await mountHost()

    // 自動儲存會連續發生，沒有 key 的話操作十次就有十則一樣的訊息
    toast.show({ key: 'autosave', tone: 'success', message: '已自動儲存' })
    toast.show({ key: 'autosave', tone: 'error', message: '儲存失敗' })
    await nextTick()

    expect(toast.toasts.value.map((item) => item.message)).toEqual(['儲存失敗'])
    expect(countRendered(wrapper)).toBe(1)
  })

  it('沒有 key 的提示會疊起來，但有數量上限', async () => {
    const { wrapper, toast } = await mountHost()

    for (const message of ['一', '二', '三', '四']) toast.show({ message })
    await nextTick()

    // 超過上限丟掉最舊的：一連串失敗不該把整個畫面蓋掉
    expect(toast.toasts.value.map((item) => item.message)).toEqual(['二', '三', '四'])
    expect(countRendered(wrapper)).toBe(3)
  })

  it('成功的提示會自己消失', async () => {
    const { toast } = await mountHost()

    toast.show({ tone: 'success', message: '已自動儲存', duration: 20 })
    expect(toast.toasts.value).toHaveLength(1)

    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(toast.toasts.value).toHaveLength(0)
  })

  it('附按鈕的提示不會自己消失（即使是平常會自動關閉的色調）', async () => {
    const { toast } = await mountHost()

    // 手還沒伸到按鈕它就不見了，使用者只會看到「剛剛那個東西不見了」，
    // 而且不知道要去哪裡找。成功的提示平常 2.5 秒就關掉，附按鈕時例外。
    toast.show({ tone: 'success', message: '已刪除', action: { label: '復原', handler: vi.fn() } })

    expect(toast.toasts.value[0]?.duration).toBe(0)
  })

  it('失敗的提示預設不會自己消失', async () => {
    const { toast } = await mountHost()

    toast.show({ tone: 'error', message: '上傳失敗' })
    expect(toast.toasts.value[0]?.duration).toBe(0)
  })
})

describe('UiToastHost', () => {
  it('沒有提示時 live region 就已經存在（否則第一則不會被朗讀）', async () => {
    const { wrapper, toast } = await mountHost()

    expect(toast.toasts.value).toEqual([])
    expect(wrapper.find('[aria-live="polite"]').exists()).toBe(true)
  })

  it('容器不會吃掉底下的點擊', async () => {
    const { wrapper, toast } = await mountHost()

    // 它是橫跨整個畫面下緣的 fixed 容器，而且平常是空的 ——
    // 少了 pointer-events-none，底下的按鈕會全部點不到而且完全看不出原因
    expect(wrapper.get('[aria-live="polite"]').classes()).toContain('pointer-events-none')

    toast.show({ message: '測試' })
    await nextTick()
    expect(wrapper.get('button[aria-label="關閉提示"]').element.closest('div')).not.toBeNull()
    expect(wrapper.findAll('.pointer-events-auto')).toHaveLength(1)
  })

  it('關閉鈕會移除那一則提示', async () => {
    const { wrapper, toast } = await mountHost()

    toast.show({ message: '測試' })
    await nextTick()

    await wrapper.get('button[aria-label="關閉提示"]').trigger('click')
    expect(toast.toasts.value).toEqual([])
  })

  it('動作按鈕在等待期間停用，避免重試被連按好幾次', async () => {
    const { wrapper, toast } = await mountHost()

    let release: (() => void) | null = null
    const handler = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    )

    toast.show({ tone: 'error', message: '儲存失敗', action: { label: '重試', handler } })
    await nextTick()

    const button = wrapper.findAll('button').find((item) => item.text().includes('重試'))!
    await button.trigger('click')

    expect(handler).toHaveBeenCalledTimes(1)
    expect(button.attributes('disabled')).toBeDefined()

    await button.trigger('click')
    expect(handler).toHaveBeenCalledTimes(1)

    release!()
  })
})
