<script setup lang="ts">
import type { AttendanceEntry } from '#shared/schemas/game'
import { ATTENDANCE_LABELS } from '#shared/schemas/game'
import { selfReportStatusSchema, type SelfReportStatus } from '#shared/schemas/attendance-request'
import { ApiError } from '~/utils/api-error'

/**
 * 出席名單。**隊員自己在這裡回報。**
 *
 * 依狀態分組而不是列成一長串：教練最想知道的是「幾個人會到」，
 * 分組之後這個數字一眼就看得到，不用自己數。順帶的好處是回報完會看到
 * 自己的名字跳到另一組 —— 那本身就是「存進去了」最清楚的回饋。
 *
 * ## 互動照抄「冠軍預測」，資料路徑沒有
 * 兩段式：**先點自己的名字、再點答案**（`docs/ws-bracket.md` 的下注是
 * 先點頭像再點球隊）。一個人一列三顆按鈕在手機上太擠，而且 ——
 *
 * ## ⚠️ 沒有前台登入，所以誰都能改誰的
 * 和冠軍預測一樣是**純信任**。ws-bracket 的文件已經論證過：靠 localStorage
 * 記「我是誰」會在換手機、清資料、無痕視窗之後失效，變成「明明是我卻改不了」
 * —— 比誰都能改更糟。所以防的是**手滑**而不是惡意：點了名字之後要再點一次
 * 答案，而且那一步會把名字寫出來（「你要把 #24 張志豪 設為…」）。
 * 真的被亂改時，後台隨時改得回來。
 *
 * 真正擋得住的那幾層在伺服器端（只能改既有的人、只收列舉值、不收自由文字、
 * 只有還沒開打的場次），見 `shared/schemas/attendance-request.ts`。
 */
const props = defineProps<{
  entries: AttendanceEntry[]
  /** 給了就能回報。已開打／已結束的場次不要傳 —— 伺服器也會擋。 */
  gameId?: string
}>()

const emit = defineEmits<{ updated: [entries: AttendanceEntry[]] }>()

const GROUPS = [
  { status: 'yes' as const, tone: 'success' as const },
  { status: 'maybe' as const, tone: 'warning' as const },
  { status: 'no' as const, tone: 'danger' as const },
  { status: 'pending' as const, tone: 'neutral' as const },
]

const groups = computed(() =>
  GROUPS.map((group) => ({
    ...group,
    label: ATTENDANCE_LABELS[group.status],
    members: props.entries.filter((entry) => entry.status === group.status),
  })).filter((group) => group.members.length > 0),
)

const confirmedCount = computed(() => props.entries.filter((e) => e.status === 'yes').length)

/* ── 自己回報 ──────────────────────────────────────────────── */

const editable = computed(() => Boolean(props.gameId))

/** 可以選的三個答案。`pending`（未回覆）刻意不在裡面，理由見 schema。 */
const CHOICES = selfReportStatusSchema.options

/**
 * 正在選答案的那個人。一次只有一個，所以是 playerId 不是 Set。
 *
 * ⚠️ **哨兵值是 `null` 不是 `''`。** 名單上的臨時支援球員 `playerId` 就是
 * 空字串 —— 用 `''` 當「沒有展開任何人」的話，`open === member.playerId`
 * 對他永遠成立，他那一列從第一次渲染起就張著答案面板（而且點不動）。
 */
const open = ref<string | null>(null)
const saving = ref<string | null>(null)
const error = ref('')

const { answerAttendance } = useGameActions()

/**
 * ⚠️ 名單上可能有**沒有 `playerId`** 的人（臨時找來的支援球員）。
 * 他們改不了 —— 伺服器是用 playerId 找人的。讓他們點得下去只會得到一個
 * 看不懂的 404。
 */
function canAnswer(member: AttendanceEntry): boolean {
  return editable.value && Boolean(member.playerId)
}

function toggle(member: AttendanceEntry) {
  if (!canAnswer(member)) return
  error.value = ''
  open.value = open.value === member.playerId ? null : member.playerId
}

async function answer(member: AttendanceEntry, status: SelfReportStatus) {
  if (!props.gameId) return

  saving.value = member.playerId
  error.value = ''
  try {
    const result = await answerAttendance(props.gameId, { playerId: member.playerId, status })
    // 回的是整份名單 —— 這一頁走 CDN 快取，自己手上那份可能已經是舊的
    emit('updated', result.attendance)
    open.value = null
  } catch (err) {
    error.value = ApiError.from(err).message
  } finally {
    saving.value = null
  }
}
</script>

<template>
  <div class="space-y-4">
    <p class="text-fluid-sm text-content-muted">
      目前確定出席
      <strong class="text-fluid-lg font-bold text-brand-600 tabular-nums dark:text-brand-300">
        {{ confirmedCount }}
      </strong>
      人，共 {{ entries.length }} 位隊員回報中。
      <template v-if="editable">點自己的名字就能回報。</template>
    </p>

    <p v-if="error" class="rounded-lg bg-danger/12 px-3 py-2 text-fluid-sm text-danger">
      {{ error }}
    </p>

    <div v-for="group in groups" :key="group.status" class="space-y-2">
      <div class="flex items-center gap-2">
        <UiBaseBadge :tone="group.tone" size="sm">{{ group.label }}</UiBaseBadge>
        <span class="text-xs text-content-muted tabular-nums">{{ group.members.length }} 人</span>
      </div>

      <ul class="flex flex-wrap gap-2">
        <li v-for="member in group.members" :key="member.playerId || member.name">
          <!--
            ── 第二段：選答案 ──────────────────────────────
            展開時整個項目變寬。它在 flex-wrap 的清單裡，所以會自己換行，
            不必另外做一層面板，名字也還留在原來的位置附近。
          -->
          <div
            v-if="open === member.playerId"
            class="rounded-lg border border-brand-600 bg-surface p-2 text-fluid-sm"
          >
            <p class="mb-2 px-1">
              <span v-if="member.number" class="mr-1 text-content-muted tabular-nums">
                #{{ member.number }}
              </span>
              <strong>{{ member.name }}</strong>
              <span class="ml-2 text-content-muted">要改成</span>
            </p>

            <div class="flex flex-wrap gap-1.5">
              <UiBaseButton
                v-for="choice in CHOICES"
                :key="choice"
                size="sm"
                :variant="member.status === choice ? 'primary' : 'secondary'"
                :loading="saving === member.playerId"
                @click="answer(member, choice)"
              >
                {{ ATTENDANCE_LABELS[choice] }}
              </UiBaseButton>
              <UiBaseButton size="sm" variant="ghost" @click="open = null">取消</UiBaseButton>
            </div>
          </div>

          <!-- ── 第一段：點自己的名字 ────────────────────── -->
          <component
            :is="canAnswer(member) ? 'button' : 'span'"
            v-else
            :type="canAnswer(member) ? 'button' : undefined"
            class="block rounded-lg border border-border bg-surface px-3 py-1.5 text-left text-fluid-sm"
            :class="
              canAnswer(member) ? 'min-h-10 transition hover:border-brand-600 cursor-pointer' : ''
            "
            @click="toggle(member)"
          >
            <span v-if="member.number" class="mr-1 text-content-muted tabular-nums">
              #{{ member.number }}
            </span>
            {{ member.name }}
            <span v-if="member.note" class="ml-1 text-xs text-content-muted">
              （{{ member.note }}）
            </span>
          </component>
        </li>
      </ul>
    </div>
  </div>
</template>
