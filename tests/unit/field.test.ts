import { describe, expect, it } from 'vitest'
import {
  defaultBatted,
  FIELDER_SPOTS,
  fromSvg,
  nearestFielder,
  needsBattedType,
  needsFielder,
  NO_LANDING_RESULTS,
  roundPoint,
  suggestResults,
  toSvg,
  zoneOf,
} from '../../shared/schemas/field'
import { battedTypeOf, playSchema, PLAY_RESULTS } from '../../shared/schemas/play'

/**
 * 球場的幾何。後台的拖曳登錄與前台的落點圖都只從這裡拿座標，
 * 所以這一組錯了，登錄的位置和畫出來的位置就會對不上。
 */

describe('zoneOf', () => {
  it.each([
    [{ x: 0, y: 0.2 }, 'infield'],
    [{ x: 0.1, y: 0.3 }, 'infield'],
    [{ x: 0, y: 0.7 }, 'outfield'],
    [{ x: -0.4, y: 0.6 }, 'outfield'],
    [{ x: 0, y: 1.05 }, 'beyond'],
    [{ x: 0.5, y: 0.1 }, 'foul'],
    [{ x: 0, y: -0.05 }, 'foul'],
  ] as const)('%o → %s', (point, zone) => {
    expect(zoneOf(point)).toBe(zone)
  })

  it('牆外但在界外線外面的是界外，不是全壘打', () => {
    // 角度優先判斷。先判斷距離的話，一支大號界外球會被記成全壘打
    expect(zoneOf({ x: 1.0, y: 0.6 })).toBe('foul')
  })

  it('剛好壓在界外線上算界內（壓線是好球）', () => {
    expect(zoneOf({ x: 0.3, y: 0.3 })).not.toBe('foul')
  })
})

describe('nearestFielder', () => {
  it('每個守備員自己的站位，最近的就是他自己', () => {
    for (const [position, spot] of Object.entries(FIELDER_SPOTS)) {
      expect(nearestFielder(spot).position, position).toBe(position)
    }
  })

  it('游擊與三壘中間偏游擊那一側是游擊手', () => {
    expect(nearestFielder({ x: -0.17, y: 0.38 }).position).toBe('SS')
  })

  it('不會回傳指定打擊（DH 不守備）', () => {
    expect(Object.keys(FIELDER_SPOTS)).not.toContain('DH')
  })
})

describe('suggestResults（放開之後選單怎麼排）', () => {
  it('牆外只有全壘打', () => {
    expect(suggestResults({ x: 0, y: 1.1 })).toEqual(['homerun'])
  })

  it('界外區只有界外飛球出局能構成打席結果', () => {
    // 界外滾地、沒接到的界外飛球都只是一個好球，打席還沒結束
    const results = suggestResults({ x: 0.6, y: 0.2 })
    expect(results[0]).toBe('foulout')
    expect(results).not.toContain('single')
    expect(results).not.toContain('groundout')
  })

  it('內野：滾地球出局排第一', () => {
    expect(suggestResults(FIELDER_SPOTS.SS)[0]).toBe('groundout')
  })

  it('外野、打向守備員：飛球出局排第一', () => {
    expect(suggestResults(FIELDER_SPOTS.CF)[0]).toBe('flyout')
  })

  it('外野空檔：安打排第一', () => {
    // 左中外野的深遠空檔，離 LF 與 CF 都超過 NEAR_FIELDER
    const gap = { x: -0.25, y: 0.9 }
    expect(nearestFielder(gap).distance).toBeGreaterThan(0.15)
    expect(suggestResults(gap)[0]).toBe('single')
  })

  it('是排序而不是過濾：打向外野手但他沒接到時，安打還選得到', () => {
    // 過濾掉的話，規則猜錯時就只能取消重拖
    expect(suggestResults(FIELDER_SPOTS.CF)).toContain('single')
    expect(suggestResults(FIELDER_SPOTS.SS)).toContain('single')
  })

  it('建議的結果都不是「沒有落點」的那幾種', () => {
    const points = [FIELDER_SPOTS.SS, FIELDER_SPOTS.CF, { x: 0, y: 1.1 }, { x: 0.6, y: 0.2 }]
    for (const point of points) {
      for (const result of suggestResults(point)) {
        expect(NO_LANDING_RESULTS as readonly string[]).not.toContain(result)
      }
    }
  })
})

