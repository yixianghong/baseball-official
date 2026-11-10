<script setup lang="ts">
import type { SiteSettingsForm } from '#shared/schemas/settings'
import { teamNameCandidates } from '#shared/schemas/settings'
import { TAIWAN_CITIES } from '#shared/schemas/weather'

/**
 * 網站設定。
 *
 * 這一頁的值會出現在全站每一個角落 —— 標題列、頁尾、首頁主視覺。
 * 改隊名不需要重新部署。
 *
 * ## 隊名的另一個用途
 * 「其他寫法」欄位會一起送給 Gemini，用來從賽程公告圖中認出哪幾場是我隊的
 * 比賽。官方公告常常用簡稱或不同寫法，把它們都列進來可以明顯提高命中率。
 */
definePageMeta({ layout: 'admin', middleware: 'auth' })

const { data: settings, refresh } = await useSiteSettings()
const { updateSettings, loading: saving, error } = useSiteSettingsActions()

const form = reactive<SiteSettingsForm>({
  teamName: '',
  shortName: '',
  aliases: '',
  slogan: '',
  intro: '',
  logoUrl: '',
  logoPlate: false,
  heroImageUrl: '',
  foundedYear: null,
  homeField: '',
  homeCity: '',
  contactEmail: '',
  socialLinks: [],
})

/**
 * 「有沒有改過」的基準：最後一次從伺服器灌進表單時的樣子。
 *
 * 這一頁是後台唯一一個要按儲存的表單（其餘都是自動儲存），而儲存鈕在
 * 很長的表單最底下 —— 改了最上面的隊名就離開，是這一頁最可能發生的失誤。
 * 底部的儲存列因此要講出「有沒有東西還沒存」，而不只是一顆按鈕。
 * 用整份表單的 JSON 比較：欄位少、而且社群連結是陣列，逐欄比反而容易漏。
 *
 * ⚠️ 要宣告在 `watchEffect` **前面**：它會立刻執行一次並寫入這個 ref，
 * 放在後面就是暫時性死區（見 CLAUDE.md）。
 */
const baseline = ref('')
const dirty = computed(() => baseline.value !== '' && JSON.stringify(form) !== baseline.value)

watchEffect(() => {
  if (!settings.value) return
  const snapshot: SiteSettingsForm = {
    teamName: settings.value.teamName,
    shortName: settings.value.shortName,
    aliases: settings.value.aliases,
    slogan: settings.value.slogan,
    intro: settings.value.intro,
    logoUrl: settings.value.logoUrl,
    logoPlate: settings.value.logoPlate,
    heroImageUrl: settings.value.heroImageUrl,
    foundedYear: settings.value.foundedYear,
    homeField: settings.value.homeField,
    homeCity: settings.value.homeCity,
    contactEmail: settings.value.contactEmail,
    socialLinks: settings.value.socialLinks.map((link) => ({ ...link })),
  }
  Object.assign(form, snapshot)
  // ⚠️ 從 snapshot 算，不能讀 `form`：在 watchEffect 裡讀它，表單就成了依賴，
  // 每打一個字都會重跑這段、把表單蓋回伺服器上的值。
  // 鍵的順序和 `form` 的初始值一致，所以兩邊的 JSON 可以直接比。
  baseline.value = JSON.stringify(snapshot)
})

const savedMessage = ref('')

const candidates = computed(() => teamNameCandidates(form))

function addSocialLink() {
  form.socialLinks = [...form.socialLinks, { label: '', url: '' }]
}

async function submit() {
  await updateSettings(form)
  await refresh()
  savedMessage.value = '設定已儲存'
  setTimeout(() => (savedMessage.value = ''), 3000)
}

useHead({ title: '網站設定' })
</script>

