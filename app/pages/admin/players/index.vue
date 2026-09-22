<script setup lang="ts">
import type { Hand, Player, PlayerForm, PlayerStatus, Position } from '#shared/schemas/player'
import { describeHands, POSITIONS, POSITION_LABELS } from '#shared/schemas/player'

/**
 * 球員名單管理。
 *
 * 列表與表單在同一頁：球隊人數是數十人的量級，表單開在旁邊比跳到另一個
 * 網址再跳回來省事得多，連續新增好幾位隊員時差別特別明顯。
 */
definePageMeta({ layout: 'admin', middleware: 'auth' })

const { data: players, refresh, pending } = await usePlayers()
const { createPlayer, updatePlayer, removePlayer, loading: saving, error } = usePlayerActions()

/** 目前正在編輯的球員；null 代表表單關閉，'new' 代表新增。 */
const editingId = ref<string | null>(null)

/**
 * 選單選項明確標註型別。
 *
 * 不標的話，TypeScript 會把 options 的 value 推導成 `'R' | 'L'` 這種只涵蓋
 * 眼前選項的窄型別，與欄位真正的型別（`Hand`，含左右開弓）對不起來。
 * 投手沒有「左右開弓」這種說法，所以選項只列兩個，但型別要維持 `Hand`。
 */
const throwOptions: Array<{ value: Hand; label: string }> = [
  { value: 'R', label: '右投' },
  { value: 'L', label: '左投' },
]

const batOptions: Array<{ value: Hand; label: string }> = [
  { value: 'R', label: '右打' },
  { value: 'L', label: '左打' },
  { value: 'S', label: '左右開弓' },
]

const statusOptions: Array<{ value: PlayerStatus; label: string }> = [
  { value: 'active', label: '現役' },
  { value: 'inactive', label: '非現役' },
]

/** 至少要有一個守位，沒選時用投手。 */
const DEFAULT_POSITION: Position = 'P'

const emptyForm = (): PlayerForm => ({
  number: '',
  name: '',
  positions: [DEFAULT_POSITION],
  bats: 'R',
  throws: 'R',
  joinedYear: new Date().getFullYear(),
  bio: '',
  photoUrl: '',
  status: 'active',
  sortOrder: 0,
})

const form = ref<PlayerForm>(emptyForm())

function startCreate() {
  editingId.value = 'new'
  form.value = emptyForm()
}

function startEdit(player: Player) {
  editingId.value = player.id
  form.value = {
    number: player.number,
    name: player.name,
    positions: [...player.positions],
    bats: player.bats,
    throws: player.throws,
    joinedYear: player.joinedYear,
    bio: player.bio,
    photoUrl: player.photoUrl,
    status: player.status,
    sortOrder: player.sortOrder,
  }
}

function cancel() {
  editingId.value = null
}

/** 守備位置可複選，用一排可切換的按鈕（比多選下拉好操作）。 */
function togglePosition(position: Position) {
  const current = form.value.positions
  form.value.positions = current.includes(position)
    ? current.filter((item) => item !== position)
    : [...current, position]
}

async function submit() {
  if (!form.value.positions.length) form.value.positions = [DEFAULT_POSITION]

  if (editingId.value === 'new') {
    await createPlayer(form.value)
  } else if (editingId.value) {
    await updatePlayer(editingId.value, form.value)
  }

  editingId.value = null
  await refresh()
}

async function handleDelete(id: string) {
  await removePlayer(id)
  if (editingId.value === id) editingId.value = null
  await refresh()
}

useHead({ title: '球員管理' })
</script>

