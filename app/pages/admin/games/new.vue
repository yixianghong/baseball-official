<script setup lang="ts">
import type { GameInput, HomeAway } from '#shared/schemas/game'
import { emptyScoreboard, isGoogleMapsUrl } from '#shared/schemas/game'
import { LOW_CONFIDENCE_THRESHOLD, type ParsedMatch } from '#shared/schemas/ai'
import { teamNameCandidates } from '#shared/schemas/settings'
import { TAIWAN_CITIES, type TaiwanCity } from '#shared/schemas/weather'
import { ApiError } from '~/utils/api-error'
import { formatGameDate } from '~/utils/format'

/**
 * 新增比賽 —— 兩種方式。
 *
 * ## 用賽程圖辨識（預設）
 * 球隊的賽程公告幾乎都是圖片，逐格手敲既慢又容易看錯行。上傳圖片並提供
 * 我方隊名，Gemini 會挑出圖中所有屬於我隊的場次。
 *
 * **辨識結果一律進到下方的可編輯列表**，勾選要匯入的、改好欄位，
 * 按下「建立」才真正寫入資料庫。信心值偏低的那幾列會被標示出來。
 *
 * ## 手動新增
 * 只有一場、或圖片辨識不出來時使用。兩種方式最後呼叫的是同一組端點。
 */
definePageMeta({ layout: 'admin', middleware: 'auth' })

const route = useRoute()
const { data: settings } = await useSiteSettings()
const { parseSchedule, loading: aiLoading } = useAiActions()
const { createGame, createGames, loading: saving } = useGameActions()

/** 我方隊名的各種寫法，來自後台的網站設定。 */
const teamNames = computed(() => (settings.value ? teamNameCandidates(settings.value) : []))

const mode = ref<'ai' | 'manual'>(route.query.mode === 'manual' ? 'manual' : 'ai')

const homeAwayOptions: Array<{ value: HomeAway; label: string }> = [
  { value: 'home', label: '主場（後攻）' },
  { value: 'away', label: '客場（先攻）' },
]

// ── AI 辨識 ─────────────────────────────────────────────────────
const fileInput = ref<HTMLInputElement | null>(null)
const previewUrl = ref('')
const aiMessage = ref('')
const aiWarnings = ref<string[]>([])

/** 辨識結果，每一列可勾選與編輯。 */
interface DraftMatch extends ParsedMatch {
  selected: boolean
}
const drafts = ref<DraftMatch[]>([])

const selectedCount = computed(() => drafts.value.filter((draft) => draft.selected).length)

async function handleFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  aiMessage.value = ''
  aiWarnings.value = []
  drafts.value = []
  previewUrl.value = URL.createObjectURL(file)

  if (teamNames.value.length === 0) {
    aiMessage.value = '請先到「網站設定」填寫球隊名稱，辨識時需要它來判斷哪幾場是我隊的比賽。'
    input.value = ''
    return
  }

  try {
    const result = await parseSchedule(file, teamNames.value, new Date().getFullYear())

    drafts.value = result.matches.map((match) => ({
      ...match,
      // 缺日期或對手的那幾列預設不勾選，避免使用者一路按下去就匯入了半筆資料
      selected: Boolean(match.date && match.opponent),
    }))
    aiWarnings.value = result.warnings
    aiMessage.value = result.matches.length
      ? `辨識出 ${result.matches.length} 場我隊的比賽，請核對後匯入。`
      : '沒有辨識到我隊的場次。'
  } catch (err) {
    aiMessage.value =
      err instanceof Error && !(err instanceof ApiError) ? err.message : ApiError.from(err).message
  } finally {
    input.value = ''
  }
}

function toDraftInput(draft: DraftMatch): GameInput {
  return {
    date: draft.date,
    time: draft.time || '09:00',
    opponent: draft.opponent,
    venue: draft.venue,
    league: draft.league,
    homeAway: draft.homeAway ?? 'home',
    status: 'scheduled',
    note: '',
    coverImageUrl: '',
    attendance: [],
    lineup: [],
    pitchers: [],
    scoreboard: emptyScoreboard(0),
    result: null,
  }
}

async function importSelected() {
  const selected = drafts.value.filter((draft) => draft.selected && draft.date && draft.opponent)
  if (!selected.length) return

  const created = await createGames(selected.map(toDraftInput))
  await navigateTo(created.length === 1 ? `/admin/games/${created[0]!.id}` : '/admin/games')
}

