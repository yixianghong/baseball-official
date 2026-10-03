<script setup lang="ts">
import { HALF_LABELS, matchupOrder, type GameHalf } from '#shared/schemas/game'
import {
  duplicateSlots,
  halfInningSlots,
  planAssignments,
  rejectionOf,
  REJECTION_LABELS,
  type FileRejection,
  type HalfInningSlot,
} from '~/utils/clip-import'
import { getUploadStore, isReadable, type PendingUpload } from '~/utils/upload-store'
import { formatBytes } from '~/utils/image'
import { formatGameDateLong } from '~/utils/format'

/**
 * 從這台裝置挑現成的影片檔上傳（`/admin/upload/[id]`）。
 *
 * ## 這一頁是為了外接相機而存在的
 * 錄影頁（`/admin/record/[id]`）用的是手機自己的鏡頭 —— 架在腳架上、一個
 * 半局一段、錄完自動上傳。但球隊用的是 Insta360 GO Ultra 這類外接相機：
 * 畫質與穩定度都不是手機比得上的，代價是**影片先落在相機裡**，中間多了
 * 「匯出到手機或電腦」這一步。
 *
 * 到那一步為止都沒有這個專案的事。**這一頁接的是最後一段**：把匯出好的
 * 檔案挑進來、對上半局、用和錄影頁完全相同的路徑傳到 YouTube 並登錄。
 *
 * ## ⚠️ 網頁沒辦法直接讀相機裡的檔案
 * 相機是 Wi-Fi／USB 裝置，瀏覽器沒有任何 API 連得進去（`<input type="file">`
 * 只看得到作業系統的「檔案／照片」）。所以畫面上要把三段流程寫出來 ——
 * 不寫的話，使用者會在這一頁上找「連線到相機」的按鈕，找不到就以為壞了。
 *
 * ## 為什麼是獨立頁面，不是後台比賽頁裡的一個區塊
 * 那一頁是**自動儲存**的表單，而且有五個分頁。上傳一個 4 GB 的檔案要幾十
 * 分鐘，中間切個分頁、或是自動儲存跳出錯誤，都不該有機會把它打斷。
 * 這一頁除了上傳什麼都不做，離開時也會攔一下。
 *
 * ## 半局的指派是預填的，不是問出來的
 * 一次挑十四個檔案，逐個選局數就是十四次下拉選單。檔案本來就是照順序拍的，
 * 所以**依拍攝時間排好、依序填進還沒有影片的半局**（`planAssignments()`），
 * 使用者只在對不上時才動手改。
 */
definePageMeta({ layout: 'admin', middleware: 'auth' })

const route = useRoute()
const gameId = computed(() => String(route.params.id))

const { data: game, error: loadError, refresh } = await useGame(gameId)
const { data: settings } = await useSiteSettings()

const teamName = computed(() => settings.value?.teamName ?? '我隊')

const uploads = useClipUpload({
  gameId: () => gameId.value,
  title: (n, h) =>
    `${game.value?.date ?? ''} ${teamName.value} vs ${game.value?.opponent ?? ''} 第${n}局${HALF_LABELS[h]}`,
})

/** 這一場預計幾局。乙組是七局，但延長賽會多打 —— 以計分板的實際局數為準。 */
const totalInnings = computed(() => Math.max(game.value?.scoreboard.innings.length ?? 7, 7))
const slots = computed(() => halfInningSlots(totalInnings.value))

const slotKey = (slot: HalfInningSlot) => `${slot.inning}-${slot.half}`

/** 已經有影片的半局。重複指派時要警告使用者「這一格會被覆蓋」。 */
const uploadedKeys = computed(() => new Set((game.value?.clips ?? []).map((clip) => slotKey(clip))))

/**
 * 挑好、但**還沒排進佇列**的一個檔案。
 *
 * ⚠️ 排進佇列之後就不再是這裡的資料了 —— 那一刻它屬於共用佇列
 * （`useClipUpload`），畫面直接讀佇列。頁面自己留一份的話，站內換頁再回來
 * 時上傳明明還在跑、清單卻是空的（實際踩到），因為頁面的狀態跟著元件重建了。
 */
interface Row {
  key: string
  file: File
  /**
   * 指到哪個半局，`${inning}-${half}`。
   *
   * 存成一個字串而不是兩個欄位，是為了**畫面上只出現一個下拉選單**：
   * 十四個檔案 × 兩個選單等於二十八次操作，而「第 3 局下半」本來就是
   * 一個選擇，不是兩個。
   */
  slot: string
}

