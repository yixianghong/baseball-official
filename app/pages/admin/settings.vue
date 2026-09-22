<script setup lang="ts">
import type { SiteSettingsForm } from '#shared/schemas/settings'
import { teamNameCandidates } from '#shared/schemas/settings'

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
  contactEmail: '',
  socialLinks: [],
})

watchEffect(() => {
  if (!settings.value) return
  Object.assign(form, {
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
    contactEmail: settings.value.contactEmail,
    socialLinks: settings.value.socialLinks.map((link) => ({ ...link })),
  })
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

    <p
      v-if="savedMessage"
      class="mb-4 rounded-lg bg-success/10 px-4 py-2 text-fluid-sm text-success"
      role="status"
    >
      ✓ {{ savedMessage }}
    </p>

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
          hint="建議用「去背」的 PNG（背景透明），高度 200px 以上。方形徽章與橫式字標都可以，網站會依比例縮放。"
        />

        <label class="flex min-h-11 items-center gap-2 text-fluid-sm font-medium">
          <input v-model="form.logoPlate" type="checkbox" class="size-4" />
          隊徽加上白色底板
        </label>
        <p class="-mt-2 text-xs text-content-muted">
          隊徽若是白底或淺底的圖，直接放在深色標題列上會出現一塊突兀的方塊。
          打開這個選項會把它放進白色圓角底板，看起來就像刻意的徽章牌。 去背的隊徽請保持關閉。
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
              ✕
            </UiBaseButton>
          </div>
        </div>
      </section>

      <UiBaseButton type="submit" :loading="saving">儲存設定</UiBaseButton>
    </form>
  </div>
</template>