<template>
  <div>
    <AdminHeader title="網站設定" description="球隊名稱、識別圖與聯絡資訊，改了全站立即生效。" />

    <form class="max-w-2xl space-y-8" @submit.prevent="submit">
      <!-- ── 球隊識別 ───────────────────────────────────────────── -->
      <section class="space-y-4 rounded-xl border border-border bg-surface p-5">
        <h2 class="text-fluid-lg font-bold">球隊識別</h2>

        <UiBaseInput
          v-model="form.teamName"
          label="球隊名稱"
          required
          :error="error?.fieldErrors.teamName?.[0]"
        />

        <div class="grid gap-4 sm:grid-cols-2">
          <UiBaseInput v-model="form.shortName" label="簡稱" placeholder="例如：城市" />
          <UiBaseInput v-model="form.slogan" label="標語" placeholder="顯示在首頁主視覺" />
        </div>

        <UiBaseInput
          v-model="form.aliases"
          label="隊名的其他寫法"
          placeholder="用逗號分隔，例如：城市隊,City,城市棒球"
          hint="辨識賽程圖時會一併比對這些名稱，寫得越齊全命中率越高。"
        />

        <p class="rounded-lg bg-surface-muted px-3 py-2 text-fluid-sm">
          <span class="text-content-muted">AI 辨識時會比對：</span>
          <template v-if="candidates.length">
            <UiBaseBadge v-for="name in candidates" :key="name" tone="brand" size="sm" class="mr-1">
              {{ name }}
            </UiBaseBadge>
          </template>
          <span v-else class="text-warning">尚未填寫任何隊名</span>
        </p>

        <UiBaseTextarea
          v-model="form.intro"
          label="球隊簡介"
          :rows="5"
          :maxlength="1000"
          hint="顯示在首頁底部。"
        />
      </section>

      <!-- ── 圖片 ───────────────────────────────────────────────── -->
      <section class="space-y-4 rounded-xl border border-border bg-surface p-5">
        <h2 class="text-fluid-lg font-bold">圖片</h2>
        <AdminImageField
          v-model="form.logoUrl"
          label="隊徽"
          folder="site"
          hint="建議用去背 PNG，高度 200px 以上。方形或橫式都可以。"
        />

        <label class="flex min-h-11 items-center gap-2 text-fluid-sm font-medium">
          <input v-model="form.logoPlate" type="checkbox" class="size-4" />
          隊徽加上白色底板
        </label>
        <p class="-mt-2 text-xs text-content-muted">
          白底或淺底的隊徽放在深色標題列上會像一塊方塊，打開後會放進白色圓角底板。
          去背的隊徽不用開。
        </p>
        <AdminImageField
          v-model="form.heroImageUrl"
          label="首頁主視覺"
          folder="site"
          hint="橫幅圖片，會加上暗色濾鏡讓文字清楚可讀。留空則使用預設的球場紋理。"
        />
      </section>

      <!-- ── 基本資訊 ───────────────────────────────────────────── -->
      <section class="space-y-4 rounded-xl border border-border bg-surface p-5">
        <h2 class="text-fluid-lg font-bold">基本資訊</h2>

        <div class="grid gap-4 sm:grid-cols-2">
          <UiBaseInput
            :model-value="form.foundedYear ? String(form.foundedYear) : ''"
            label="成立年份"
            type="number"
            @update:model-value="form.foundedYear = $event ? Number($event) : null"
          />
          <UiBaseInput v-model="form.homeField" label="主場球場" />
        </div>

        <UiBaseSelect
          v-model="form.homeCity"
          label="主場縣市"
          placeholder="— 不設定 —"
          :options="TAIWAN_CITIES.map((city) => ({ value: city, label: city }))"
          hint="新增比賽時會帶入這個縣市，用來查當天的天氣預報。每場比賽都可以改。"
        />

        <UiBaseInput v-model="form.contactEmail" label="聯絡信箱" type="email" />

        <div class="space-y-3">
          <div class="flex items-center justify-between">
            <span class="text-fluid-sm font-medium">社群連結</span>
            <UiBaseButton variant="ghost" size="sm" @click="addSocialLink">＋ 新增</UiBaseButton>
          </div>

          <div
            v-for="(link, index) in form.socialLinks"
            :key="index"
            class="grid items-end gap-3 sm:grid-cols-[10rem_1fr_auto]"
          >
            <UiBaseInput v-model="link.label" label="名稱" placeholder="Facebook" />
            <UiBaseInput v-model="link.url" label="網址" placeholder="https://…" />
            <UiBaseButton
              variant="ghost"
              size="sm"
              aria-label="移除連結"
              @click="form.socialLinks = form.socialLinks.filter((_, i) => i !== index)"
            >
              <AdminIcon name="x" class="size-4" />
            </UiBaseButton>
          </div>
        </div>
      </section>

      <!--
        儲存列黏在畫面底部（`sticky`，範圍是這個 form）：捲到表單哪裡都按得到，
        捲過表單結尾就停在原位。「已儲存」的確認也放在這裡 —— 原本它在頁首，
        而按下儲存的那一刻，使用者正停在表單最底下，看不到頁首。
      -->
      <div
        class="sticky bottom-[calc(1rem+env(safe-area-inset-bottom))] z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3 shadow-lg"
      >
        <p class="text-fluid-sm" role="status">
          <span v-if="dirty" class="font-medium text-warning">有尚未儲存的變更</span>
          <span v-else-if="savedMessage" class="inline-flex items-center gap-1 text-success">
            <AdminIcon name="check" class="size-4" />{{ savedMessage }}
          </span>
          <span v-else class="text-content-muted">所有變更都已儲存</span>
        </p>
        <UiBaseButton type="submit" :loading="saving" :variant="dirty ? 'primary' : 'secondary'">
          儲存設定
        </UiBaseButton>
      </div>
    </form>
  </div>
</template>
