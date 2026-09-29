// @vitest-environment nuxt
import { afterEach, describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import AdminEditLink from '../../app/components/common/AdminEditLink.vue'
import { useUserStore } from '../../app/stores/user'

/**
 * 前台的「後台編輯」入口。
 *
 * 這裡守的是「沒登入就不該看到」。至於「SSR 輸出裡不能有它」（CDN 快取的
 * 那一條），元件測試看不到伺服器端的輸出，由 `tests/e2e/bff.test.ts` 守著。
 */

function login() {
  useUserStore().setUser({ id: 'u1', email: 'admin@example.com', name: '管理者', roles: ['admin'] })
}

afterEach(() => useUserStore().reset())

describe('CommonAdminEditLink', () => {
  it('沒登入時什麼都不渲染', async () => {
    const component = await mountSuspended(AdminEditLink, { props: { to: '/admin/games/g3' } })
    expect(component.find('a').exists()).toBe(false)
  })

  it('登入後才出現，連到指定的後台網址', async () => {
    login()
    const component = await mountSuspended(AdminEditLink, {
      props: { to: '/admin/games/g3', label: '後台編輯這場' },
    })

    const link = component.find('a')
    expect(link.exists()).toBe(true)
    expect(link.attributes('href')).toBe('/admin/games/g3')
    expect(link.text()).toContain('後台編輯這場')
  })

  it('沒給 label 時用預設字樣', async () => {
    login()
    const component = await mountSuspended(AdminEditLink, { props: { to: '/admin/games/g3' } })
    expect(component.text()).toContain('後台編輯')
  })
})