// ── 手動新增 ────────────────────────────────────────────────────
/*
 * 主場縣市帶進來當預設。`watchEffect` 而不是初始化時指定：網站設定是
 * 非同步載入的，表單建立的當下還沒有值。只在使用者還沒自己選過時才帶，
 * 否則設定一載完就會把他剛選的客場縣市蓋掉。
 */
const cityTouched = ref(false)
watchEffect(() => {
  if (cityTouched.value || form.city) return
  form.city = settings.value?.homeCity ?? ''
})

/** 與編輯頁相同的即時驗證：真正的防線在 BFF，這裡是為了當下就講。 */
const mapUrlError = computed(() =>
  form.mapUrl && !isGoogleMapsUrl(form.mapUrl)
    ? '請貼 Google 地圖的連結（maps.app.goo.gl 或 google.com/maps）'
    : '',
)

const form = reactive({
  date: '',
  time: '09:00',
  opponent: '',
  venue: '',
  mapUrl: '',
  city: '' as TaiwanCity | '',
  league: '',
  homeAway: 'home' as HomeAway,
  note: '',
})

async function submitManual() {
  const created = await createGame({
    ...form,
    status: 'scheduled',
    coverImageUrl: '',
    attendance: [],
    lineup: [],
    pitchers: [],
    scoreboard: emptyScoreboard(0),
    result: null,
  })
  await navigateTo(`/admin/games/${created.id}`)
}

onBeforeUnmount(() => {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
})

useHead({ title: '新增比賽' })
</script>

