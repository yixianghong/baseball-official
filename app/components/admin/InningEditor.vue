<script setup lang="ts">
import type {
  GameClip,
  HalfInningNarrative,
  LineupEntry,
  Scoreboard,
  StartingPitcher,
} from '#shared/schemas/game'
import type { HomeAway } from '#shared/schemas/half-inning'
import { POSITION_LABELS, type Player, type Position } from '#shared/schemas/player'
import type { BatSide, BattedType, FieldPoint, Play, PlayResult } from '#shared/schemas/play'
import {
  defaultBatted,
  nearestFielder,
  needsBattedType,
  needsFielder,
  NO_LANDING_RESULTS,
  zoneOf,
  ZONE_LABELS,
} from '#shared/schemas/field'
import { clipEmbedUrl, narrativeOf } from '#shared/schemas/game'
import { LOW_CONFIDENCE_THRESHOLD } from '#shared/schemas/ai'
import { ApiError } from '~/utils/api-error'
import {
  GAME_HALVES,
  halfInningLabel,
  halfInningOrder,
  battingSide,
} from '#shared/schemas/half-inning'
import { battingOrderAt, slotOfBatter } from '#shared/schemas/batting-order'
import {
  adjustRuns,
  BATTED_LABELS,
  clampRbi,
  defaultRbi,
  defaultRuns,
  describeBatter,
  describePerson,
  halfInningOuts,
  halfInningRuns,
  halfInningStatus,
  MAX_PLAYS_PER_HALF_INNING,
  PLAY_RESULTS,
  playsOf,
  sortPlays,
} from '#shared/schemas/play'

/**
 * 逐局逐打席的登錄介面。
 *
 * ## 為什麼是「以半局為單位」
 * 半局是這個專案裡**三份資料共用的身分**：計分板的一格、一段錄影、一批
 * 打席。既然影片已經是一個半局一段，登錄介面切成同樣的單位之後，賽後就
 * 可以**對著那半局的片段登錄** —— 影片在上面、打席在下面，暫停重看都在
 * 同一個畫面上。
 *
 * ## ⚠️ 打者自動帶下一棒是這個功能的成敗關鍵
 * 當初刻意不做結構化的打擊數據，第一個理由就是「欄位越多，實際發生的事
 * 不是資料更完整，而是整段沒人填」（見 `play.ts` 開頭）。輪轉打線讓
 * 多數打席只要**按一個結果鍵**就完成 —— 這不是可有可無的便利，
 * **拿掉它，那個理由就立刻回來**。
 *
 * ## 出局數不是輸入項
 * 出局數由結果推導（`PLAY_RESULTS[result].outs`），所以「這半局登完了沒」
 * 是算出來的，不是人宣告的。畫面上那個「3／3」是結果，不是一個欄位。
 */
const props = defineProps<{
  plays: Play[]
  homeAway: HomeAway
  lineup: LineupEntry[]
  startingPitcher: StartingPitcher | null
  players: Player[]
  clips: GameClip[]
  scoreboard: Scoreboard
  ourName: string
  opponentName: string
  /** 已經存下來的半局敘述。 */
  narratives: HalfInningNarrative[]
  /** 還沒同步到伺服器的半局數。 */
  pendingCount?: number
  /**
   * 這個分頁現在是不是被選中的。
   *
   * ⚠️ 分頁是 `v-show`，所以這個元件在別的分頁上也一直掛著 —— 少了這個 prop，
   * 「輪到對手時把游標移進背號框」只會在元件掛載那一刻試一次，而那時它多半是
   * `display: none`（**隱藏的元素 focus 不起來，而且完全不會報錯**）。
   */
  active?: boolean
}>()

const emit = defineEmits<{
  save: [inning: number, half: (typeof GAME_HALVES)[number], plays: Play[]]
  saveNarrative: [inning: number, half: (typeof GAME_HALVES)[number], text: string]
  retry: []
}>()

// ── 半局選擇器 ──────────────────────────────────────────────────

/**
 * 這場有幾局。
 *
 * 跟著計分板走（延長賽會更多），至少七局 —— 和錄影頁的局數按鈕同一條規則，
 * 兩邊的格子數量對不上會讓人以為漏了幾段。
 */
const totalInnings = computed(() => Math.max(props.scoreboard.innings.length, 7))

const halfInnings = computed(() =>
  Array.from({ length: totalInnings.value }, (_, i) => i + 1).flatMap((inning) =>
    GAME_HALVES.map((half) => {
      const plays = playsOf(props.plays, inning, half)
      return {
        key: `${inning}-${half}`,
        inning,
        half,
        side: battingSide(half, props.homeAway),
        plays,
        runs: halfInningRuns(plays),
        outs: halfInningOuts(plays),
        status: halfInningStatus(plays),
        hasClip: props.clips.some((clip) => clip.inning === inning && clip.half === half),
      }
    }),
  ),
)

type HalfInningCell = (typeof halfInnings.value)[number]

const selectedKey = ref('1-top')

/**
 * 預設停在「第一個還沒登錄完的半局」。
 *
 * 不是第 1 局上 —— 登錄是一次做一點的，每次回到這一頁都要重新捲到上次的
 * 位置，那是十幾次點擊。和錄影頁的 `resumePosition()` 同一個道理。
 */
onMounted(() => {
  const next = halfInnings.value.find((cell) => cell.status !== 'complete')
  if (next) selectedKey.value = next.key
})

const selected = computed<HalfInningCell>(
  () => halfInnings.value.find((cell) => cell.key === selectedKey.value) ?? halfInnings.value[0]!,
)

/** 這半局是我隊在打擊嗎（決定要不要輪轉打線、要不要顯示投手欄）。 */
const ourAtBat = computed(() => selected.value.side === 'our')

const selectedClip = computed(() =>
  props.clips.find(
    (clip) => clip.inning === selected.value.inning && clip.half === selected.value.half,
  ),
)

/** 播放器只在按下之後才建立 —— `autoplay=1` 要靠那次點擊才有效。 */
const playingClip = ref('')
watch(selectedKey, () => (playingClip.value = ''))

function cellClass(cell: HalfInningCell): string {
  if (cell.key === selectedKey.value) return 'border-brand-600 bg-brand-600 text-white'
  if (cell.status === 'complete') return 'border-brand-600/40 text-content'
  if (cell.status === 'partial') return 'border-warning text-warning'
  return 'border-border text-content-muted'
}

// ── 這半局的打席 ────────────────────────────────────────────────

const rows = computed(() => selected.value.plays)

function commit(next: Play[]): void {
  emit('save', selected.value.inning, selected.value.half, next)
}

function removeAt(index: number): void {
  commit(rows.value.filter((_, i) => i !== index))
}