/** `${inning}-${half}` 拆回來。選單的值一定是從 `slots` 來的，所以不會拆失敗。 */
function parseSlot(key: string): HalfInningSlot {
  const [inning, half] = key.split('-')
  return { inning: Number(inning), half: half as GameHalf }
}

/**
 * 已經排進佇列的（含換頁之前就開始傳的）。
 *
 * 讀的是共用佇列而不是頁面自己的陣列 —— 這一頁可以隨時離開再回來。
 */
const queued = computed(() => uploads.queue.value)
const queuedKeys = computed(() => new Set(queued.value.map((item) => slotKey(item))))

const rows = ref<Row[]>([])
const rejected = ref<Array<{ name: string; reason: FileRejection }>>([])
const fileInput = ref<HTMLInputElement | null>(null)

let rowSeq = 0

/**
 * 挑了檔案。
 *
 * ⚠️ **要用 append 而不是取代。** iOS 的「檔案」App 一次只挑得到一個資料夾，
 * 而相機匯出的檔案常常散在「照片」與「檔案」兩邊 —— 第二次挑檔案就把第一次
 * 的清空，會讓人以為自己弄丟了什麼。
 */
function onFilesPicked(event: Event) {
  const input = event.target as HTMLInputElement
  const picked = Array.from(input.files ?? [])

  const accepted: File[] = []
  for (const file of picked) {
    const reason = rejectionOf(file)
    if (reason) rejected.value = [...rejected.value, { name: file.name, reason }]
    else accepted.push(file)
  }

  // 已經佔掉的半局（網站上已有的 + 佇列裡的 + 這次已經排進去的）都算「有影片」，
  // 新挑的檔案就會接在後面，而不是覆蓋前面幾筆
  const taken = new Set([
    ...uploadedKeys.value,
    ...queuedKeys.value,
    ...rows.value.map((r) => r.slot),
  ])

  const plan = planAssignments({ files: accepted, slots: slots.value, taken })
  rows.value = [
    ...rows.value,
    ...plan.map(({ file, slot }) => ({
      key: `row-${(rowSeq += 1)}`,
      file,
      slot: slotKey(slot ?? { inning: 1, half: 'top' }),
    })),
  ]

  // 清空才選得了同一個檔案第二次（change 事件比對的是 value）
  input.value = ''
}

function removeRow(key: string) {
  rows.value = rows.value.filter((row) => row.key !== key)
}

function clearAll() {
  rows.value = []
  rejected.value = []
}

const duplicates = computed(() =>
  duplicateSlots([
    ...queued.value.map((item) => ({ slot: { inning: item.inning, half: item.half } })),
    ...rows.value.map((row) => ({ slot: parseSlot(row.slot) })),
  ]),
)

/** 會蓋掉網站上已經有的那一段（重錄是既有行為，但要先講）。 */
const overwrites = computed(() => rows.value.filter((row) => uploadedKeys.value.has(row.slot)))

/**
 * 選單裡把「已經有影片」標出來。
 *
 * 選到那一格不會被擋（重錄本來就是允許的），但使用者要看得到自己正在
 * 覆蓋什麼 —— 傳上去之後才發現蓋掉別人傳的那一段，已經來不及了。
 */
const slotOptions = computed(() =>
  slots.value.map((slot) => ({
    value: slotKey(slot),
    label: `第 ${slot.inning} 局${HALF_LABELS[slot.half]}${uploadedKeys.value.has(slotKey(slot)) ? '（已有影片）' : ''}`,
  })),
)

function startAll() {
  for (const row of rows.value) {
    const { inning, half } = parseSlot(row.slot)
    uploads.enqueue({
      inning,
      half,
      blob: row.file,
      label: row.file.name,
      // 檔案在裝置上，所以斷點寫得進 IndexedDB —— 分頁關掉也接得回來
      persist: true,
    })
  }
  // 交給佇列之後這一頁就不再自己留一份，畫面改從佇列讀
  rows.value = []
}

/* ── 還沒傳完的（上一次打開這一頁留下的）──────────────────────── */

/**
 * 重新載入之後把斷點撿回來。
 *
 * **刻意不自動開始傳。** 和錄影頁救回片段是同一條原則：使用者回到這一頁時
 * 未必還想傳（可能是換了網路、或發現挑錯檔案），而且 YouTube 一天的上傳
 * 支數有限，自動跑掉幾支是拿不回來的。
 */
