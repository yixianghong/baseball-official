import { describe, expect, it } from 'vitest'
import {
  clipFileName,
  defaultCameraId,
  extensionFor,
  formatDuration,
  MIME_CANDIDATES,
  nextHalf,
  pickMimeType,
  resumePosition,
  sortCameras,
} from '../../app/utils/recording'
import { createMemoryClipStore } from '../../app/utils/clip-store'
import { battingSide } from '../../shared/schemas/game'

/**
 * 分段錄影的純邏輯。
 *
 * 真正會錄影的那一半（`MediaRecorder` / `getUserMedia`）在這裡測不到，
 * 也不值得去模擬 —— 它要的是實機。這裡守的是那些**在球場上才會發現、
 * 但當下完全看不出來**的判斷錯誤：錄成 iPhone 播不動的格式、選到前鏡頭、
 * 七個檔案下載下來排不出順序。
 */

/** 模擬某一台裝置：只有清單裡的格式會回 true。 */
const deviceSupporting = (supported: string[]) => (type: string) => supported.includes(type)

describe('pickMimeType', () => {
  /**
   * 迴歸測試：Chrome 兩種都錄得出來時，一定要選 mp4。
   *
   * 順序反過來的話 Android 會錄成 webm，而 **webm 在 iPhone 上完全播不動** ——
   * 錄的人看不出任何異常，一半的家屬打開卻是黑的。
   */
  it('兩種都支援時選 mp4，不選 webm', () => {
    const chrome = deviceSupporting([
      'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
      'video/webm;codecs=vp9,opus',
      'video/webm',
    ])

    expect(pickMimeType(chrome)).toBe('video/mp4;codecs=avc1.42E01E,mp4a.40.2')
  })

  it('只支援 webm 時才退回 webm', () => {
    const firefox = deviceSupporting(['video/webm;codecs=vp9,opus', 'video/webm'])

    expect(pickMimeType(firefox)).toBe('video/webm;codecs=vp9,opus')
  })

  it('一個都不支援時回空字串，讓呼叫端把功能關掉', () => {
    // 硬著頭皮用預設值開下去，會錄出一個沒人放得出來的檔案
    expect(pickMimeType(() => false)).toBe('')
  })

  it('候選清單裡 mp4 全部排在 webm 前面', () => {
    const firstWebm = MIME_CANDIDATES.findIndex((type) => type.startsWith('video/webm'))
    const lastMp4 = MIME_CANDIDATES.map((type) => type.startsWith('video/mp4')).lastIndexOf(true)

    expect(lastMp4).toBeLessThan(firstWebm)
  })
})

describe('extensionFor', () => {
  it.each([
    ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'mp4'],
    ['video/mp4', 'mp4'],
    ['video/webm;codecs=vp9,opus', 'webm'],
    ['', 'bin'],
  ])('%s → .%s', (mimeType, expected) => {
    expect(extensionFor(mimeType)).toBe(expected)
  })
})

describe('sortCameras', () => {
  const device = (label: string, deviceId = label) =>
    ({ deviceId, label, kind: 'videoinput', groupId: '' }) as MediaDeviceInfo

  it('後鏡頭排在前鏡頭前面，超廣角又排在最前面', () => {
    const sorted = sortCameras([
      device('前置相機'),
      device('後置廣角相機'),
      device('後置超廣角相機'),
    ])

    expect(sorted.map((camera) => camera.label)).toEqual([
      '後置超廣角相機',
      '後置廣角相機',
      '前置相機',
    ])
  })

  it('認得英文的鏡頭名稱（系統語言不是中文時）', () => {
    const sorted = sortCameras([device('Front Camera'), device('Back Ultra Wide Camera')])

    expect(sorted[0]!.label).toBe('Back Ultra Wide Camera')
    expect(sorted[0]!.isBack).toBe(true)
    expect(sorted[0]!.isUltraWide).toBe(true)
  })

  it('認得 Android 的 facing back 寫法', () => {
    const [first] = sortCameras([device('camera2 0, facing back')])

    expect(first!.isBack).toBe(true)
  })

  it('「廣角」不會被誤判成「超廣角」', () => {
    const [wide] = sortCameras([device('後置廣角相機')])

    expect(wide!.isUltraWide).toBe(false)
  })

  it('只留 videoinput，麥克風與喇叭不算鏡頭', () => {
    const mic = { deviceId: 'm', label: '麥克風', kind: 'audioinput', groupId: '' }
    const sorted = sortCameras([mic as MediaDeviceInfo, device('後置相機')])

    expect(sorted).toHaveLength(1)
  })

  it('還沒拿到權限時 label 是空的，但仍要有名字可以點', () => {
    // 這是 getUserMedia 之前的狀態 —— 分不出哪顆是後鏡頭，但不能顯示成空白
    const sorted = sortCameras([device('', 'a'), device('', 'b')])

    expect(sorted.map((camera) => camera.label)).toEqual(['鏡頭 1', '鏡頭 2'])
    expect(sorted.every((camera) => !camera.isBack)).toBe(true)
  })

  it('權重相同時維持原本的順序', () => {
    const sorted = sortCameras([device('後置相機 A'), device('後置相機 B')])

    expect(sorted.map((camera) => camera.label)).toEqual(['後置相機 A', '後置相機 B'])
  })
})

