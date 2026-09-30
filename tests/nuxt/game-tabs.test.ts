// @vitest-environment nuxt
import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import GameTabs from '../../app/components/admin/GameTabs.vue'

/**
 * 固定在畫面底部的分頁列。
 *
 * 兩件在畫面上看不出原因、但會壞掉的事：分頁列會蓋住最後一段內容（所以要有
 * 等高的佔位），以及 `UiToastHost` 的 z-index 比它高、會正好蓋住它
 * （所以要設 `--bottom-bar` 讓 toast 自己讓開）。
 */

const tabs = [
  { key: 'basic', label: '基本資料', icon: '📋' },
  { key: 'video', label: '錄影管理', icon: '🎬' },
] as const

describe('AdminGameTabs', () => {
  it('每一顆都有圖示與文字，選起來的那一顆標 aria-selected', async () => {
    const component = await mountSuspended(GameTabs, {
      props: { tabs, modelValue: 'video' },
    })

    const buttons = component.findAll('[role="tab"]')
    expect(buttons).toHaveLength(2)
    expect(buttons[0]!.text()).toContain('基本資料')
    expect(buttons[0]!.text()).toContain('📋')
    expect(buttons[0]!.attributes('aria-selected')).toBe('false')
    expect(buttons[1]!.attributes('aria-selected')).toBe('true')
  })

  it('點下去就換分頁', async () => {
    const component = await mountSuspended(GameTabs, {
      props: { tabs, modelValue: 'basic' },
    })

    await component.findAll('[role="tab"]')[1]!.trigger('click')

    expect(component.emitted('update:modelValue')?.[0]).toEqual(['video'])
  })

  it('⚠️ 留一個等高的佔位，最後一段內容才不會永遠躲在分頁列底下', async () => {
    const component = await mountSuspended(GameTabs, {
      props: { tabs, modelValue: 'basic' },
    })

    expect(component.html()).toContain('h-[calc(4rem+env(safe-area-inset-bottom))]')
  })

  it('⚠️ 掛載時設 --bottom-bar，卸載時清掉 —— toast 靠它讓開', async () => {
    const component = await mountSuspended(GameTabs, {
      props: { tabs, modelValue: 'basic' },
    })
    expect(document.documentElement.style.getPropertyValue('--bottom-bar')).toBe('4rem')

    component.unmount()
    expect(document.documentElement.style.getPropertyValue('--bottom-bar')).toBe('')
  })
})
