<script setup lang="ts">
/**
 * 開啟／關閉推播通知的按鈕。
 *
 * 放在前台頁尾。刻意不做成彈窗或橫幅 —— 主動跳出來要權限是最惹人厭的
 * 網站行為之一，而且瀏覽器會記住「使用者拒絕過」，之後再也問不了。
 * 想收通知的人自己找得到，這樣要到的權限也才是真的有意義的。
 *
 * 各種狀態的說明見 `app/composables/usePushSubscription.ts` 的 `PushState`。
 */
const { state, isBusy, message, enable, disable } = usePushSubscription()

/** 站台沒開推播、或這個瀏覽器根本不支援時，整塊不顯示，不要留一個壞掉的按鈕。 */
const hidden = computed(() => state.value === 'unavailable' || state.value === 'unsupported')
</script>

<template>
  <div v-if="!hidden" class="text-fluid-sm">
    <!-- iOS 必須先加入主畫面，這不是我們能用程式解決的，只能講清楚 -->
    <p v-if="state === 'needs-install'" class="text-white/60">
      在 iPhone 上要先用分享選單把本站「加入主畫面」，才能開啟比賽與公告通知。
    </p>

    <!-- 權限被拒絕之後只能從瀏覽器設定改回來，按鈕再點也沒用 -->
    <p v-else-if="state === 'denied'" class="text-white/60">
      通知權限已被封鎖。要重新開啟，請到瀏覽器的網站設定允許本站傳送通知。
    </p>

    <div v-else class="flex flex-wrap items-center gap-3">
      <button
        type="button"
        class="inline-flex min-h-10 items-center gap-2 rounded border border-white/30 px-4 font-semibold transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="isBusy"
        @click="state === 'on' ? disable() : enable()"
      >
        <span aria-hidden="true">{{ state === 'on' ? '🔔' : '🔕' }}</span>
        {{ state === 'on' ? '關閉通知' : '開啟比賽與公告通知' }}
      </button>

      <!-- aria-live：狀態是按下之後才變的，螢幕閱讀器需要被告知 -->
      <p v-if="message" class="text-white/60" aria-live="polite">{{ message }}</p>
    </div>
  </div>
</template>
