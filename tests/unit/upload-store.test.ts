import { describe, expect, it } from 'vitest'
import {
  createMemoryUploadStore,
  isReadable,
  type PendingUpload,
} from '../../app/utils/upload-store'

/**
 * 還沒傳完的上傳（斷點）。
 *
 * 測的是記憶體版 —— IndexedDB 版是同一套介面，而這個環境沒有 IndexedDB。
 * 真正值得守的是**契約**：`progress()` 不能把已經刪掉的那一筆寫回來，
 * 以及「檔案讀不讀得到」要在續傳之前就問出來。兩條都是靜悄悄出錯的那一種。
 */

function record(overrides: Partial<PendingUpload> = {}): PendingUpload {
  return {
    id: 'u1',
    gameId: 'g1',
    inning: 1,
    half: 'top',
    title: '第1局上',
    fileName: 'VID_1.mp4',
    file: new File([new Uint8Array(8)], 'VID_1.mp4', { type: 'video/mp4' }),
    location: '',
    offset: 0,
    createdAt: 1,
    ...overrides,
  }
}

describe('upload store', () => {
  it('依比賽篩選、依建立時間排序', async () => {
    const store = createMemoryUploadStore()
    await store.save(record({ id: 'b', createdAt: 2 }))
    await store.save(record({ id: 'a', createdAt: 1 }))
    await store.save(record({ id: 'other', gameId: 'g2', createdAt: 0 }))

    expect((await store.list('g1')).map((item) => item.id)).toEqual(['a', 'b'])
  })

  it('記住上傳網址與位移', async () => {
    const store = createMemoryUploadStore()
    await store.save(record())
    await store.progress('u1', 'https://upload.example/1', 8388608)

    const [saved] = await store.list('g1')
    expect(saved).toMatchObject({ location: 'https://upload.example/1', offset: 8388608 })
  })

  it('⚠️ 已經刪掉的那一筆不會被 progress 寫回來', async () => {
    /*
     * 上傳成功會先 remove()，但正在跑的 onProgress 可能晚一步才寫。
     * 沒有這條規則的話，一個剛傳完的檔案會重新出現在「上次沒傳完」清單裡，
     * 而使用者按下去就是把同一支影片再傳一次。
     */
    const store = createMemoryUploadStore()
    await store.save(record())
    await store.remove('u1')
    await store.progress('u1', 'https://upload.example/1', 999)

    expect(await store.list('g1')).toEqual([])
  })

  it('save 存的是複本，之後改動原物件不會影響存起來的那一筆', async () => {
    const store = createMemoryUploadStore()
    const original = record()
    await store.save(original)
    original.offset = 12345

    expect((await store.list('g1'))[0]!.offset).toBe(0)
  })
})

describe('isReadable', () => {
  it('正常的檔案讀得到', async () => {
    expect(await isReadable(new File(['x'], 'a.mp4'))).toBe(true)
  })

  it('讀內容會拋錯的檔案回 false，而不是把錯誤往上丟', async () => {
    // 檔案被移走或刪掉之後就是這個樣子：物件還在、大小還讀得到，
    // 要真的去讀才會拋 NotReadableError
    const broken = {
      slice: () => ({
        arrayBuffer: () => Promise.reject(new DOMException('gone', 'NotReadableError')),
      }),
    } as unknown as File

    await expect(isReadable(broken)).resolves.toBe(false)
  })
})