function updateAt(index: number, patch: Partial<Play>): void {
  commit(rows.value.map((play, i) => (i === index ? { ...play, ...patch } : play)))
}

/**
 * 列表上的得分／打點 ＋／－。
 *
 * 改得分時打點跟著動（除非打點被手動改過），規則在 `adjustRuns()`；
 * 打點不能超過得分（`clampRbi()`）。
 */
function nextValue(
  play: Play,
  field: 'runs' | 'rbi',
  delta: number,
): { runs: number; rbi: number } {
  if (field === 'runs') return adjustRuns(play, play.runs + delta)
  return { runs: play.runs, rbi: clampRbi(play, play.rbi + delta) }
}

function canStep(play: Play, field: 'runs' | 'rbi', delta: number): boolean {
  const next = nextValue(play, field, delta)
  return next.runs !== play.runs || next.rbi !== play.rbi
}

function step(index: number, field: 'runs' | 'rbi', delta: number): void {
  const play = rows.value[index]
  if (!play) return
  updateAt(index, nextValue(play, field, delta))
}

// ── 打者：依打線輪轉 ────────────────────────────────────────────

/**
 * 打線在這個半局的狀態：每一棒現在是誰（含代打）、照打線輪到第幾棒。
 *
 * 由打席推導（`battingOrderAt()`），而且**只看這個半局為止的打席** ——
 * 回頭修改前面的半局時，後面已登錄的打席不能算進來。
 * ⚠️ 只有「打席」會換棒：跑者出局（盜壘失敗、牽制）時打擊區上的人還沒打完。
 */
const order = computed(() =>
  battingOrderAt(
    { plays: props.plays, homeAway: props.homeAway, lineup: props.lineup },
    selected.value.inning,
    selected.value.half,
  ),
)

/** 使用者點了別的棒次。`null` 代表照打線輪。 */
const chosenSlot = ref<number | null>(null)

/** 這一個打席由第幾棒打。 */
const selectedSlot = computed<number>({
  get: () => chosenSlot.value ?? order.value.nextSlot ?? 0,
  // 點回照打線應該輪到的那一棒，就等於回到「自動輪」
  set: (slot) => (chosenSlot.value = slot === order.value.nextSlot ? null : slot),
})

/** 選好了、還沒登錄的代打。 */
const pinch = ref<Play['batter'] | null>(null)

/**
 * 板凳：可以代打的人。已經站在打線上的不列；被代打換下的先發會出現
 * （業餘聯賽常允許重新上場）。
 */
const bench = computed<Play['batter'][]>(() => {
  const onField = new Set(order.value.slots.map((slot) => slot.current.playerId).filter(Boolean))
  return props.players
    .filter((player) => player.status !== 'inactive' && !onField.has(player.id))
    .map((player) => ({ playerId: player.id, name: player.name, number: player.number }))
})

/** 對手打擊時只填背號 —— 我們沒有對手的名冊，名單上本來就只有背號。 */
const opponentNumber = ref('')

const currentBatter = computed<Play['batter']>(() => {
  if (!ourAtBat.value) return { playerId: '', name: '', number: opponentNumber.value.trim() }
  if (pinch.value) return { ...pinch.value }
  const slot = order.value.slots.find((item) => item.slot === selectedSlot.value)
  return slot ? { ...slot.current } : { playerId: '', name: '', number: '' }
})

const batterLabel = computed(() => {
  const { name, number } = currentBatter.value
  if (!name && !number) return ourAtBat.value ? '（打線是空的）' : '（請填背號）'
  return number && name ? `#${number} ${name}` : number ? `#${number}` : name
})

// ── 投手 ────────────────────────────────────────────────────────

/**
 * 我隊防守時，這半局的投手。
 *
 * 預設接續上一筆打席的投手（一個半局多半是同一個人），換投時改一次就好。
 * 投手記在**每一筆打席**上而不是半局上 —— 半局中間換人的話，記在半局上
 * 就得把那半局拆開。
 */
const pitcherOverride = ref('')

/**
 * 這個半局之前最後一位投球的我隊投手。
 *
 * 看的是**整場到這個半局為止**，不是只看這個半局 —— 第 5 局換了中繼，
 * 第 6 局上來的預設就該是他，而不是又跳回先發。中繼與終結只記在打席上
 * （沒有另一份投手名單），所以這裡是唯一知道「現在誰在投」的地方。
 */
const lastPitcher = computed<Play['pitcher'] | null>(() => {
  const limit = halfInningOrder(selected.value.inning, selected.value.half)
  const earlier = sortPlays(props.plays).filter(
    (play) =>
      battingSide(play.half, props.homeAway) === 'opponent' &&
      halfInningOrder(play.inning, play.half) <= limit &&
      (play.pitcher.playerId || play.pitcher.name),
  )
  return earlier.at(-1)?.pitcher ?? null
})

/** 選單：先發投手、這場已經投過的人排前面，其餘是全隊名冊。 */
const pitcherOptions = computed(() => {
  const seen = new Map<string, Play['pitcher']>()
  if (props.startingPitcher?.playerId)
    seen.set(props.startingPitcher.playerId, props.startingPitcher)
  for (const play of props.plays) {
    if (play.pitcher.playerId) seen.set(play.pitcher.playerId, play.pitcher)
  }
  const label = (person: Play['pitcher']) =>
    `${person.number ? `#${person.number} ` : ''}${person.name}`
  return [
    ...[...seen.values()].map((person) => ({ value: person.playerId, label: label(person) })),
    ...props.players
      .filter((player) => !seen.has(player.id))
      .map((player) => ({
        value: player.id,
        label: label({ playerId: player.id, name: player.name, number: player.number }),
      })),
  ]
})

const currentPitcher = computed<Play['pitcher']>(() => {
  if (ourAtBat.value) return { playerId: '', name: '', number: '' }

  if (pitcherOverride.value) {
    const player = props.players.find((item) => item.id === pitcherOverride.value)
    if (player) return { playerId: player.id, name: player.name, number: player.number }
  }

  // 沒換投就沿用最後一位投球的人；整場都還沒投過就是先發投手
  if (lastPitcher.value) return { ...lastPitcher.value }
  const starter = props.startingPitcher
  return starter
    ? { playerId: starter.playerId, name: starter.name, number: starter.number }
    : { playerId: '', name: '', number: '' }
})

// ── 新增一個打席 ────────────────────────────────────────────────

const full = computed(() => rows.value.length >= MAX_PLAYS_PER_HALF_INNING)

/* ── 單局敘述（AI 產生）──────────────────────────────────── */

const { describeHalfInning } = useAiActions()