<template>
  <div>
    <AdminHeader title="球員名單" description="管理隊員資料。前台名單只顯示狀態為「現役」的球員。">
      <template #actions>
        <UiBaseButton variant="secondary" @click="navigateTo('/admin/players/import')">
          📷 從名冊匯入
        </UiBaseButton>
        <UiBaseButton @click="startCreate">＋ 新增球員</UiBaseButton>
      </template>
    </AdminHeader>

    <div class="grid gap-6" :class="editingId ? 'lg:grid-cols-[1fr_24rem]' : ''">
      <!-- ── 列表 ─────────────────────────────────────────────── -->
      <div>
        <UiBaseSpinner v-if="pending" />

        <div
          v-else-if="players?.length"
          class="overflow-x-auto rounded-xl border border-border bg-surface"
        >
          <table class="w-full min-w-max border-collapse text-fluid-sm">
            <thead>
              <tr class="bg-surface-muted text-left">
                <th scope="col" class="w-16 px-4 py-3 text-center font-semibold">背號</th>
                <th scope="col" class="px-4 py-3 font-semibold">姓名</th>
                <th scope="col" class="px-4 py-3 font-semibold">守備</th>
                <th scope="col" class="px-4 py-3 font-semibold">投打</th>
                <th scope="col" class="px-4 py-3 font-semibold">狀態</th>
                <th scope="col" class="px-4 py-3 text-right font-semibold">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="player in players"
                :key="player.id"
                class="border-t border-border"
                :class="editingId === player.id ? 'bg-brand-600/5' : ''"
              >
                <td class="px-4 py-3 text-center font-bold tabular-nums">
                  {{ player.number || '—' }}
                </td>
                <td class="px-4 py-3 font-medium">{{ player.name }}</td>
                <td class="px-4 py-3 text-content-muted">
                  {{ player.positions.map((p) => POSITION_LABELS[p]).join('／') }}
                </td>
                <td class="px-4 py-3 text-content-muted">
                  {{ describeHands(player.throws, player.bats) }}
                </td>
                <td class="px-4 py-3">
                  <UiBaseBadge :tone="player.status === 'active' ? 'success' : 'neutral'" size="sm">
                    {{ player.status === 'active' ? '現役' : '非現役' }}
                  </UiBaseBadge>
                </td>
                <td class="px-4 py-3">
                  <div class="flex justify-end gap-1">
                    <UiBaseButton variant="ghost" size="sm" @click="startEdit(player)"
                      >編輯</UiBaseButton
                    >
                    <AdminDeleteButton :loading="saving" @confirm="handleDelete(player.id)" />
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <UiBaseEmpty
          v-else
          title="還沒有球員資料"
          description="新增第一位隊員開始建立名單。"
          icon="🧢"
        >
          <UiBaseButton @click="startCreate">新增球員</UiBaseButton>
        </UiBaseEmpty>
      </div>

      <!-- ── 表單 ─────────────────────────────────────────────── -->
      <aside
        v-if="editingId"
        class="space-y-4 rounded-xl border border-border bg-surface p-5 lg:sticky lg:top-6 lg:h-fit"
      >
        <h2 class="text-fluid-lg font-bold">
          {{ editingId === 'new' ? '新增球員' : '編輯球員' }}
        </h2>

        <div class="grid grid-cols-2 gap-3">
          <UiBaseInput
            v-model="form.number"
            label="背號"
            placeholder="例如 07"
            :error="error?.fieldErrors.number?.[0]"
          />
          <UiBaseInput
            v-model="form.name"
            label="姓名"
            required
            :error="error?.fieldErrors.name?.[0]"
          />
        </div>

        <div class="space-y-2">
          <span class="text-fluid-sm font-medium">守備位置（可複選）</span>
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="position in POSITIONS"
              :key="position"
              type="button"
              class="min-h-9 rounded-lg border px-2.5 text-xs font-medium transition"
              :class="
                form.positions.includes(position)
                  ? 'border-brand-600 bg-brand-600 text-white'
                  : 'border-border text-content-muted hover:bg-surface-muted'
              "
              :aria-pressed="form.positions.includes(position)"
              @click="togglePosition(position)"
            >
              {{ POSITION_LABELS[position] }}
            </button>
          </div>
          <p v-if="error?.fieldErrors.positions?.[0]" class="text-xs text-danger">
            {{ error.fieldErrors.positions[0] }}
          </p>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <UiBaseSelect v-model="form.throws" label="投球慣用手" :options="throwOptions" />
          <UiBaseSelect v-model="form.bats" label="打擊慣用手" :options="batOptions" />
        </div>

        <div class="grid grid-cols-2 gap-3">
          <UiBaseInput
            :model-value="form.joinedYear ? String(form.joinedYear) : ''"
            label="加入年份"
            type="number"
            @update:model-value="form.joinedYear = $event ? Number($event) : null"
          />
          <UiBaseSelect
            v-model="form.status"
            label="狀態"
            :options="statusOptions"
            hint="退隊請設為非現役"
          />
        </div>

        <UiBaseTextarea v-model="form.bio" label="簡介" :rows="3" :maxlength="500" />

        <AdminImageField
          v-model="form.photoUrl"
          label="球員照片"
          folder="players"
          hint="建議使用直式照片，會自動裁切成 4:5。"
        />

        <div class="flex gap-2 border-t border-border pt-4">
          <UiBaseButton :loading="saving" @click="submit">
            {{ editingId === 'new' ? '新增' : '儲存' }}
          </UiBaseButton>
          <UiBaseButton variant="ghost" @click="cancel">取消</UiBaseButton>
        </div>
      </aside>
    </div>
  </div>
</template>
