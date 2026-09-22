<script setup lang="ts">
import { POSITION_LABELS, type Hand, type PlayerInput } from '#shared/schemas/player'
import { LOW_CONFIDENCE_THRESHOLD, type ParsedPlayer } from '#shared/schemas/ai'
import { ApiError } from '~/utils/api-error'

/**
 * 用名冊截圖批次新增球員。
 *
 * 球隊的名冊多半是 Excel 或 Google 試算表，逐列手敲進後台既慢又容易看錯行。
 * 上傳一張截圖，系統讀出每一列的球員資料，帶進下方可勾選、可修改的列表，
 * **確認後才建立** —— 與賽程圖辨識是同一套流程。
 *
 * ## 已經在名單裡的人會被標示出來
 * 重複匯入是這個功能最容易踩到的坑：名冊更新了一版，整張再傳一次，
 * 結果全隊都多了一份。這裡用背號與姓名比對現有名單，已存在的預設不勾選。
 *
 * ## 照片與守備位置
 * 名冊截圖裡沒有大頭照，守備位置也常常缺漏或寫得很簡略。匯入後到
 * 「球員名單」逐位補上即可 —— 這一頁的價值是把姓名與背號一次搬進來。
 */
definePageMeta({ layout: 'admin', middleware: 'auth' })

const { parseRoster, loading: aiLoading } = useAiActions()
const { createPlayers, loading: saving } = usePlayerActions()
const { data: existingPlayers, refresh: refreshPlayers } = await usePlayers()

const fileInput = ref<HTMLInputElement | null>(null)
const previewUrl = ref('')
const message = ref('')
const warnings = ref<string[]>([])

interface DraftPlayer extends ParsedPlayer {
  selected: boolean
  /** 名單中已經有同背號或同姓名的人。 */
  duplicate: boolean
}

const drafts = ref<DraftPlayer[]>([])

const selectedCount = computed(() => drafts.value.filter((draft) => draft.selected).length)
const duplicateCount = computed(() => drafts.value.filter((draft) => draft.duplicate).length)

const handOptions: Array<{ value: Hand; label: string }> = [
  { value: 'R', label: '右' },
  { value: 'L', label: '左' },
  { value: 'S', label: '左右開弓' },
]

/** 與現有名單比對：同背號或同姓名就算重複。 */
function isDuplicate(player: ParsedPlayer): boolean {
  const roster = existingPlayers.value ?? []
  return roster.some(
    (existing) =>
      existing.name === player.name || (player.number !== '' && existing.number === player.number),
  )
}

async function handleFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  message.value = ''
  warnings.value = []
  drafts.value = []
  previewUrl.value = URL.createObjectURL(file)

  try {
    const result = await parseRoster(file)

    drafts.value = result.players.map((player) => {
      const duplicate = isDuplicate(player)
      return {
        ...player,
        duplicate,
        // 已經在名單裡的預設不勾，避免整張名冊再傳一次就全隊多一份
        selected: !duplicate,
      }
    })
    warnings.value = result.warnings
    message.value = result.players.length
      ? `讀到 ${result.players.length} 位球員，請核對後匯入。`
      : '沒有讀到任何球員。'
  } catch (err) {
    message.value =
      err instanceof Error && !(err instanceof ApiError) ? err.message : ApiError.from(err).message
  } finally {
    input.value = ''
  }
}

function toPlayerInput(draft: DraftPlayer): PlayerInput {
  return {
    number: draft.number,
    name: draft.name,
    // 名冊上沒寫守位時預設投手，之後在球員名單頁再調整
    positions: draft.positions.length ? draft.positions : ['P'],
    bats: draft.bats,
    throws: draft.throws,
    joinedYear: draft.joinedYear,
    bio: '',
    photoUrl: '',
    status: 'active',
    sortOrder: 0,
  }
}

async function importSelected() {
  const selected = drafts.value.filter((draft) => draft.selected && draft.name.trim())
  if (!selected.length) return

  await createPlayers(selected.map(toPlayerInput))
  await refreshPlayers()
  await navigateTo('/admin/players')
}

function toggleAll(value: boolean) {
  drafts.value = drafts.value.map((draft) => ({ ...draft, selected: value }))
}

onBeforeUnmount(() => {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
})

useHead({ title: '從名冊匯入球員' })
</script>