const narrativeError = ref('')
const describing = ref(false)
const copied = ref(false)

/**
 * 這個半局已經存下來的敘述。
 *
 * **直接讀比賽資料，不另外存一份本地狀態** —— 存了就會有「畫面上那一段」和
 * 「資料庫裡那一段」兩個來源，而換半局時忘了清掉的那一份看起來完全像是
 * 這一局的。前台顯示的也是這一份，所以這裡看到什麼、訪客就看到什麼。
 *
 * ⚠️ 改了打席之後它會自己消失 —— 伺服器在存打席時就把那一格刪掉了
 * （`saveHalfInningPlays()`），因為敘述講的已經是別的事。
 */
const narrative = computed(
  () => narrativeOf(props.narratives, selected.value.inning, selected.value.half)?.text ?? '',
)

watch(selectedKey, () => {
  narrativeError.value = ''
  copied.value = false
})

async function generateNarrative() {
  describing.value = true
  narrativeError.value = ''
  copied.value = false
  try {
    const result = await describeHalfInning({
      inning: selected.value.inning,
      half: selected.value.half,
      battingTeam: ourAtBat.value ? props.ourName : props.opponentName,
      fieldingTeam: ourAtBat.value ? props.opponentName : props.ourName,
      pitcher: ourAtBat.value ? '' : describePerson(currentPitcher.value),
      plays: rows.value.map((play) => ({
        batter: describePerson(play.batter),
        result: play.result,
        runs: play.runs,
        rbi: play.rbi,
        fielder: play.fielder,
        batted: play.batted,
      })),
    })
    if (!result.text) {
      narrativeError.value = '這次沒有產生出內容，請再試一次。'
      return
    }
    // 產生與保存是兩個動作：產出來的立刻寫進那一格（覆蓋舊的）
    emit('saveNarrative', selected.value.inning, selected.value.half, result.text)
  } catch (err) {
    narrativeError.value = ApiError.from(err).message
  } finally {
    describing.value = false
  }
}

async function copyNarrative() {
  try {
    await navigator.clipboard.writeText(narrative.value)
    copied.value = true
  } catch {
    // 沒有剪貼簿權限（或不是安全來源）時，文字本來就選得起來，不必擋路
    narrativeError.value = '複製失敗，請自己選取文字複製。'
  }
}

// ── 三出局之後鎖住 ──────────────────────────────────────────────

/**
 * 這個半局已經三出局了。
 *
 * **三出局之後不能再新增任何打席** —— 棒球的規則本身，不是介面的偏好。
 * 已登錄的打席也一併鎖住：場邊登錄的人手一滑就會刪到上一局的紀錄，
 * 而那種錯誤在畫面上很難發現。真的要修正時按「解鎖修改」，
 * 換到別的半局就自動重新鎖上。
 *
 * 再見分的半局不會有三個出局，所以不會被鎖（那也是對的：比賽結束了，
 * 但也沒有下一個打席可以登）。
 */
const complete = computed(() => selected.value.status === 'complete')
const editUnlocked = ref(false)
const rowsLocked = computed(() => complete.value && !editUnlocked.value)

/** 這個半局還剩幾個出局可以用。 */
const remainingOuts = computed(() => Math.max(0, 3 - selected.value.outs))

/* ── 對手打擊時，游標直接進背號框 ────────────────────────────── */

const numberField = useTemplateRef<{ focus: (options?: FocusOptions) => void }>('numberField')

/**
 * 現在該不該把游標放在背號框上。
 *
 * 對手打擊時，一個打席的第一個動作**一定是**打背號（我隊有名冊可以點，
 * 對手只有那個框）。少了自動 focus，場邊的人每個打席都要先點一下那個框 ——
 * 一場十幾次，而且他另一隻手還拿著手機在看球。
 */
const wantsNumberFocus = computed(() => Boolean(props.active) && !ourAtBat.value && !complete.value)

function focusNumberField() {
  if (!wantsNumberFocus.value) return
  /*
   * ⚠️ 要等 `nextTick`。
   *
   * 換半局（或剛切到這個分頁）時，這個框是**這一幀才被畫出來**的，而
   * 還沒進 DOM／還是 `display: none` 的元素 `.focus()` 會**安靜地沒有作用**
   * （和 `AdminRowMenu` 那個坑同一回事）。
   *
   * 刻意**不加** `preventScroll` —— 捲回輸入框正是這裡想要的：登完上一筆之後
   * 使用者多半停在下面的球場或打席列表上。
   */
  void nextTick(() => numberField.value?.focus())
}

/*
 * 三個會需要重新 focus 的時機，共用同一個判斷：
 * 切到這個分頁、換到（另一個）對手進攻的半局、以及登完一筆之後（`commit` 裡）。
 * `selectedKey` 要單獨看 —— 從「3 上」換到「5 上」時 `wantsNumberFocus`
 * 從頭到尾都是 true，只看它的話不會觸發。
 */
watch([wantsNumberFocus, selectedKey], () => focusNumberField())
onMounted(focusNumberField)

/**
 * 這個結果會不會讓出局數超過三。兩出局時不可能打出雙殺 ——
 * 登得進去的話，這個半局的出局數就是 4，而完整性與投球局數都從它算。
 */
function exceedsOuts(result: PlayResult): boolean {
  return PLAY_RESULTS[result].outs > remainingOuts.value
}

function goToNextHalf(): void {
  const index = halfInnings.value.findIndex((cell) => cell.key === selectedKey.value)
  const next = halfInnings.value[index + 1]
  if (next) selectedKey.value = next.key
}

watch(selectedKey, () => {
  editUnlocked.value = false
  chosenSlot.value = null
  pinch.value = null
  // 換投是登錄到打席上才算數；換半局時回到「沿用最後一位投球的人」，
  // 否則回頭改前面的半局時，會被後面才換上來的投手蓋掉
  pitcherOverride.value = ''
})

const canAdd = computed(() => {
  if (full.value || complete.value) return false
  const { name, number } = currentBatter.value
  return Boolean(name || number)
})

// ── 打者站哪邊打 ────────────────────────────────────────────────

/**
 * 左右開弓的打者這個打席站哪邊。只有他們需要問，其他人從名冊帶入。
 * 預設右打：台灣業餘球員的左右開弓，多數時候是對右投站左邊、對左投站右邊，
 * 這裡猜不到投手是哪一手，所以給一個固定的預設、讓人改。
 */
const switchSide = ref<BatSide>('R')

const batterPlayer = computed(() =>
  props.players.find((player) => player.id === currentBatter.value.playerId),
)

const isSwitchHitter = computed(() => ourAtBat.value && batterPlayer.value?.bats === 'S')