const unfinished = ref<PendingUpload[]>([])
const unreadable = ref<Set<string>>(new Set())
const store = getUploadStore()

async function loadUnfinished() {
  const live = new Set(uploads.queue.value.map((item) => item.id))
  const records = await store.list(gameId.value).catch(() => [])
  unfinished.value = records.filter((record) => !live.has(record.id))

  /*
   * ⚠️ 存進 IndexedDB 的 `File` 只是磁碟上那個檔案的參照 —— 檔案被移走、
   * 刪掉，或 iOS 回收了照片庫裡的那一份之後，物件還在、大小還讀得到，
   * **要真的去讀內容才會拋錯**。先試讀一個位元組，把它變成一句看得懂的話。
   */
  const checked = await Promise.all(
    unfinished.value.map(async (record) => [record.id, await isReadable(record.file)] as const),
  )
  unreadable.value = new Set(checked.filter(([, ok]) => !ok).map(([id]) => id))
}

onMounted(() => void loadUnfinished())

function resumeOne(record: PendingUpload) {
  uploads.enqueue({
    id: record.id,
    inning: record.inning,
    half: record.half,
    blob: record.file,
    label: record.fileName,
    title: record.title,
    persist: true,
    resume: { location: record.location, offset: record.offset },
  })
  unfinished.value = unfinished.value.filter((other) => other.id !== record.id)
}

function resumeAll() {
  for (const record of unfinished.value.filter((item) => !unreadable.value.has(item.id))) {
    resumeOne(record)
  }
}

async function discardUnfinished(id: string) {
  unfinished.value = unfinished.value.filter((record) => record.id !== id)
  await store.remove(id).catch(() => {})
}

/*
 * 傳完就把比賽資料抓回來。
 *
 * 不抓的話，「已經有影片的半局」還是進到這一頁那一刻的舊資訊 —— 接著再挑
 * 一批檔案時，剛剛傳好的那幾格會被當成缺口，預設指派就全部錯開。
 */
watch(
  () => uploads.pending.value,
  (now, before) => {
    if (before && !now) void refresh()
  },
)

/*
 * 這裡**刻意沒有**離開頁面的攔截。
 *
 * 佇列活在 plugin 上（見 `useClipUpload`），站內換頁不會中斷上傳 ——
 * 後台版面右下角會顯示「上傳中」，回到這一頁就看得到完整進度。
 * 重新整理與關閉分頁那一種攔在 plugin 裡，因為使用者很可能是在別的頁上按的。
 */

useHead({ title: () => (game.value ? `上傳影片檔：vs ${game.value.opponent}` : '上傳影片檔') })
</script>