describe('defaultBatted', () => {
  it('內野滾地、外野平飛、牆外高飛', () => {
    expect(defaultBatted(FIELDER_SPOTS.SS)).toBe('ground')
    expect(defaultBatted(FIELDER_SPOTS.CF)).toBe('line')
    expect(defaultBatted({ x: 0, y: 1.1 })).toBe('fly')
  })
})

describe('needsFielder / needsBattedType', () => {
  it('出局、失誤、野選要記處理的人', () => {
    for (const result of [
      'groundout',
      'flyout',
      'doublePlay',
      'reachedOnError',
      'fieldersChoice',
    ] as const) {
      expect(needsFielder(result), result).toBe(true)
    }
  })

  it('安打與全壘打不記處理的人（穿越的球沒有人處理）', () => {
    for (const result of ['single', 'double', 'triple', 'homerun'] as const) {
      expect(needsFielder(result), result).toBe(false)
    }
  })

  it('沒有落點的結果不記處理的人', () => {
    // 三振由捕手完成出局，但那不是「處理擊出去的球」
    expect(needsFielder('strikeout')).toBe(false)
    expect(needsFielder('runnerOut')).toBe(false)
  })

  it('只有安打與失誤要問擊球類型，出局的類型從結果推得出來', () => {
    expect(needsBattedType('single')).toBe(true)
    expect(needsBattedType('reachedOnError')).toBe(true)
    expect(needsBattedType('flyout')).toBe(false)
    expect(needsBattedType('groundout')).toBe(false)
  })

  it('不問擊球類型的結果，battedTypeOf 一定推得出來（除了沒有落點的）', () => {
    // 這兩支函式要互相補位：一個不問、另一個又推不出來的話，
    // 那種打席在落點圖上就會變成「沒有類型」
    for (const [result, meta] of Object.entries(PLAY_RESULTS)) {
      if ((NO_LANDING_RESULTS as readonly string[]).includes(result)) continue
      if (needsBattedType(result as keyof typeof PLAY_RESULTS)) continue
      expect(
        battedTypeOf({ result: result as keyof typeof PLAY_RESULTS, batted: null }),
        `${result}（${meta.label}）`,
      ).not.toBeNull()
    }
  })
})

describe('roundPoint', () => {
  it('取到小數第三位', () => {
    expect(roundPoint({ x: 0.123456, y: 0.987654 })).toEqual({ x: 0.123, y: 0.988 })
  })

  it('超出 schema 範圍的點被夾住，而不是讓整筆打席被擋掉', () => {
    const point = roundPoint({ x: 3, y: -1 })
    expect(point).toEqual({ x: 1.5, y: -0.3 })
    expect(() =>
      playSchema.parse({ inning: 1, half: 'top', result: 'single', location: point }),
    ).not.toThrow()
  })
})

describe('toSvg / fromSvg', () => {
  it('y 反向（SVG 的 y 向下），而且互為反函數', () => {
    expect(toSvg({ x: 0.2, y: 0.5 })).toEqual({ x: 0.2, y: -0.5 })
    expect(fromSvg(toSvg({ x: -0.3, y: 0.8 }))).toEqual({ x: -0.3, y: 0.8 })
  })
})

describe('battedTypeOf', () => {
  it('出局從結果推導，安打讀存的值', () => {
    expect(battedTypeOf({ result: 'flyout', batted: null })).toBe('fly')
    expect(battedTypeOf({ result: 'groundout', batted: null })).toBe('ground')
    expect(battedTypeOf({ result: 'single', batted: 'line' })).toBe('line')
    expect(battedTypeOf({ result: 'single', batted: null })).toBeNull()
  })

  it('出局時存的值被忽略（結果說了算）', () => {
    expect(battedTypeOf({ result: 'flyout', batted: 'ground' })).toBe('fly')
  })
})

describe('playSchema 的落點欄位', () => {
  it('舊的打席沒有這四個欄位也照樣有效（全部預設 null）', () => {
    const parsed = playSchema.parse({ inning: 1, half: 'top', result: 'single' })
    expect(parsed).toMatchObject({ location: null, fielder: null, batted: null, bats: null })
  })
})