/**
 * 這個打席站哪邊打。對手是 `null` —— 對手沒有名冊，而多問一個每次都要點的
 * 欄位，就是當初「欄位越多越沒人填」的那個理由。
 */
const currentBats = computed<BatSide | null>(() => {
  if (!ourAtBat.value) return null
  const bats = batterPlayer.value?.bats
  if (!bats) return null
  return bats === 'S' ? switchSide.value : bats
})

// ── 新增一個打席 ────────────────────────────────────────────────

/** 剛放開、還在等選結果的落點。 */
const pendingPoint = ref<FieldPoint | null>(null)

interface Landing {
  location: FieldPoint | null
  fielder: Position | null
  batted: BattedType | null
}

const NO_LANDING: Landing = { location: null, fielder: null, batted: null }

/** 本壘旁那一排按鈕的字。一排五顆，「四壞球保送」放不下。 */
const NO_LANDING_LABELS: Record<(typeof NO_LANDING_RESULTS)[number], string> = {
  strikeout: '三振',
  walk: '保送',
  hitByPitch: '觸身',
  runnerOut: '跑者出局',
  other: '其他',
}

function addPlay(result: PlayResult, landing: Landing = NO_LANDING): void {
  if (!canAdd.value || exceedsOuts(result)) return

  const next: Play[] = [
    ...rows.value,
    {
      inning: selected.value.inning,
      half: selected.value.half,
      batter: currentBatter.value,
      pitcher: currentPitcher.value,
      result,
      runs: defaultRuns(result),
      rbi: defaultRbi(result, defaultRuns(result)),
      note: '',
      transcript: '',
      ...landing,
      bats: currentBats.value,
      battingSlot: ourAtBat.value ? selectedSlot.value || null : null,
    },
  ]
  commit(next)

  // 登完一筆就重置：打者回到「自動帶下一棒」，得分回到 0。
  // 不重置的話，下一個打席會默默沿用上一個的得分。
  chosenSlot.value = null
  pinch.value = null
  opponentNumber.value = ''
  switchSide.value = 'R'
  pendingPoint.value = null

  // 下一個打者的背號馬上就要打，游標留在那裡
  focusNumberField()

  // 第三個出局登錄完，直接跳到下一個半局 —— 下一筆一定是在那裡
  if (halfInningOuts(next) >= 3) void nextTick(goToNextHalf)
}

// ── 在球場上拖曳 ────────────────────────────────────────────────

/**
 * 正在重新拖曳落點的那一筆（列表上點「改落點」）。有值的時候，下一次放開
 * 改的是它的落點，而不是新增一個打席。
 */
const relocateIndex = ref<number | null>(null)

/** 列表上點選、在球場上亮起來的那一筆。 */
const activeIndex = ref<number | null>(null)

watch(selectedKey, () => {
  pendingPoint.value = null
  relocateIndex.value = null
  activeIndex.value = null
})

function onDrop(point: FieldPoint): void {
  if (relocateIndex.value !== null) {
    const index = relocateIndex.value
    const play = rows.value[index]
    if (play) {
      updateAt(index, {
        location: point,
        // 換了落點，預選的處理者也跟著換；使用者原本就選了的話保留
        fielder: needsFielder(play.result)
          ? (play.fielder ?? nearestFielder(point).position)
          : null,
        batted: needsBattedType(play.result) ? (play.batted ?? defaultBatted(point)) : null,
      })
    }
    relocateIndex.value = null
    activeIndex.value = null
    return
  }
  if (!canAdd.value) return
  pendingPoint.value = point
}

function onLandingConfirm(payload: {
  result: PlayResult
  fielder: Position | null
  batted: BattedType | null
}): void {
  addPlay(payload.result, {
    location: pendingPoint.value,
    fielder: payload.fielder,
    batted: payload.batted,
  })
}

function startRelocate(index: number): void {
  pendingPoint.value = null
  relocateIndex.value = index
  activeIndex.value = index
}

/** 一筆打席的落點摘要，列表上用：「→ 游擊手」「→ 外野」。 */
function landingText(play: Play): string {
  if (!play.location) return ''
  if (play.fielder) return `→ ${POSITION_LABELS[play.fielder]}`
  return `→ ${ZONE_LABELS[zoneOf(play.location)]}`
}

// ── 語音登錄 ────────────────────────────────────────────────────

/**
 * 按「開始錄音」，說完再按「停止並辨識」，辨識出幾個打席。
 *
 * ⚠️ **辨識結果不會自動寫進去。** 它先進下面那張暫存卡片，人看過、改過
 * 才按「全部採用」—— 和另外四支 AI 辨識端點同一套紀律（回傳的是建議，
 * 不是已經存好的資料）。語音在球場邊很容易聽錯一個背號，而錯的那一筆
 * 會一路影響到打擊率。
 */
const voice = useVoicePlayInput()

/**
 * 同一顆按鈕開始與停止。
 *
 * ⚠️ 綁的是 `click` 而不是 `pointerdown`／`pointerup`：鍵盤按 Enter／空白鍵
 * 只會發 `click`，一個指標事件都不會發。
 */
function toggleVoice(): void {
  if (voice.status.value === 'recording') void stopVoice()
  else void voice.start(() => void stopVoice())
}