<template>
  <div>
    <AdminHeader
      title="從名冊匯入球員"
      description="上傳 Excel 或試算表的截圖，自動讀出姓名與背號。"
      back-to="/admin/players"
      back-label="回到球員名單"
    />

    <div class="space-y-6">
      <!-- ══ 上傳 ══════════════════════════════════════════════ -->
      <div class="rounded-xl border border-border bg-surface p-5">
        <div class="flex flex-wrap items-start gap-5">
          <div class="min-w-0 flex-1 space-y-3">
            <div>
              <p class="font-medium">上傳名冊截圖</p>
              <p class="mt-1 text-fluid-sm text-content-muted">
                把 Excel 或 Google 試算表的畫面截圖上傳即可。表頭那一列會自動略過。
                名冊上若有「右投右打」這類寫法會自動拆成投球與打擊兩個欄位。
              </p>
            </div>

            <UiBaseButton :loading="aiLoading" @click="fileInput?.click()">
              {{ aiLoading ? '辨識中…' : '選擇名冊截圖' }}
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
            <p v-if="message" class="text-fluid-sm">{{ message }}</p>

            <ul v-if="warnings.length" class="space-y-1">
              <li v-for="warning in warnings" :key="warning" class="text-fluid-sm text-warning">
                ・{{ warning }}
              </li>
            </ul>
          </div>

          <img
            v-if="previewUrl"
            :src="previewUrl"
            alt="上傳的名冊截圖預覽"
            class="max-h-56 w-full max-w-xs rounded-lg border border-border object-contain sm:w-auto"
          />
        </div>
      </div>

      <!-- ══ 辨識結果 ══════════════════════════════════════════ -->
      <section v-if="drafts.length" aria-labelledby="drafts-heading" class="space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <h2 id="drafts-heading" class="text-fluid-lg font-bold">
            辨識結果
            <span class="ml-2 text-fluid-sm font-medium text-content-muted">
              已勾選 {{ selectedCount }} / {{ drafts.length }} 位
            </span>
          </h2>

          <div class="flex flex-wrap gap-2">
            <UiBaseButton variant="ghost" size="sm" @click="toggleAll(true)">全部勾選</UiBaseButton>
            <UiBaseButton variant="ghost" size="sm" @click="toggleAll(false)"
              >全部取消</UiBaseButton
            >
            <UiBaseButton :loading="saving" :disabled="!selectedCount" @click="importSelected">
              匯入 {{ selectedCount }} 位球員
            </UiBaseButton>
          </div>
        </div>

        <p class="text-fluid-sm text-content-muted">
          辨識結果尚未儲存。大頭照與缺漏的守備位置可以在匯入後到「球員名單」逐位補上。
        </p>

        <p
          v-if="duplicateCount"
          class="rounded-lg bg-warning/15 px-3 py-2 text-fluid-sm text-warning"
        >
          其中 {{ duplicateCount }} 位的姓名或背號已經在名單裡，預設不勾選，避免重複建立。
        </p>

        <ul class="space-y-2">
          <li
            v-for="(draft, index) in drafts"
            :key="index"
            class="rounded-xl border bg-surface p-4"
            :class="
              draft.duplicate
                ? 'border-warning/50'
                : draft.confidence < LOW_CONFIDENCE_THRESHOLD
                  ? 'border-warning/40'
                  : 'border-border'
            "
          >
            <div class="mb-3 flex flex-wrap items-center gap-3">
              <label class="flex items-center gap-2 font-medium">
                <input v-model="draft.selected" type="checkbox" class="size-4" />
                匯入
              </label>

              <UiBaseBadge v-if="draft.duplicate" tone="warning" size="sm"
                >名單中已存在</UiBaseBadge
              >

              <UiBaseBadge
                :tone="draft.confidence < LOW_CONFIDENCE_THRESHOLD ? 'warning' : 'success'"
                size="sm"
              >
                信心 {{ Math.round(draft.confidence * 100) }}%
              </UiBaseBadge>

              <!-- 守備位置在這裡唯讀：名冊多半寫得很簡略，匯入後統一調整比逐列微調快 -->
              <span class="text-fluid-sm text-content-muted">
                守備：
                <template v-if="draft.positions.length">
                  {{ draft.positions.map((p) => POSITION_LABELS[p]).join('／') }}
                </template>
                <template v-else>未讀到（先設為投手）</template>
              </span>

              <span v-if="draft.sourceText" class="truncate text-xs text-content-muted">
                原文：{{ draft.sourceText }}
              </span>
            </div>

            <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <UiBaseInput v-model="draft.number" label="背號" placeholder="例如 07" />
              <UiBaseInput v-model="draft.name" label="姓名" required />
              <UiBaseSelect v-model="draft.throws" label="投球" :options="handOptions" />
              <UiBaseSelect v-model="draft.bats" label="打擊" :options="handOptions" />
              <UiBaseInput
                :model-value="draft.joinedYear ? String(draft.joinedYear) : ''"
                label="加入年份"
                type="number"
                @update:model-value="draft.joinedYear = $event ? Number($event) : null"
              />
            </div>
          </li>
        </ul>

        <div class="flex justify-end">
          <UiBaseButton :loading="saving" :disabled="!selectedCount" @click="importSelected">
            匯入 {{ selectedCount }} 位球員
          </UiBaseButton>
        </div>
      </section>
    </div>
  </div>
</template>
