<script setup lang="ts">
import type { GameClip } from '#shared/schemas/game'
import { clipEmbedUrl, clipThumbnailUrl, HALF_LABELS, visibleClips } from '#shared/schemas/game'

/**
 * 這一場的錄影片段（見 `docs/game-recording-plan.md`）。
 *
 * ## 為什麼預設只畫縮圖
 * 一場七局最多十四段。十四個 YouTube iframe 各自是一個完整的播放器，
 * 在手機上會直接把頁面拖垮 —— 而訪客通常只想看其中一兩段。
 * 所以預設是縮圖 + 播放鈕，**點下去才換成 iframe**。
 *
 * ## 為什麼有些片段不會出現
 * 透過 API 上傳的影片一律是私人的（未通過 YouTube 合規稽核的專案強制如此），
 * 管理者要手動改成公開。私人影片嵌進來只會顯示「無法播放」，而那是訪客
 * 看到的畫面 —— 所以 `visibleClips()` 直接把它們濾掉，寧可少一段也不要
 * 一個壞掉的播放器。
 */
const props = defineProps<{
  clips: GameClip[]
  /** 未開打／進行中說「片段」，已結束說「回放」—— 同一份資料，兩種說法。 */
  finished?: boolean
}>()

const clips = computed(() => visibleClips(props.clips))

/** 目前展開成播放器的那一段。同時只留一個 —— 兩個影片一起播沒有意義。 */
const playing = ref('')

function label(clip: GameClip): string {
  return `第 ${clip.inning} 局${HALF_LABELS[clip.half]}`
}
</script>

<template>
  <section v-if="clips.length" aria-labelledby="clips-heading">
    <h2 id="clips-heading" class="mb-4 text-fluid-xl font-bold">
      {{ finished ? '賽事回放' : '本場影片' }}
    </h2>

    <ul class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <li
        v-for="clip in clips"
        :key="clip.videoId"
        class="surface-card overflow-hidden rounded-xl border border-border bg-surface-raised"
      >
        <!-- 16:9 的框先佔好位，換成 iframe 時版面才不會跳 -->
        <div class="relative aspect-video bg-ink">
          <iframe
            v-if="playing === clip.videoId"
            :src="`${clipEmbedUrl(clip.videoId)}?autoplay=1`"
            :title="label(clip)"
            class="absolute inset-0 size-full"
            allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
            allowfullscreen
          />

          <button
            v-else
            type="button"
            class="group absolute inset-0 size-full"
            :aria-label="`播放${label(clip)}`"
            @click="playing = clip.videoId"
          >
            <!--
              縮圖用 `object-cover`：YouTube 的 hqdefault 是 4:3，直接放進
              16:9 的框會上下留黑邊。
            -->
            <img
              :src="clipThumbnailUrl(clip.videoId)"
              alt=""
              loading="lazy"
              class="size-full object-cover"
            />
            <span class="absolute inset-0 bg-ink/25 transition group-hover:bg-ink/10" />
            <span
              class="absolute top-1/2 left-1/2 flex size-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-danger text-white transition group-hover:scale-110"
            >
              <svg class="size-6" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path
                  d="M8 5.14v13.72a1 1 0 0 0 1.5.86l11-6.86a1 1 0 0 0 0-1.72l-11-6.86A1 1 0 0 0 8 5.14Z"
                />
              </svg>
            </span>
          </button>
        </div>

        <p class="px-4 py-3 font-bold">{{ label(clip) }}</p>
      </li>
    </ul>
  </section>
</template>