/** 錄音中的計時，給「到底有沒有在錄」一個看得見的答案。 */
const elapsedLabel = computed(() => {
  const total = Math.floor(voice.elapsedMs.value / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
})

/** 送辨識時一起帶上去的脈絡。現場錄音與上傳檔案共用同一份。 */
function voiceContext() {
  return {
    inning: selected.value.inning,
    half: selected.value.half,
    batting: selected.value.side,
    roster: props.players.map((player) => ({
      id: player.id,
      name: player.name,
      number: player.number,
    })),
    existing: rows.value.map((play) => ({
      number: play.batter.number,
      result: PLAY_RESULTS[play.result].label,
    })),
  }
}

async function stopVoice(): Promise<void> {
  await voice.stop(voiceContext())
}

const audioInput = ref<HTMLInputElement | null>(null)

/**
 * 挑了錄音檔。**一個或好幾個都可以。**
 *
 * 錄法沒有規定：一個半局錄一個檔（錄音筆開著不關）、一個打席錄一段
 * （每次下場按一下）、或混著來都行 —— 挑進來之後會照錄的時間排好，
 * 接成一條音軌再送（見 `parseFiles()`）。
 *
 * ⚠️ 這和「現場錄音」是同一條辨識路徑，只是音訊來源不同 —— 結果一樣進
 * 暫存卡片，一樣要人確認過才寫進半局。
 */
async function onAudioPicked(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  // 清空才挑得了同一個檔案第二次（change 比對的是 value）
  input.value = ''
  if (files.length) await voice.parseFiles(files, voiceContext())
}

type Suggestion = (typeof voice.suggestions.value)[number]

/**
 * 暫存卡片上每一筆的問題。有任何一筆有問題就不能「全部採用」——
 * 刪掉那一筆重講，或改用球場登錄。
 */
function suggestionProblem(item: Suggestion): string {
  if (!item.result) return '聽不出結果'
  if (!item.batter.number && !item.batter.name) return '聽不出打者'
  return ''
}

/** 採用之後這個半局會有幾個出局。超過三就不能採用（和手動登錄同一條規則）。 */
const suggestedOuts = computed(() =>
  voice.suggestions.value.reduce(
    (sum, item) => sum + (item.result ? PLAY_RESULTS[item.result].outs : 0),
    0,
  ),
)

const acceptBlocker = computed(() => {
  if (complete.value) return '這個半局已經三出局了。'
  const problems = voice.suggestions.value.filter((item) => suggestionProblem(item)).length
  if (problems) return `有 ${problems} 筆需要處理（刪掉重講，或改用球場登錄）。`
  if (suggestedOuts.value > remainingOuts.value) {
    return `這幾筆共 ${suggestedOuts.value} 個出局，但這個半局只剩 ${remainingOuts.value} 個。`
  }
  return ''
})

/**
 * 把辨識出來的打席寫進這個半局。
 *
 * 語音沒講到的欄位（`null`）在這裡才補上 —— 用的是和手動登錄**同一套**預設：
 * 得分依結果（`defaultRuns()`），打點依得分（`defaultRbi()`），投手是現在在投的
 * 那一位，左右打與第幾棒看名冊與打線。落點永遠是空的（要落點就「補落點」）。
 */
function acceptSuggestions(): void {
  if (acceptBlocker.value) return

  const pitcher = currentPitcher.value
  const added: Play[] = voice.suggestions.value.map((item) => {
    const result = item.result!
    const batter = {
      playerId: item.batter.playerId ?? '',
      name: item.batter.name ?? '',
      number: item.batter.number ?? '',
    }
    const runs = Math.max(item.runs ?? defaultRuns(result), defaultRuns(result))
    const rbi = item.rbi === null ? defaultRbi(result, runs) : clampRbi({ runs }, item.rbi)
    const player = props.players.find((candidate) => candidate.id === batter.playerId)
    const ours = selected.value.side === 'our'

    return {
      inning: selected.value.inning,
      half: selected.value.half,
      batter,
      pitcher,
      result,
      runs,
      rbi,
      note: '',
      // 原話留著 —— 辨識錯的時候，看得到當初講了什麼才知道該改成什麼
      transcript: item.sourceText,
      location: null,
      fielder: item.fielder,
      batted: item.batted,
      // 左右開弓的人語音沒講站哪邊，就不記（不猜）
      bats: ours && player?.bats && player.bats !== 'S' ? player.bats : null,
      battingSlot: ours ? slotOfBatter(order.value.slots, batter) : null,
    }
  })

  const next = [...rows.value, ...added]
  commit(next)
  voice.clear()
  if (halfInningOuts(next) >= 3) void nextTick(goToNextHalf)
}

function dropSuggestion(index: number): void {
  voice.suggestions.value = voice.suggestions.value.filter((_, i) => i !== index)
}

/** 暫存卡片上一筆的摘要：「#24 張志豪 三壘安打 · 游擊 · 滾地 · 得 1 分」。 */
function suggestionText(item: Suggestion): string {
  const who = item.batter.number
    ? `#${item.batter.number}${item.batter.name ? ` ${item.batter.name}` : ''}`
    : (item.batter.name ?? '（打者？）')
  const parts = [who, item.result ? PLAY_RESULTS[item.result].label : '（結果？）']
  if (item.fielder) parts.push(POSITION_LABELS[item.fielder])
  if (item.batted) parts.push(BATTED_LABELS[item.batted])
  if (item.runs !== null) parts.push(`得 ${item.runs} 分`)
  if (item.rbi !== null) parts.push(`${item.rbi} 打點`)
  return parts.join(' · ')
}
</script>

<template>
  <div class="space-y-5">
    <!-- ══ 半局選擇器 ══════════════════════════════════════════ -->
    <div>
      <div class="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 class="text-fluid-lg font-bold">逐局紀錄</h2>
        <p v-if="pendingCount" class="text-fluid-sm text-warning">
          {{ pendingCount }} 個半局還沒同步
          <button type="button" class="ml-2 underline underline-offset-4" @click="emit('retry')">
            重試
          </button>
        </p>
      </div>

      <!--
        橫向捲動而不是換行：十四格排成兩三列的話，「現在在第幾局」這件事
        要掃視整塊才看得出來。和錄影頁的局數按鈕是同一個語彙。
      -->
      <div class="-mx-1 overflow-x-auto px-1 pb-2">
        <div class="flex gap-1.5" role="tablist" aria-label="半局">
          <button
            v-for="cell in halfInnings"
            :key="cell.key"
            type="button"
            role="tab"
            :aria-selected="cell.key === selectedKey"
            class="min-h-14 shrink-0 rounded-xl border px-3 text-center transition"
            :class="cellClass(cell)"
            @click="selectedKey = cell.key"
          >
            <span class="block text-xs whitespace-nowrap">
              {{ cell.inning }}{{ cell.half === 'top' ? '上' : '下' }}
            </span>
            <span class="block text-fluid-sm font-bold whitespace-nowrap">
              <!-- 還沒登錄的半局顯示 — 而不是 0：那兩者意思完全不同 -->
              {{ cell.status === 'empty' ? '—' : cell.runs }}
              <span v-if="cell.hasClip" aria-label="有影片">🎬</span>
            </span>
          </button>
        </div>
      </div>

      <p class="text-fluid-sm text-content-muted">
        邊框顏色代表登錄程度：灰＝還沒登、<span class="text-warning">黃＝還沒滿三出局</span
        >、綠＝這半局登完了。
      </p>
    </div>

    <!-- ══ 選到的半局 ══════════════════════════════════════════ -->
    <section class="space-y-4 rounded-2xl border border-border bg-surface p-4">
      <div class="flex flex-wrap items-baseline justify-between gap-2">
        <h3 class="text-fluid-lg font-bold">
          {{ halfInningLabel(selected.inning, selected.half) }}
          <span class="ml-2 text-fluid-sm font-normal text-content-muted">
            {{ ourAtBat ? ourName : opponentName }} 進攻
          </span>
        </h3>
        <p class="text-fluid-sm tabular-nums text-content-muted">
          {{ selected.runs }} 分 · {{ selected.outs }}／3 出局
          <span v-if="selected.status === 'complete'" class="ml-1 text-brand-600">✓</span>
        </p>
      </div>

      <!--
        這半局的影片。賽後對著它登錄就是整個「逐局維護」的用意 ——
        暫停、重看、登錄都在同一個畫面上。
      -->
      <div v-if="selectedClip" class="overflow-hidden rounded-xl bg-ink">
        <div class="relative aspect-video">
          <iframe
            v-if="playingClip === selectedClip.videoId"
            :src="clipEmbedUrl(selectedClip.videoId)"
            :title="halfInningLabel(selected.inning, selected.half)"
            class="absolute inset-0 size-full"
            allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
            allowfullscreen
          />
          <button
            v-else
            type="button"
            class="absolute inset-0 grid size-full place-items-center text-white"
            @click="playingClip = selectedClip.videoId"
          >
            <span class="rounded-full bg-danger px-5 py-2 text-fluid-sm font-bold">
              ▶ 播放這半局
            </span>
          </button>
        </div>
      </div>

      <!-- 我隊防守的半局才問投手：對手的投手我們沒有名冊，記了也推不出東西 -->
      <UiBaseSelect
        v-if="!ourAtBat && !complete && pitcherOptions.length"
        v-model="pitcherOverride"
        label="我隊投手"
        class="sm:max-w-xs"
        :options="pitcherOptions"
        :placeholder="
          currentPitcher.name
            ? `沿用 #${currentPitcher.number} ${currentPitcher.name}`
            : '— 尚未指定 —'
        "
        hint="換投時改這裡，之後登錄的打席就會記到新的投手身上。"
      />

      <!-- ── 已登錄的打席 ──────────────────────────────────── -->
      <ol v-if="rows.length" class="space-y-1.5">
        <li
          v-for="(play, index) in rows"
          :key="index"
          class="space-y-1.5 rounded-lg px-3 py-2 text-fluid-sm transition"
          :class="activeIndex === index ? 'bg-danger/10' : 'bg-surface-muted'"
          @click="activeIndex = activeIndex === index ? null : index"
        >
          <!--
            固定兩列：上面是這個打席是什麼（＋改落點、刪除），下面是得分與打點。
            讓 ＋／－ 在每一筆都落在同一個位置 —— 一整列 flex-wrap 的話，有沒有
            「改落點」那顆按鈕會讓它們在不同筆之間跳來跳去，連點時很容易點錯。
          -->
          <div class="flex items-center gap-2">
            <span class="w-5 shrink-0 tabular-nums text-content-muted">{{ index + 1 }}.</span>
            <p class="min-w-0 flex-1">
              <!--
                跑者出局記在當時打擊中的人身上（他還沒打完），但出局的不是他。
                寫成「#9 李承翰 跑者出局」會被讀成 9 號出局了。
              -->
              <template v-if="PLAY_RESULTS[play.result].plateAppearance">
                <span class="font-bold">{{ describeBatter(play) }}</span>
                {{ PLAY_RESULTS[play.result].label }}
              </template>
              <template v-else>
                <span class="font-bold">{{ PLAY_RESULTS[play.result].label }}</span>
                <span class="text-content-muted">（{{ describeBatter(play) }} 打擊中）</span>
              </template>
              <span v-if="landingText(play)" class="ml-1 text-content-muted">
                {{ landingText(play) }}</span
              >
              <span v-if="PLAY_RESULTS[play.result].outs" class="text-content-muted">
                · {{ PLAY_RESULTS[play.result].outs }} 出局</span
              >
            </p>

            <!--
              補落點／改落點：按下去之後，下一次在球場上放開改的是這一筆。
              沒有落點的結果（三振、保送）不給這顆按鈕 —— 它們本來就沒有落點。
            -->
            <button
              v-if="!rowsLocked && !(NO_LANDING_RESULTS as readonly string[]).includes(play.result)"
              type="button"
              class="min-h-8 shrink-0 rounded px-1 text-xs text-content-muted underline underline-offset-4 hover:text-brand-600"
              @click.stop="startRelocate(index)"
            >
              {{ play.location ? '改落點' : '補落點' }}
            </button>
            <button
              v-if="!rowsLocked"
              type="button"
              class="min-h-8 shrink-0 rounded px-2 text-content-muted hover:text-danger"
              :aria-label="`移除第 ${index + 1} 個打席`"
              @click.stop="removeAt(index)"
            >
              ✕
            </button>
          </div>

          <!--
            得分與打點都在這一筆上調，登錄之後隨時回頭改（三出局後要先解鎖）。
            得分＝這個打席有幾人跑回本壘（計分板用），打點＝其中算在打者身上的。
            用 ＋／－ 而不是數字輸入框：手機上點一下比叫出鍵盤快，也不會打出 5。
          -->
          <div class="flex items-center gap-5 pl-7" @click.stop>
            <div
              v-for="field in (['runs', 'rbi'] as const).filter(
                (f) => f === 'runs' || PLAY_RESULTS[play.result].plateAppearance,
              )"
              :key="field"
              class="flex items-center gap-1 text-xs"
              role="group"
              :aria-label="`第 ${index + 1} 個打席的${field === 'runs' ? '得分' : '打點'}`"
            >
              <span class="text-content-muted">{{ field === 'runs' ? '得分' : '打點' }}</span>
              <button
                v-if="!rowsLocked"
                type="button"
                class="size-8 rounded border border-border bg-surface text-fluid-sm disabled:opacity-30"
                :disabled="!canStep(play, field, -1)"
                :aria-label="`${field === 'runs' ? '得分' : '打點'}減一`"
                @click="step(index, field, -1)"
              >
                −
              </button>
              <span
                class="w-5 text-center text-fluid-sm font-bold"
                :class="field === 'runs' && play.runs ? 'text-brand-600 dark:text-brand-300' : ''"
              >
                {{ play[field] }}
              </span>
              <button
                v-if="!rowsLocked"
                type="button"
                class="size-8 rounded border border-border bg-surface text-fluid-sm disabled:opacity-30"
                :disabled="!canStep(play, field, 1)"
                :aria-label="`${field === 'runs' ? '得分' : '打點'}加一`"
                @click="step(index, field, 1)"
              >
                ＋
              </button>
            </div>
          </div>
        </li>
      </ol>

      <p
        v-else
        class="rounded-lg bg-surface-muted px-3 py-4 text-center text-fluid-sm text-content-muted"
      >
        這個半局還沒有紀錄。
      </p>

      <!--
        ── 單局敘述（AI 產生的草稿）────────────────────────
        產生出來**不存回資料庫**：它是從打席生出來的，打席一改就過時，
        存起來等於多一份會和真相對不上的資料。要用的人自己複製。
      -->
      <div v-if="rows.length" class="space-y-2">
        <div class="flex flex-wrap items-center gap-2">
          <UiBaseButton
            variant="secondary"
            size="sm"
            :loading="describing"
            @click="generateNarrative"
          >
            ✨ 產生這半局的敘述
          </UiBaseButton>
          <span v-if="narrative" class="text-xs text-content-muted">
            AI 產生的草稿，貼出去之前請看過一遍
          </span>
        </div>

        <p v-if="narrativeError" class="text-fluid-sm text-danger">{{ narrativeError }}</p>

        <div v-if="narrative" class="space-y-2 rounded-xl border border-border bg-surface p-3">
          <p class="text-fluid-sm whitespace-pre-wrap">{{ narrative }}</p>
          <div class="flex flex-wrap items-center gap-2">
            <UiBaseButton variant="ghost" size="sm" @click="copyNarrative">
              {{ copied ? '已複製' : '複製' }}
            </UiBaseButton>
            <UiBaseButton
              variant="ghost"
              size="sm"
              :loading="describing"
              @click="generateNarrative"
            >
              重新產生
            </UiBaseButton>
          </div>
        </div>
      </div>

      <!--
        ── 三出局：鎖住 ──
        三出局之後不能再新增打席（棒球規則本身）。已登錄的也一併鎖住，
        避免場邊手滑刪到上一局；要修正時才解鎖，換半局自動重新鎖上。
      -->
      <div
        v-if="complete"
        class="flex flex-wrap items-center gap-3 rounded-xl bg-brand-600/10 px-3 py-3 text-fluid-sm"
        role="status"
      >
        <p v-if="!editUnlocked" class="min-w-0 flex-1 text-brand-700 dark:text-brand-300">
          ✓ 這個半局已經三出局，登錄已鎖住。
        </p>
        <p v-else class="min-w-0 flex-1 text-warning">
          解鎖中：可以修改或刪除這個半局的打席，但不能再新增（已經三出局）。
        </p>

        <template v-if="!editUnlocked">
          <UiBaseButton size="sm" @click="goToNextHalf">前往下一個半局</UiBaseButton>
          <UiBaseButton variant="ghost" size="sm" @click="editUnlocked = true"
            >解鎖修改</UiBaseButton
          >
        </template>
        <UiBaseButton
          v-else
          variant="secondary"
          size="sm"
          @click="((editUnlocked = false), (relocateIndex = null), (activeIndex = null))"
        >
          完成，重新鎖上
        </UiBaseButton>
      </div>

      <!-- ── 新增打席 ──────────────────────────────────────── -->
      <div
        v-if="!complete || editUnlocked"
        class="space-y-3 rounded-xl border border-dashed border-border p-3"
      >
        <!--
          ⚠️ 我隊進攻時**預設帶下一棒**，所以多數打席只要按一個結果鍵。
          這是整個功能能不能被實際使用的關鍵，不是可有可無的便利。
          打線整份列出來、輪到的亮起來；代打在亮起來的那一棒上按。
        -->
        <template v-if="!complete">
          <AdminBattingOrder
            v-if="ourAtBat && order.slots.length && order.nextSlot !== null"
            v-model:slot="selectedSlot"
            v-model:pinch="pinch"
            :slots="order.slots"
            :next-slot="order.nextSlot"
            :bench="bench"
          />
        </template>

        <!--
          上下排而不是並排：背號框在寬螢幕上會被撐得很長，得分按鈕被擠到最右邊，
          視線要左右跳。上下排之後兩個欄位都在左邊對齊，由上往下填。
        -->
        <div v-if="!complete" class="flex flex-col items-start gap-3">
          <div v-if="!ourAtBat" class="w-full max-w-xs">
            <UiBaseInput
              ref="numberField"
              v-model="opponentNumber"
              label="對手打者背號"
              digits
              :maxlength="3"
              placeholder="例如 24"
              hint="對手沒有名冊，記背號就夠了。"
            />
          </div>

          <!-- 左右開弓的人每個打席可能站不同邊，只有他們需要問 -->
          <div v-if="isSwitchHitter">
            <span class="mb-1 block text-fluid-sm font-medium">這個打席站</span>
            <div class="flex gap-1" role="group" aria-label="這個打席站哪邊打">
              <button
                v-for="side in ['L', 'R'] as const"
                :key="side"
                type="button"
                class="min-h-11 rounded-lg border px-3 text-fluid-sm transition"
                :class="
                  switchSide === side
                    ? 'border-brand-600 bg-brand-600 text-white'
                    : 'border-border text-content-muted hover:bg-surface-muted'
                "
                :aria-pressed="switchSide === side"
                @click="switchSide = side"
              >
                {{ side === 'L' ? '左打' : '右打' }}
              </button>
            </div>
          </div>
        </div>

        <!--
          ⚾ 主要的登錄方式：從本壘的球拖到落點，放開後在選單上點結果。
          常見的情況是「拖一次、點一次」。落點會存進資料庫，前台畫成落點圖。
        -->
        <div class="mx-auto max-w-lg">
          <p v-if="relocateIndex !== null" class="mb-2 text-fluid-sm text-danger">
            把球拖到第 {{ relocateIndex + 1 }} 個打席的新落點。
            <button
              type="button"
              class="ml-2 underline underline-offset-4"
              @click="((relocateIndex = null), (activeIndex = null))"
            >
              取消
            </button>
          </p>

          <AdminFieldPicker
            :plays="rows"
            :active-index="activeIndex"
            :bats="currentBats"
            :disabled="relocateIndex === null && !canAdd"
            @drop="onDrop"
          />

          <p
            v-if="complete && relocateIndex === null"
            class="mt-2 text-fluid-sm text-content-muted"
          >
            在列表上按「改落點」，再把球拖到新的位置。
          </p>

          <!--
            沒有落點的結果放在本壘旁邊，點一下就好，不用拖。
            三振與保送佔一場打席的三成以上，而「投手前滾地」是真的會拖到
            投手身上的情況 —— 兩者混在同一個選單裡很容易點錯。
          -->
          <div
            v-if="!complete"
            class="mt-2 grid grid-cols-5 gap-1.5"
            role="group"
            aria-label="沒有落點的結果"
          >
            <button
              v-for="result in NO_LANDING_RESULTS"
              :key="result"
              type="button"
              class="min-h-11 rounded-lg border border-border px-0.5 text-xs font-bold whitespace-nowrap transition hover:bg-surface-muted disabled:opacity-40"
              :disabled="!canAdd || exceedsOuts(result)"
              @click="addPlay(result)"
            >
              {{ NO_LANDING_LABELS[result] }}
            </button>
          </div>
        </div>

        <AdminLandingSheet
          v-if="pendingPoint"
          :point="pendingPoint"
          :batter-label="batterLabel"
          :remaining-outs="remainingOuts"
          @confirm="onLandingConfirm"
          @cancel="pendingPoint = null"
        />

        <!--
          ── 語音登錄（常駐）──
          球場拖曳之外唯一的輸入方式。一次可以連著講三四個打席
          （「24 號三壘安打、56 號三振」），模型自己斷句；講到的欄位
          （守備位置、滾地／平飛／高飛、得分、打點）都會帶進來，沒講的留空。
          辨識結果進暫存卡片，**確認過才寫進去**。語音登錄的打席沒有落點，
          要落點就在列表上「補落點」。

          原本的結果按鈕格拿掉了：它和球場拖曳做的是同一件事，卻不記落點，
          留著只會讓人不知道該用哪一個。
          瀏覽器錄不出聲音時整塊不顯示 —— 一顆按了沒反應的按鈕比沒有更糟。

          **按一下開始、再按一下停止**，不是按住說話：比賽中沒有那麼多時間
          按著一顆按鈕。按鈕上帶計時，因為手指放開不再是「還在錄嗎」的答案；
          錄到上限會自己停下來送辨識（見 `MAX_RECORDING_MS`）。
        -->
        <section
          v-if="!complete && voice.supported.value"
          class="space-y-2 rounded-xl border border-border bg-surface p-3"
          aria-label="語音登錄"
        >
          <div class="flex flex-wrap items-center gap-3">
            <button
              type="button"
              class="min-h-12 rounded-full border px-5 text-fluid-sm font-bold transition select-none"
              :class="
                voice.status.value === 'recording'
                  ? 'border-danger bg-danger text-white'
                  : 'border-border hover:bg-surface-muted'
              "
              :disabled="voice.status.value === 'parsing'"
              @click="toggleVoice"
            >
              {{
                voice.status.value === 'recording'
                  ? `⏹ 停止並辨識 ${elapsedLabel}`
                  : voice.status.value === 'parsing'
                    ? '辨識中…'
                    : '🎤 開始錄音'
              }}
            </button>
            <!--
              ⚠️ 上傳錄音檔不是「另一種語音功能」，是同一條路的另一個音訊來源。
              人在場上打球時手機不在身邊，隨身錄音筆照樣錄得到他唸的那幾句；
              下場之後把檔案挑進來，結果一樣進暫存卡片讓他確認。
            -->
            <input
              ref="audioInput"
              type="file"
              accept="audio/*,.mp3,.m4a,.wav"
              multiple
              class="hidden"
              @change="onAudioPicked"
            />
            <UiBaseButton
              variant="secondary"
              size="sm"
              :disabled="voice.status.value !== 'idle'"
              @click="audioInput?.click()"
            >
              📁 上傳錄音檔
            </UiBaseButton>

            <span class="text-xs text-content-muted">
              例如「24 號游擊方向滾地球出局、18 號左外野平飛安打得一分」。
              錄音檔可以一次挑多個（一個打席一段也行），會照錄的時間排好。
            </span>
          </div>

          <!--
            解析長檔案會跑好幾十秒（一段一次呼叫），所以進度一定要看得到 ——
            而且要寫出「挑出幾秒語音」，那是人唯一能判斷「它有沒有抓到我講的話」
            的地方。
          -->
          <p v-if="voice.progress.value.total > 1" class="text-fluid-sm text-content-muted">
            解析中 {{ voice.progress.value.done }} / {{ voice.progress.value.total }} 段（錄音裡
            {{ Math.round(voice.speechSeconds.value) }} 秒有說話）
          </p>

          <p v-if="voice.error.value" class="text-fluid-sm text-danger">
            {{ voice.error.value }}
          </p>

          <!-- 辨識結果：**確認過才寫進去**，不自動採用 -->
          <div
            v-if="voice.suggestions.value.length"
            class="space-y-2 rounded-lg border border-brand-600/40 bg-brand-600/5 p-3"
          >
            <p class="text-fluid-sm font-bold">聽到這些打席，確認後再採用：</p>
            <p v-if="voice.transcript.value" class="text-xs text-content-muted">
              原話：{{ voice.transcript.value }}
            </p>

            <ul class="space-y-1">
              <li
                v-for="(item, index) in voice.suggestions.value"
                :key="index"
                class="flex flex-wrap items-center gap-2 text-fluid-sm"
              >
                <span>{{ suggestionText(item) }}</span>
                <UiBaseBadge v-if="suggestionProblem(item)" tone="danger" size="sm">
                  {{ suggestionProblem(item) }}
                </UiBaseBadge>
                <!-- 把握度低的要講出來，不要讓它混在確定的那幾筆裡 -->
                <UiBaseBadge
                  v-else-if="item.confidence < LOW_CONFIDENCE_THRESHOLD"
                  tone="warning"
                  size="sm"
                >
                  請確認
                </UiBaseBadge>
                <button
                  type="button"
                  class="ml-auto min-h-8 rounded px-2 text-content-muted hover:text-danger"
                  :aria-label="`不要這一筆：${item.sourceText || suggestionText(item)}`"
                  @click="dropSuggestion(index)"
                >
                  ✕
                </button>
              </li>
            </ul>

            <p class="text-xs text-content-muted">
              沒講到的欄位採用時才補：得分依結果（全壘打 1 分、其餘 0）、打點依得分，
              投手是現在在投的那一位。可以在列表上再調。
            </p>

            <p v-for="warning in voice.warnings.value" :key="warning" class="text-xs text-warning">
              {{ warning }}
            </p>
            <p v-if="acceptBlocker" class="text-xs text-danger">{{ acceptBlocker }}</p>

            <div class="flex flex-wrap gap-2">
              <UiBaseButton size="sm" :disabled="Boolean(acceptBlocker)" @click="acceptSuggestions">
                全部採用
              </UiBaseButton>
              <UiBaseButton variant="ghost" size="sm" @click="voice.clear">丟棄</UiBaseButton>
            </div>
          </div>
        </section>

        <p v-if="full" class="text-fluid-sm text-warning">
          這個半局已經有 {{ MAX_PLAYS_PER_HALF_INNING }} 個打席了，再多八成是登錯半局。
        </p>
        <p v-else-if="!canAdd && !complete" class="text-fluid-sm text-content-muted">
          {{
            ourAtBat ? '先到「打線」分頁排好先發陣容，這裡才輪得到人。' : '請先填對手打者的背號。'
          }}
        </p>
      </div>
    </section>
  </div>
</template>