<template>
  <div>
    <AdminHeader
      title="新增比賽"
      description="上傳官方賽程公告圖自動辨識，或手動填寫。"
      back-to="/admin/games"
      back-label="回到賽程列表"
    />

    <div class="mb-6 flex gap-2" role="group" aria-label="新增方式">
      <button
        v-for="option in [
          { value: 'ai', label: '📷 用賽程圖辨識' },
          { value: 'manual', label: '✏️ 手動填寫' },
        ]"
        :key="option.value"
        type="button"
        class="min-h-11 rounded-lg border px-5 font-medium transition"
        :class="
          mode === option.value
            ? 'border-brand-600 bg-brand-600 text-white'
            : 'border-border text-content-muted hover:bg-surface'
        "
        :aria-pressed="mode === option.value"
        @click="mode = option.value as typeof mode"
      >
        {{ option.label }}
      </button>
    </div>

    <!-- ══ AI 辨識 ═══════════════════════════════════════════════ -->
    <div v-if="mode === 'ai'" class="space-y-6">
      <div class="rounded-xl border border-border bg-surface p-5">
        <div class="flex flex-wrap items-start gap-5">
          <div class="min-w-0 flex-1 space-y-3">
            <div>
              <p class="font-medium">上傳賽程公告圖</p>
              <p class="mt-1 text-fluid-sm text-content-muted">
                系統會從圖中挑出所有含我隊的場次，其他隊伍之間的對戰會自動忽略。
              </p>
            </div>

            <p class="text-fluid-sm">
              <span class="text-content-muted">比對的隊名：</span>
              <template v-if="teamNames.length">
                <UiBaseBadge
                  v-for="name in teamNames"
                  :key="name"
                  tone="brand"
                  size="sm"
                  class="mr-1"
                >
                  {{ name }}
                </UiBaseBadge>
              </template>
              <NuxtLink v-else to="/admin/settings" class="text-warning underline">
                尚未設定球隊名稱，請先前往網站設定
              </NuxtLink>
            </p>

            <UiBaseButton :loading="aiLoading" @click="fileInput?.click()">
              {{ aiLoading ? '辨識中…' : '選擇賽程圖' }}
            </UiBaseButton>
            <input
              ref="fileInput"
              type="file"
              accept="image/*"
              class="hidden"
              @change="handleFile"
            />

            <p v-if="aiLoading" class="text-fluid-sm text-content-muted">
              辨識通常需要 10～30 秒，請不要關閉頁面。
            </p>
            <p v-if="aiMessage" class="text-fluid-sm">{{ aiMessage }}</p>

            <ul v-if="aiWarnings.length" class="space-y-1">
              <li v-for="warning in aiWarnings" :key="warning" class="text-fluid-sm text-warning">
                ・{{ warning }}
              </li>
            </ul>
          </div>

          <img
            v-if="previewUrl"
            :src="previewUrl"
            alt="上傳的賽程圖預覽"
            class="max-h-56 w-full max-w-xs rounded-lg border border-border object-contain sm:w-auto"
          />
        </div>
      </div>

      <!-- 辨識結果：可勾選、可修改，確認後才建立 -->
      <section v-if="drafts.length" aria-labelledby="drafts-heading" class="space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <h2 id="drafts-heading" class="text-fluid-lg font-bold">
            辨識結果
            <span class="ml-2 text-fluid-sm font-medium text-content-muted">
              已勾選 {{ selectedCount }} / {{ drafts.length }} 場
            </span>
          </h2>
          <UiBaseButton :loading="saving" :disabled="!selectedCount" @click="importSelected">
            建立 {{ selectedCount }} 場比賽
          </UiBaseButton>
        </div>

        <p class="text-fluid-sm text-content-muted">
          辨識結果尚未儲存。請核對每一列的日期與對手，修改後再按上方按鈕建立。
        </p>

        <ul class="space-y-3">
          <li
            v-for="(draft, index) in drafts"
            :key="index"
            class="rounded-xl border bg-surface p-4"
            :class="
              draft.confidence < LOW_CONFIDENCE_THRESHOLD ? 'border-warning/50' : 'border-border'
            "
          >
            <div class="mb-3 flex flex-wrap items-center gap-3">
              <label class="flex items-center gap-2 font-medium">
                <input v-model="draft.selected" type="checkbox" class="size-4" />
                匯入這一場
              </label>

              <UiBaseBadge
                :tone="draft.confidence < LOW_CONFIDENCE_THRESHOLD ? 'warning' : 'success'"
                size="sm"
              >
                信心 {{ Math.round(draft.confidence * 100) }}%
              </UiBaseBadge>

              <span v-if="draft.date" class="text-fluid-sm text-content-muted">
                {{ formatGameDate(draft.date) }}
              </span>

              <span v-if="draft.sourceText" class="truncate text-xs text-content-muted">
                原文：{{ draft.sourceText }}
              </span>
            </div>

            <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <UiBaseInput v-model="draft.date" label="日期" type="date" />
              <UiBaseInput v-model="draft.time" label="時間" type="time" />
              <UiBaseInput v-model="draft.opponent" label="對手" />
              <UiBaseInput v-model="draft.venue" label="場地" />
              <UiBaseSelect
                :model-value="draft.homeAway ?? 'home'"
                label="主客場"
                :options="homeAwayOptions"
                @update:model-value="draft.homeAway = $event"
              />
            </div>
          </li>
        </ul>
      </section>
    </div>

    <!-- ══ 手動填寫 ═════════════════════════════════════════════ -->
    <form
      v-else
      class="max-w-2xl space-y-4 rounded-xl border border-border bg-surface p-6"
      @submit.prevent="submitManual"
    >
      <div class="grid gap-4 sm:grid-cols-2">
        <UiBaseInput v-model="form.date" label="日期" type="date" required />
        <UiBaseInput v-model="form.time" label="時間" type="time" required />
      </div>

      <UiBaseInput v-model="form.opponent" label="對戰球隊" required />

      <div class="grid gap-4 sm:grid-cols-2">
        <UiBaseInput v-model="form.venue" label="場地" placeholder="例如：市立棒球場" />
        <UiBaseInput v-model="form.league" label="賽事名稱" placeholder="例如：春季聯賽" />
      </div>

      <!-- 批次建立那一側刻意不放這欄：賽程公告圖上本來就沒有地圖連結，
           而五欄的表格再塞一個長網址輸入框會擠爆 -->
      <UiBaseSelect
        v-model="form.city"
        label="場地所在縣市"
        placeholder="— 不顯示天氣 —"
        :options="TAIWAN_CITIES.map((city) => ({ value: city, label: city }))"
        hint="用來查當天天氣。預設帶入網站設定的主場縣市，客場記得改。"
        @update:model-value="cityTouched = true"
      />

      <UiBaseInput
        v-model="form.mapUrl"
        label="Google 地圖連結"
        placeholder="https://maps.app.goo.gl/..."
        hint="選填。留空的話前台會用場地名稱自動組搜尋連結。"
        :error="mapUrlError"
      />

      <UiBaseSelect v-model="form.homeAway" label="主客場" :options="homeAwayOptions" />

      <UiBaseTextarea v-model="form.note" label="備註" :rows="3" :maxlength="500" />

      <div class="flex gap-2">
        <UiBaseButton type="submit" :loading="saving">建立比賽</UiBaseButton>
        <UiBaseButton variant="ghost" @click="navigateTo('/admin/games')">取消</UiBaseButton>
      </div>
    </form>
  </div>
</template>