describe('defaultCameraId', () => {
  const camera = (label: string, isBack: boolean, isUltraWide: boolean) => ({
    deviceId: label,
    label,
    isBack,
    isUltraWide,
  })

  it('優先選超廣角的後鏡頭', () => {
    expect(
      defaultCameraId([
        camera('前鏡頭', false, false),
        camera('後置廣角', true, false),
        camera('後置超廣角', true, true),
      ]),
    ).toBe('後置超廣角')
  })

  it('沒有超廣角就選任一後鏡頭', () => {
    expect(defaultCameraId([camera('前鏡頭', false, false), camera('後置廣角', true, false)])).toBe(
      '後置廣角',
    )
  })

  it('連後鏡頭都認不出來就選第一顆', () => {
    expect(defaultCameraId([camera('鏡頭 1', false, false), camera('鏡頭 2', false, false)])).toBe(
      '鏡頭 1',
    )
  })

  it('沒有任何鏡頭時回空字串', () => {
    expect(defaultCameraId([])).toBe('')
  })
})

describe('clipFileName', () => {
  const base = {
    teamName: '城市棒球隊',
    opponent: '藍鷹棒球隊',
    date: '2026-10-02',
    half: 'top' as const,
    mimeType: 'video/mp4',
  }

  it('帶隊名、對手、日期、局數與上下半', () => {
    expect(clipFileName({ ...base, inning: 3 })).toBe(
      '城市棒球隊-vs-藍鷹棒球隊-2026-10-02-第03局上.mp4',
    )
    expect(clipFileName({ ...base, inning: 3, half: 'bottom' })).toBe(
      '城市棒球隊-vs-藍鷹棒球隊-2026-10-02-第03局下.mp4',
    )
  })

  /**
   * 十四個檔案下載到同一個資料夾，靠檔名就要排得出比賽順序。
   *
   * 局數補零解決「第 10 局排在第 2 局前面」；上下半則是靠「上」(U+4E0A)
   * 的碼位小於「下」(U+4E0B) —— 這一條守著那個巧合，換成別的字會壞掉。
   */
  it('完整的一場排序後就是比賽順序', () => {
    const order: Array<[number, 'top' | 'bottom']> = [
      [1, 'top'],
      [1, 'bottom'],
      [2, 'top'],
      [2, 'bottom'],
      [9, 'bottom'],
      [10, 'top'],
    ]
    const names = order.map(([inning, half]) => clipFileName({ ...base, inning, half }))

    expect([...names].sort()).toEqual(names)
  })

  it('副檔名跟著 MIME 走', () => {
    expect(clipFileName({ ...base, inning: 1, mimeType: 'video/webm;codecs=vp9' })).toContain(
      '.webm',
    )
  })

  it('清掉檔案系統不接受的字元', () => {
    const name = clipFileName({ ...base, inning: 1, opponent: 'A/B:C*隊' })

    expect(name).toContain('ABC隊')
    expect(name).not.toContain('/')
  })

  it('隊名整串都是非法字元時不會產生空檔名', () => {
    expect(clipFileName({ ...base, inning: 1, opponent: '///' })).toContain('未命名')
  })
})

/**
 * 錄完自動推進。
 *
 * 球場邊那個人兩隻手都在忙，而一場要按十四次 —— 只要推進是對的，
 * 他整場都不必碰局數選擇器。
 */
describe('nextHalf', () => {
  it('上半局之後是同一局的下半局', () => {
    expect(nextHalf({ inning: 3, half: 'top' }, 7)).toEqual({ inning: 3, half: 'bottom' })
  })

  it('下半局之後是下一局的上半局', () => {
    expect(nextHalf({ inning: 3, half: 'bottom' }, 7)).toEqual({ inning: 4, half: 'top' })
  })

  it('最後一局的下半之後停在原地，不會跑到第 8 局', () => {
    // 延長賽要手動選，不要自動生出一局不存在的比賽
    expect(nextHalf({ inning: 7, half: 'bottom' }, 7)).toEqual({ inning: 7, half: 'bottom' })
  })

  it('最後一局的上半仍然推得到下半', () => {
    expect(nextHalf({ inning: 7, half: 'top' }, 7)).toEqual({ inning: 7, half: 'bottom' })
  })
})

