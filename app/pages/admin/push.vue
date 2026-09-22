<script setup lang="ts">
import type { PushSendResult } from '#shared/schemas/push'

/**
 * 推播通知。
 *
 * ## 為什麼是手動發送，不是發布公告就自動推
 * 後台存檔的次數遠多於「真的要通知大家」的次數 —— 改錯字、調順序、補圖
 * 都會觸發存檔。自動發送的下場是大家被洗版然後把通知關掉，之後真正重要的
 * 事情反而傳不出去。推播送出去收不回來，決定權留給人。
 *
 * 從公告帶入內容只是省打字，帶完還是要按發送。
 */
definePageMeta({ layout: 'admin', middleware: 'auth' })

const { data: status, refresh: refreshStatus, pending: statusPending } = await usePushStatus()
const { data: announcements } = await useAdminAnnouncements()
const { sendPush, loading: sending, error } = usePushActions()

const form = reactive({ title: '', body: '', url: '/news', tag: 'hgm-general' })
const result = ref<PushSendResult | null>(null)
const failureMessage = ref('')
const confirming = ref(false)

/** 只有已發布的公告能拿來帶入 —— 草稿推出去等於提前曝光。 */
const publishedAnnouncements = computed(() =>
  (announcements.value ?? []).filter((item) => item.status === 'published').slice(0, 20),
)

const canSend = computed(
  () => Boolean(status.value?.configured) && form.title.trim().length > 0 && !sending.value,
)

/** 從公告帶入。內文取前 100 字 —— 通知列上顯示得下的大概就這麼多。 */
const pickedAnnouncement = ref('')

watch(pickedAnnouncement, (id) => {
  const announcement = publishedAnnouncements.value.find((item) => item.id === id)
  if (!announcement) return

  form.title = announcement.title.slice(0, 60)
  form.body = announcement.content.replace(/\s+/g, ' ').trim().slice(0, 100)
  form.url = '/news'
  // 用公告 ID 當 tag：同一則公告重送不會在通知列上疊成兩條
  form.tag = `announcement-${announcement.id}`.slice(0, 40)
  result.value = null
  failureMessage.value = ''
})

async function submit() {
  confirming.value = false
  result.value = null
  failureMessage.value = ''

  try {
    result.value = await sendPush({ ...form })
    await refreshStatus()
  } catch {
    failureMessage.value = error.value?.message ?? '發送失敗'
  }
}

useHead({ title: '推播通知' })
</script>

<template>
  <div>
    <AdminHeader title="推播通知" description="把重要消息推到已訂閱的裝置上。送出後無法收回。" />

    <UiBaseSpinner v-if="statusPending" />

    <!-- 沒設定金鑰時，把設定方式直接寫出來，不要只說「未啟用」 -->
    <UiBaseEmpty
      v-else-if="!status?.configured"
      title="推播功能尚未啟用"
      description="需要先設定 VAPID 金鑰：執行 npx web-push generate-vapid-keys，把公鑰放進 NUXT_PUBLIC_VAPID_PUBLIC_KEY、私鑰放進 NUXT_VAPID_PRIVATE_KEY，並設定 NUXT_VAPID_SUBJECT 為聯絡信箱。"
      icon="🔕"
    />

    <div v-else class="max-w-2xl space-y-6">
      <!-- 訂閱數要放在最上面：送給 0 台裝置是最容易發生也最難察覺的狀況 -->
      <div class="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface p-5">
        <span class="text-fluid-2xl font-black tabular-nums">{{ status.subscriberCount }}</span>
        <div class="text-fluid-sm">
          <p class="font-semibold">台裝置已訂閱</p>
          <p class="text-content-muted">
            {{
              status.subscriberCount === 0
                ? '目前沒有人會收到通知。請隊員到前台頁尾開啟通知。'
                : '按下發送後，這些裝置會立刻收到。'
            }}
          </p>
        </div>
      </div>

      <section class="space-y-4 rounded-xl border border-border bg-surface p-5">
        <h2 class="text-fluid-lg font-bold">從公告帶入</h2>
        <UiBaseSelect
          v-if="publishedAnnouncements.length"
          v-model="pickedAnnouncement"
          label="選一則已發布的公告"
          placeholder="— 不帶入，自己填 —"
          :options="publishedAnnouncements.map((a) => ({ value: a.id, label: a.title }))"
        />
        <p v-else class="text-fluid-sm text-content-muted">還沒有已發布的公告。</p>
      </section>

      <form
        class="space-y-4 rounded-xl border border-border bg-surface p-5"
        @submit.prevent="confirming = true"
      >
        <h2 class="text-fluid-lg font-bold">通知內容</h2>

        <UiBaseInput
          v-model="form.title"
          label="標題"
          required
          placeholder="例如：本週六比賽改期"
          hint="最多 60 字。手機通知列上只看得到前面一段，重點寫在最前面。"
          :error="error?.fieldErrors.title?.[0]"
        />

        <UiBaseTextarea
          v-model="form.body"
          label="內文"
          :rows="3"
          placeholder="例如：因場地維修，改到 10/5（日）09:00，地點不變。"
          hint="最多 160 字。"
          :error="error?.fieldErrors.body?.[0]"
        />

        <UiBaseInput
          v-model="form.url"
          label="點擊後開啟的頁面"
          placeholder="/news"
          hint="站內路徑，要以 / 開頭。"
          :error="error?.fieldErrors.url?.[0]"
        />

        <div class="flex flex-wrap items-center gap-3 border-t border-border pt-4">
          <UiBaseButton type="submit" :disabled="!canSend" :loading="sending">
            發送給 {{ status.subscriberCount }} 台裝置
          </UiBaseButton>
          <p class="text-fluid-sm text-content-muted">送出後無法收回或修改。</p>
        </div>
      </form>

      <!-- 二次確認：推播是不可逆的操作，比照刪除處理 -->
      <div
        v-if="confirming"
        class="space-y-3 rounded-xl border border-warning bg-warning/10 p-5"
        role="alertdialog"
        aria-label="確認發送推播"
      >
        <p class="font-semibold">確定要發送嗎？</p>
        <p class="text-fluid-sm">
          <strong>{{ form.title }}</strong>
          <span v-if="form.body" class="block text-content-muted">{{ form.body }}</span>
        </p>
        <div class="flex gap-2">
          <UiBaseButton :loading="sending" @click="submit">確定發送</UiBaseButton>
          <UiBaseButton variant="secondary" @click="confirming = false">取消</UiBaseButton>
        </div>
      </div>

      <p v-if="result" class="rounded-lg bg-success/10 px-4 py-3 text-fluid-sm text-success">
        ✓ 已送出 {{ result.sent }} 台
        <template v-if="result.failed">，{{ result.failed }} 台失敗</template>
        <template v-if="result.pruned">（其中 {{ result.pruned }} 筆失效的訂閱已清除）</template>
      </p>

      <p v-if="failureMessage" class="rounded-lg bg-danger/10 px-4 py-3 text-fluid-sm text-danger">
        {{ failureMessage }}
      </p>
    </div>
  </div>
</template>
