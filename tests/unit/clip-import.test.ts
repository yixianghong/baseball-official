import { describe, expect, it } from 'vitest'
import {
  duplicateSlots,
  halfInningSlots,
  isProxyVideo,
  isVideoFile,
  planAssignments,
  rejectionOf,
  sortByCapture,
  type ImportFile,
} from '../../app/utils/clip-import'

/**
 * 「從裝置挑影片檔上傳」的純判斷（`/admin/upload/[id]`）。
 *
 * 這一組守的是兩件真的會出錯、而且出錯時**畫面上看不出來**的事：
 * 相機的低畫質代理檔混進正片裡，以及十四個檔案對錯半局。
 */

function file(overrides: Partial<ImportFile> & { name: string }): ImportFile {
  return { size: 1024, type: 'video/mp4', lastModified: 0, ...overrides }
}

describe('isProxyVideo', () => {
  it.each([
    'LRV_20260930_143012_00_001.mp4',
    'lrv_0001.mp4',
    'PRO_LRV_0003.mp4',
    'VID_0001.lrv',
    'THM_0001.mp4',
  ])('%s 是代理檔', (name) => {
    expect(isProxyVideo(name)).toBe(true)
  })

  it.each(['VID_20260930_143012_00_001.mp4', 'PRO_VID_0003.mp4', 'GX010023.MP4'])(
    '%s 是正片',
    (name) => {
      expect(isProxyVideo(name)).toBe(false)
    },
  )

  it('不會把檔名裡剛好有 lrv 這三個字母的正片當成代理檔', () => {
    // 邊界要有反例，否則 /lrv/ 這種寫法也會通過上面每一條
    expect(isProxyVideo('solrvideo.mp4')).toBe(false)
  })
})

describe('isVideoFile', () => {
  it('以 MIME 為主', () => {
    expect(isVideoFile(file({ name: 'a.bin', type: 'video/mp4' }))).toBe(true)
    expect(isVideoFile(file({ name: 'a.mp4', type: 'image/jpeg' }))).toBe(false)
  })

  it('MIME 是空字串時退回看副檔名', () => {
    // iOS 的「檔案」App 挑出來的 .mov／.insv 常常沒有 type，
    // 直接擋掉的話使用者會以為檔案壞了
    expect(isVideoFile(file({ name: 'VID_0001.MOV', type: '' }))).toBe(true)
    expect(isVideoFile(file({ name: '成績表.pdf', type: '' }))).toBe(false)
  })
})

describe('rejectionOf', () => {
  it('正常的影片沒有理由被擋', () => {
    expect(rejectionOf(file({ name: 'VID_0001.mp4' }))).toBeNull()
  })

  it('代理檔、非影片、空檔案各有各的理由', () => {
    expect(rejectionOf(file({ name: 'LRV_0001.mp4' }))).toBe('proxy')
    expect(rejectionOf(file({ name: 'note.txt', type: 'text/plain' }))).toBe('not-video')
    expect(rejectionOf(file({ name: 'VID_0002.mp4', size: 0 }))).toBe('empty')
  })
})

describe('sortByCapture', () => {
  it('以拍攝時間為主', () => {
    const files = [
      file({ name: 'b.mp4', lastModified: 200 }),
      file({ name: 'a.mp4', lastModified: 100 }),
    ]
    expect(sortByCapture(files).map((f) => f.name)).toEqual(['a.mp4', 'b.mp4'])
  })

  it('時間一樣時用數字順序比檔名，VID_2 要排在 VID_10 前面', () => {
    const files = [
      file({ name: 'VID_10.mp4', lastModified: 1 }),
      file({ name: 'VID_2.mp4', lastModified: 1 }),
    ]
    expect(sortByCapture(files).map((f) => f.name)).toEqual(['VID_2.mp4', 'VID_10.mp4'])
  })

  it('不改動傳進來的陣列', () => {
    const files = [file({ name: 'b.mp4', lastModified: 2 }), file({ name: 'a.mp4' })]
    sortByCapture(files)
    expect(files[0]!.name).toBe('b.mp4')
  })
})

describe('halfInningSlots', () => {
  it('照比賽順序排，上半在下半前面', () => {
    expect(halfInningSlots(2)).toEqual([
      { inning: 1, half: 'top' },
      { inning: 1, half: 'bottom' },
      { inning: 2, half: 'top' },
      { inning: 2, half: 'bottom' },
    ])
  })
})

describe('planAssignments', () => {
  const slots = halfInningSlots(7)

  it('依拍攝順序填進還沒有影片的半局', () => {
    const files = [
      file({ name: 'c.mp4', lastModified: 300 }),
      file({ name: 'a.mp4', lastModified: 100 }),
      file({ name: 'b.mp4', lastModified: 200 }),
    ]
    const plan = planAssignments({ files, slots, taken: new Set() })
    expect(plan.map((item) => [item.file.name, item.slot])).toEqual([
      ['a.mp4', { inning: 1, half: 'top' }],
      ['b.mp4', { inning: 1, half: 'bottom' }],
      ['c.mp4', { inning: 2, half: 'top' }],
    ])
  })

  it('跳過已經有影片的半局', () => {
    const files = [file({ name: 'a.mp4', lastModified: 1 })]
    const plan = planAssignments({
      files,
      slots,
      taken: new Set(['1-top', '1-bottom']),
    })
    expect(plan[0]!.slot).toEqual({ inning: 2, half: 'top' })
  })

  it('缺口用完之後接到已經有影片的半局上，而不是不指派', () => {
    // 靜靜地丟掉檔案比「這一格會被覆蓋」糟糕得多
    const files = Array.from({ length: 2 }, (_, i) => file({ name: `f${i}.mp4`, lastModified: i }))
    const plan = planAssignments({
      files,
      slots: halfInningSlots(1),
      taken: new Set(['1-top']),
    })
    expect(plan.map((item) => item.slot)).toEqual([
      { inning: 1, half: 'bottom' },
      { inning: 1, half: 'top' },
    ])
  })

  it('整場都排滿之後多出來的檔案不指派', () => {
    const files = Array.from({ length: 3 }, (_, i) => file({ name: `f${i}.mp4`, lastModified: i }))
    const plan = planAssignments({ files, slots: halfInningSlots(1), taken: new Set() })
    expect(plan[2]!.slot).toBeNull()
  })
})

describe('duplicateSlots', () => {
  it('抓出指到同一個半局的兩筆', () => {
    const duplicates = duplicateSlots([
      { slot: { inning: 1, half: 'top' } },
      { slot: { inning: 1, half: 'bottom' } },
      { slot: { inning: 1, half: 'top' } },
      { slot: null },
    ])
    expect([...duplicates]).toEqual(['1-top'])
  })

  it('沒有重複時是空的', () => {
    expect(duplicateSlots([{ slot: { inning: 3, half: 'top' } }]).size).toBe(0)
  })
})