/**
 * 誰在打擊。**客隊先攻**，所以上半局打擊的是客隊。
 *
 * 場邊的人看的是場上，不會記得自己是主場還是客場 —— 這個推導錯了，
 * 畫面上就會寫著「對方進攻」而場上是自己人在打。
 */
describe('battingSide', () => {
  it.each([
    ['top', 'home', 'opponent'],
    ['bottom', 'home', 'our'],
    ['top', 'away', 'our'],
    ['bottom', 'away', 'opponent'],
  ] as const)('%s 半局、我隊是 %s → %s 打擊', (half, homeAway, expected) => {
    expect(battingSide(half, homeAway)).toBe(expected)
  })
})

describe('formatDuration', () => {
  it.each([
    [0, '00:00'],
    [59, '00:59'],
    [754, '12:34'],
    [3600, '60:00'],
  ])('%i 秒 → %s', (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected)
  })

  it('負數不會顯示成奇怪的東西', () => {
    expect(formatDuration(-1)).toBe('00:00')
  })
})

/**
 * 頁面被系統中斷後，要接著錄哪一格。
 *
 * 重新載入之後局數會回到第 1 局上半，而場邊的人剛經歷一次莫名其妙的閃退 ——
 * 不該還要他自己回想剛剛錄到哪。
 */
describe('resumePosition', () => {
  const at = (startedAt: number, inning: number, half: 'top' | 'bottom', finished: boolean) => ({
    startedAt,
    inning,
    half,
    finished,
  })

  it('沒有暫存的片段就不動', () => {
    expect(resumePosition([], 7)).toBeNull()
  })

  it('錄到一半被中斷 → 停在同一個半局（剩下的還沒錄）', () => {
    expect(resumePosition([at(1, 3, 'bottom', false)], 7)).toEqual({ inning: 3, half: 'bottom' })
  })

  it('錄完但還沒上傳 → 下一個半局', () => {
    expect(resumePosition([at(1, 3, 'top', true)], 7)).toEqual({ inning: 3, half: 'bottom' })
  })

  it('看的是最後開始錄的那一段，不是陣列裡的最後一個', () => {
    const sessions = [at(200, 4, 'top', false), at(100, 2, 'bottom', true)]
    expect(resumePosition(sessions, 7)).toEqual({ inning: 4, half: 'top' })
  })
})

/**
 * 暫存片段的介面契約。
 *
 * 這裡測的是記憶體版；IndexedDB 版實作同一個介面，在真的瀏覽器裡驗證過
 * （happy-dom 沒有 IndexedDB）。契約裡最要緊的是順序：塊組錯順序的影片
 * 播不動，而錄的當下完全看不出來。
 */
describe('ClipStore', () => {
  const session = (id: string, gameId: string, startedAt: number) => ({
    id,
    gameId,
    inning: 1,
    half: 'top' as const,
    mimeType: 'video/mp4',
    startedAt,
    finished: false,
  })

  it('依 seq 組回，不管寫入的先後', async () => {
    const store = createMemoryClipStore()
    await store.begin(session('s1', 'g1', 1))
    await store.append('s1', 1, new Blob(['BB']))
    await store.append('s1', 0, new Blob(['AA']))
    await store.append('s1', 2, new Blob(['CC']))

    const blob = await store.assemble('s1')
    expect(await blob!.text()).toBe('AABBCC')
    expect(blob!.type).toBe('video/mp4')
  })

  it('一塊都沒有就回 null（錄影一開始就被中斷）', async () => {
    const store = createMemoryClipStore()
    await store.begin(session('s1', 'g1', 1))
    expect(await store.assemble('s1')).toBeNull()
  })

  it('只列出這一場的，依開始時間排', async () => {
    const store = createMemoryClipStore()
    await store.begin(session('late', 'g1', 200))
    await store.begin(session('other', 'g2', 150))
    await store.begin(session('early', 'g1', 100))

    expect((await store.list('g1')).map((item) => item.id)).toEqual(['early', 'late'])
  })

  it('finish 標記錄完，remove 連同資料一起刪', async () => {
    const store = createMemoryClipStore()
    await store.begin(session('s1', 'g1', 1))
    await store.append('s1', 0, new Blob(['AA']))
    await store.finish('s1')
    expect((await store.list('g1'))[0]?.finished).toBe(true)

    await store.remove('s1')
    expect(await store.list('g1')).toEqual([])
    expect(await store.assemble('s1')).toBeNull()
  })
})