<template>
  <div>
    <AdminHeader
      title="上傳影片檔"
      description="把相機拍好、已經匯出到這台裝置的影片，一個半局一個檔案傳上 YouTube。"
      :back-to="`/admin/games/${gameId}?tab=video`"
      back-label="回到這場比賽"
    />

    <UiBaseError v-if="loadError" :error="loadError" title="載入這場比賽失敗" />

    <template v-else-if="game">
      <p class="mb-4 text-fluid-sm text-content-muted">
        {{ formatGameDateLong(game.date) }}．{{
          matchupOrder(game.homeAway, teamName, game.opponent).join(' vs ')
        }}
      </p>

      <!--
        ⚠️ 這段流程說明不能省。
        瀏覽器連不進相機，而畫面上看起來就只是一顆「選擇檔案」——
        不寫出來的話，使用者會在這一頁找「連線到 Insta360」的按鈕。
      -->
      <section class="surface-card mb-6 space-y-2 p-4 text-fluid-sm">
        <h2 class="font-bold">步驟</h2>
        <ol class="list-decimal space-y-1 pl-5 text-content-muted">
          <li>用相機的 App（Insta360 等）把每個半局的影片匯出到這台手機或電腦。</li>
          <li>按下面的「選擇影片檔」，可以一次選多個。</li>
          <li>確認每個檔案對到哪一個半局，再按「開始上傳」。</li>
        </ol>
        <p class="text-content-muted">
          網頁沒辦法直接讀相機裡的檔案（瀏覽器沒有這種能力），所以第 1 步一定要先做。 上傳完的影片在
          YouTube 上是<strong>私人</strong>的，要到 YouTube Studio 改成公開，前台才會顯示。
        </p>
      </section>

      <!--
        上一次沒傳完的。
        ⚠️ 這一段必須在挑檔案的按鈕**上面** —— 使用者回到這一頁的第一個動作
        會是「再挑一次檔案」，而那正是這個清單要替他省下的事。
      -->
      <section
        v-if="unfinished.length"
        class="mb-4 rounded-xl border border-warning/40 bg-warning/10 p-4"
      >
        <div class="mb-2 flex flex-wrap items-center justify-between gap-3">
          <h2 class="text-fluid-sm font-semibold text-warning">
            上次有 {{ unfinished.length }} 個檔案沒傳完
          </h2>
          <UiBaseButton
            v-if="unfinished.length > unreadable.size"
            size="sm"
            variant="secondary"
            @click="resumeAll"
          >
            全部接著傳
          </UiBaseButton>
        </div>

        <p class="mb-3 text-fluid-sm text-content-muted">從上次斷掉的地方接著傳，不必從頭來。</p>

        <ul class="space-y-2">
          <li
            v-for="record in unfinished"
            :key="record.id"
            class="flex flex-wrap items-center gap-3 rounded-lg bg-surface px-3 py-2 text-fluid-sm"
          >
            <div class="min-w-0 flex-1">
              <p class="truncate font-medium">{{ record.fileName }}</p>
              <p class="text-xs text-content-muted">
                第 {{ record.inning }} 局{{ HALF_LABELS[record.half] }}．已傳
                {{ Math.round((record.offset / Math.max(record.file.size, 1)) * 100) }}%（{{
                  formatBytes(record.offset)
                }}
                / {{ formatBytes(record.file.size) }}）
              </p>
            </div>

            <!--
              ⚠️ 檔案讀不到了要明講。存的是磁碟上那個檔案的參照，
              使用者把它移走或刪掉之後，這一筆就只剩「請重新挑」這條路。
            -->
            <p v-if="unreadable.has(record.id)" class="text-xs text-danger">
              找不到這個檔案了（可能已被移動或刪除），請重新挑一次
            </p>
            <UiBaseButton v-else size="sm" variant="secondary" @click="resumeOne(record)">
              接著傳
            </UiBaseButton>

            <UiBaseButton size="sm" variant="ghost" @click="discardUnfinished(record.id)">
              丟棄
            </UiBaseButton>
          </li>
        </ul>
      </section>

      <div class="mb-4 flex flex-wrap items-center gap-3">
        <!--
          `capture` 刻意不設 —— 設了的話 iOS 會直接開相機錄影，
          而這一頁的前提正是「影片已經拍好了」。
        -->
        <input
          ref="fileInput"
          type="file"
          accept="video/*,.mp4,.mov,.insv"
          multiple
          class="hidden"
          @change="onFilesPicked"
        />
        <UiBaseButton variant="secondary" @click="fileInput?.click()">選擇影片檔</UiBaseButton>

        <UiBaseButton :disabled="!rows.length || uploads.limitReached.value" @click="startAll">
          開始上傳{{ rows.length ? `（${rows.length} 個）` : '' }}
        </UiBaseButton>

        <UiBaseButton v-if="rows.length" variant="ghost" size="sm" @click="clearAll">
          清除未上傳的
        </UiBaseButton>
      </div>

      <!-- 擋掉的檔案要逐個列出來。靜靜地少傳一個，是最難發現的失敗。 -->
      <ul v-if="rejected.length" class="mb-4 space-y-1">
        <li
          v-for="(item, index) in rejected"
          :key="`${item.name}-${index}`"
          class="rounded-lg bg-warning/15 px-3 py-2 text-fluid-sm text-warning"
        >
          已跳過「{{ item.name }}」：{{ REJECTION_LABELS[item.reason] }}
        </li>
      </ul>

      <p
        v-if="duplicates.size"
        class="mb-4 rounded-lg bg-danger/15 px-3 py-2 text-fluid-sm text-danger"
      >
        有兩個以上的檔案指到同一個半局。片段以「第幾局的哪半局」為鍵，
        後傳的會覆蓋先傳的，兩支影片都還是會留在 YouTube 上。
      </p>

      <p
        v-if="overwrites.length"
        class="mb-4 rounded-lg bg-warning/15 px-3 py-2 text-fluid-sm text-warning"
      >
        有 {{ overwrites.length }} 個檔案指到網站上已經有影片的半局，傳上去會取代原本那一段。
      </p>

      <p
        v-if="uploads.limitReached.value"
        class="mb-4 rounded-lg bg-warning/15 px-3 py-2 text-fluid-sm text-warning"
      >
        已達 YouTube 今日的上傳數量上限。檔案都還在，24 小時後再回到這一頁重新挑一次。
      </p>

      <UiBaseEmpty
        v-if="!rows.length && !queued.length"
        title="還沒有挑檔案"
        description="按「選擇影片檔」，從這台裝置的「照片」或「檔案」裡挑出這一場的影片。"
      />

      <ul v-else class="space-y-2">
        <!--
          ── 已經排進佇列的 ──────────────────────────────────
          資料來自共用佇列，所以離開這一頁再回來，正在傳的那幾筆還在。
        -->
        <li
          v-for="item in queued"
          :key="item.id"
          class="rounded-xl border border-border bg-surface px-4 py-3 text-fluid-sm"
        >
          <div class="flex flex-wrap items-center gap-3">
            <div class="min-w-0 flex-1">
              <p class="truncate font-medium">{{ item.label }}</p>
              <p class="text-xs text-content-muted">{{ formatBytes(item.bytes) }}</p>
            </div>

            <span class="font-bold">第 {{ item.inning }} 局{{ HALF_LABELS[item.half] }}</span>

            <template v-if="item.state === 'done'">
              <UiBaseBadge tone="success" size="sm">已上傳</UiBaseBadge>
              <a
                :href="`https://studio.youtube.com/video/${item.videoId}/edit`"
                target="_blank"
                rel="noopener noreferrer"
                class="text-content-muted underline underline-offset-4 hover:text-brand-600"
              >
                在 YouTube Studio 開啟
              </a>
            </template>

            <template v-else-if="item.state === 'failed'">
              <UiBaseBadge tone="danger" size="sm">失敗</UiBaseBadge>
              <UiBaseButton variant="secondary" size="sm" @click="uploads.retry(item.id)">
                重試
              </UiBaseButton>
              <UiBaseButton variant="ghost" size="sm" @click="uploads.discard(item.id)">
                移除
              </UiBaseButton>
            </template>

            <template v-else-if="item.state === 'uploading'">
              <!--
                進度條寬度是執行期算出來的，所以用 inline style ——
                Tailwind 掃不到 `w-[${n}%]` 這種拼出來的 class。
              -->
              <div class="flex min-w-32 flex-1 items-center gap-2">
                <div class="h-2 flex-1 overflow-hidden rounded-full bg-surface-muted">
                  <div
                    class="h-full bg-brand-600 transition-[width]"
                    :style="{ width: `${item.progress}%` }"
                  />
                </div>
                <span class="tabular-nums">{{ item.progress }}%</span>
              </div>
            </template>

            <UiBaseBadge v-else tone="neutral" size="sm">排隊中</UiBaseBadge>
          </div>

          <p v-if="item.error" class="mt-1.5 text-xs text-danger">{{ item.error }}</p>
        </li>

        <!-- ── 挑好但還沒開始傳的：半局還改得動 ───────────────── -->
        <li
          v-for="row in rows"
          :key="row.key"
          class="rounded-xl border border-border bg-surface px-4 py-3 text-fluid-sm"
          :class="duplicates.has(row.slot) ? 'border-danger' : ''"
        >
          <div class="flex flex-wrap items-center gap-3">
            <div class="min-w-0 flex-1">
              <p class="truncate font-medium">{{ row.file.name }}</p>
              <p class="text-xs text-content-muted">{{ formatBytes(row.file.size) }}</p>
            </div>

            <!--
              每一列都把「半局」這個字印出來只是噪音，但拿掉 `<label>`
              就等於拿掉無障礙的名稱。所以留著它、只在視覺上隱藏。
            -->
            <UiBaseSelect
              v-model="row.slot"
              :label="`「${row.file.name}」是哪個半局`"
              class="w-44 [&>label]:sr-only"
              :options="slotOptions"
            />
            <UiBaseButton variant="ghost" size="sm" @click="removeRow(row.key)">移除</UiBaseButton>
          </div>
        </li>
      </ul>

      <p v-if="queued.length" class="mt-4 text-fluid-sm text-content-muted">
        一次傳一個檔案。上傳中請不要關閉這個分頁 —— 中斷的話檔案還在，回到這一頁重新挑一次就能再傳。
      </p>
    </template>
  </div>
</template>
