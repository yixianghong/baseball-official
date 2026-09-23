<script setup lang="ts">
/**
 * 推播通知的開關。
 *
 * 放在導覽列（桌機）與手機選單裡，不做成彈窗或橫幅 —— 主動跳出來要通知權限
 * 是最惹人厭的網站行為之一，而且瀏覽器會記住「使用者拒絕過」，之後再也問不了。
 * 想收通知的人自己找得到，這樣要到的權限才是真的有意義的。
 *
 * ## 兩種呈現
 * - `compact`（導覽列，**手機與桌機都一樣**）：只有鈴鐺與開關，沒有說明文字。
 *   開不了的狀態直接不顯示 —— 導覽列上放一個永遠按不動的開關只是噪音。
 * - 完整（頁尾）：帶文字說明，並且會把「為什麼開不了」講出來。
 *   iOS 必須先加入主畫面這件事只能靠文字說明，沒有程式可以代勞，而精簡版
 *   在那個狀態下是隱藏的 —— 所以這一份不能拿掉，否則 iPhone 使用者會看到
 *   一片空白，完全不知道為什麼別人都收得到通知。
 *
 * 各種狀態的定義見 `app/composables/usePushSubscription.ts` 的 `PushState`。
 */
const props = defineProps<{ compact?: boolean }>()

const { state, isBusy, message, enable, disable } = usePushSubscription()

/** 這個瀏覽器根本做不到，或站台沒開推播 —— 整塊不顯示。 */
const unsupported = computed(() => state.value === 'unavailable' || state.value === 'unsupported')

/** 做得到，但現在按不動（iOS 還沒加入主畫面、或權限已被封鎖）。 */
const blocked = computed(() => state.value === 'needs-install' || state.value === 'denied')

const hidden = computed(() => unsupported.value || (props.compact && blocked.value))

const checked = computed(() => state.value === 'on')

const blockedReason = computed(() =>
  state.value === 'needs-install'
    ? '在 iPhone 上要先用分享選單把本站加入主畫面，才能開啟通知。'
    : '通知權限已被封鎖。要重新開啟，請到瀏覽器的網站設定允許本站傳送通知。',
)

function toggle() {
  if (blocked.value || isBusy.value) return
  return checked.value ? disable() : enable()
}
</script>

<template>
  <!--
    完整版不自帶左右內距：它現在只出現在頁尾，而頁尾的容器已經有內距了。
    （`px-5` 是當初擺在手機選單裡、需要和選單項目對齊時留下的。）
  -->
  <div v-if="!hidden" :class="compact ? 'flex items-center' : 'py-3'">
    <div :class="compact ? 'flex items-center gap-2' : 'flex items-center justify-between gap-4'">
      <!--
        精簡模式也要有鈴鐺。導覽列上一個沒有任何標示的開關，看得見的人根本
        不知道它管什麼 —— `aria-label` 只幫得到螢幕閱讀器。
      -->
      <svg
        v-if="compact"
        class="size-4 text-white/70"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
      >
        <path
          d="M12 2a6 6 0 0 0-6 6v3.6l-1.7 3.4A1 1 0 0 0 5.2 17h13.6a1 1 0 0 0 .9-1.4L18 11.6V8a6 6 0 0 0-6-6Zm0 20a3 3 0 0 0 2.8-2H9.2a3 3 0 0 0 2.8 2Z"
        />
      </svg>

      <label
        v-if="!compact"
        :for="`push-switch${compact ? '-compact' : ''}`"
        class="text-fluid-sm font-semibold text-white/80"
      >
        <span aria-hidden="true" class="mr-2">🔔</span>比賽與公告通知
      </label>

      <!--
        真正的 switch：用 role="switch" + aria-checked，螢幕閱讀器才會念成
        「開關，已開啟／已關閉」，而不是一顆意義不明的按鈕。
      -->
      <button
        :id="`push-switch${compact ? '-compact' : ''}`"
        type="button"
        role="switch"
        :aria-checked="checked"
        :aria-label="compact ? '比賽與公告通知' : undefined"
        :disabled="isBusy || blocked"
        :title="blocked ? blockedReason : undefined"
        class="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-40"
        :class="checked ? 'bg-accent-500' : 'bg-white/25'"
        @click="toggle"
      >
        <span
          class="inline-block size-4 rounded-full bg-white shadow transition-transform"
          :class="checked ? 'translate-x-6' : 'translate-x-1'"
        />
      </button>
    </div>

    <!-- 開不了的原因。compact 模式不會走到這裡（整塊已經隱藏） -->
    <p v-if="!compact && blocked" class="mt-2 text-xs leading-relaxed text-white/50">
      {{ blockedReason }}
    </p>

    <!-- aria-live：狀態是按下之後才變的，螢幕閱讀器需要被告知 -->
    <p v-else-if="!compact && message" class="mt-2 text-xs text-white/50" aria-live="polite">
      {{ message }}
    </p>
  </div>
</template>
