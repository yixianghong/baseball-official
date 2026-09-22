<script setup lang="ts">
import { MAX_GAME_QUERY_LIMIT } from '#shared/schemas/game'
import { describeHands, POSITION_LABELS } from '#shared/schemas/player'
import { formatGameDate } from '~/utils/format'

/**
 * 球員個人頁。
 *
 * ## 出賽紀錄怎麼來的
 * 比賽的打線裡存著 `playerId`，所以只要把已結束的比賽抓回來、過濾出
 * 打線中有這個人的場次就好 —— 不需要為了這一小段資訊多開一張資料表
 * 或多一支端點。球隊一季的場次是數十場的量級，在前端過濾完全划算。
 */
const route = useRoute()
const playerId = computed(() => String(route.params.id))

const { data: player, error } = await usePlayer(playerId)
const { data: games } = await useGames({ scope: 'past', limit: MAX_GAME_QUERY_LIMIT })

const appearances = computed(() =>
  (games.value ?? [])
    .map((game) => ({
      game,
      entry: game.lineup.find((item) => item.playerId === playerId.value),
    }))
    .filter((item) => item.entry),
)

const handText = computed(() =>
  player.value ? describeHands(player.value.throws, player.value.bats) : '',
)

useHead({ title: () => player.value?.name ?? '球員' })
</script>

<template>
  <div class="container-content py-10 md:py-14">
    <NuxtLink
      to="/players"
      class="mb-6 inline-flex text-fluid-sm text-content-muted hover:text-brand-600"
    >
      ← 回到球員名單
    </NuxtLink>

    <UiBaseEmpty
      v-if="error"
      title="找不到這位球員"
      description="他可能已經從名單中移除。"
      icon="🔍"
    />

    <div v-else-if="player" class="grid gap-8 md:grid-cols-[minmax(0,16rem)_1fr]">
      <!-- ── 個人卡片 ─────────────────────────────────────────── -->
      <aside>
        <div class="overflow-hidden rounded-2xl border border-border bg-surface-raised">
          <!--
            照片是**固定高度的直式方塊，置中放在一條深色帶上**。

            原本只寫 `aspect-4/5`，照片會跟著卡片寬度等比長高 —— 手機上
            變成 358×448，整個首屏都是一張照片，背號、守位、出賽紀錄全被
            推到捲動線以下。

            改成固定高度之後寬度由比例決定（240 × 4/5 = 192），兩側留白
            交給外層的深色帶接住；直接讓照片橫向鋪滿會把人像裁成寬幅，
            頭很容易被切掉。

            `object-top` 同理：要截就截下緣，不要上下各半。
          -->
          <!-- 紋理鋪滿整條深色帶，照片兩側的留白才不會看起來像缺了一塊 -->
          <div class="field-pattern flex justify-center bg-ink">
            <div class="aspect-4/5 h-60 shrink-0">
              <img
                v-if="player.photoUrl"
                :src="player.photoUrl"
                :alt="`${player.name} 的照片`"
                class="size-full object-cover object-top"
              />
              <div v-else class="flex size-full items-center justify-center">
                <span class="text-6xl font-black text-white/70 tabular-nums">
                  {{ player.number || '—' }}
                </span>
              </div>
            </div>
          </div>

          <div class="space-y-4 p-5">
            <div>
              <p class="text-fluid-sm text-content-muted">背號 {{ player.number || '—' }}</p>
              <h1 class="text-fluid-2xl font-bold">{{ player.name }}</h1>
            </div>

            <!--
              `shrink-0` 加在每個 dt 上不能省。

              flex item 預設可以被壓縮，值一長，被擠到的是**標籤**：
              「守備位置」會斷成「守備位」「置」。標籤是固定的四個字，
              永遠不該換行 —— 要換行的是值。

              守備位置的值另外用 flex-wrap 排，換行時會斷在「／」之間，
              不會出現「二壘」換行「手」這種斷在詞中間的情況。
            -->
            <dl class="space-y-3 text-fluid-sm">
              <div class="flex justify-between gap-4">
                <dt class="shrink-0 text-content-muted">守備位置</dt>
                <dd class="flex flex-wrap justify-end gap-x-1 font-medium">
                  <span v-for="(position, index) in player.positions" :key="position">
                    {{ POSITION_LABELS[position] }}
                    <span v-if="index < player.positions.length - 1" class="text-content-muted">
                      ／
                    </span>
                  </span>
                </dd>
              </div>
              <div class="flex justify-between gap-4">
                <dt class="shrink-0 text-content-muted">投打習慣</dt>
                <dd class="text-right font-medium">{{ handText }}</dd>
              </div>
              <div v-if="player.joinedYear" class="flex justify-between gap-4">
                <dt class="shrink-0 text-content-muted">加入年份</dt>
                <dd class="font-medium tabular-nums">{{ player.joinedYear }}</dd>
              </div>
              <div class="flex justify-between gap-4">
                <dt class="shrink-0 text-content-muted">狀態</dt>
                <dd>
                  <UiBaseBadge :tone="player.status === 'active' ? 'success' : 'neutral'" size="sm">
                    {{ player.status === 'active' ? '現役' : '非現役' }}
                  </UiBaseBadge>
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </aside>

      <!-- ── 簡介與出賽紀錄 ───────────────────────────────────── -->
      <div class="space-y-8">
        <section v-if="player.bio">
          <h2 class="mb-3 text-fluid-lg font-bold">球員簡介</h2>
          <p class="whitespace-pre-wrap leading-relaxed text-content-muted">{{ player.bio }}</p>
        </section>

        <section>
          <h2 class="mb-3 text-fluid-lg font-bold">
            出賽紀錄
            <span class="ml-2 text-fluid-sm font-medium text-content-muted">
              共 {{ appearances.length }} 場
            </span>
          </h2>

          <div v-if="appearances.length" class="overflow-hidden rounded-xl border border-border">
            <table class="w-full border-collapse text-fluid-sm">
              <thead>
                <tr class="bg-surface-muted text-left">
                  <th scope="col" class="px-4 py-2.5 font-semibold">日期</th>
                  <th scope="col" class="px-4 py-2.5 font-semibold">對戰</th>
                  <th scope="col" class="w-16 px-4 py-2.5 text-center font-semibold">棒次</th>
                  <th scope="col" class="w-24 px-4 py-2.5 font-semibold">守備</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="item in appearances"
                  :key="item.game.id"
                  class="border-t border-border transition hover:bg-surface-muted"
                >
                  <td class="px-4 py-2.5 tabular-nums">
                    <NuxtLink :to="`/games/${item.game.id}`" class="hover:text-brand-600">
                      {{ formatGameDate(item.game.date) }}
                    </NuxtLink>
                  </td>
                  <td class="px-4 py-2.5">
                    <NuxtLink :to="`/games/${item.game.id}`" class="hover:text-brand-600">
                      vs {{ item.game.opponent }}
                    </NuxtLink>
                  </td>
                  <td class="px-4 py-2.5 text-center tabular-nums">{{ item.entry?.order }}</td>
                  <td class="px-4 py-2.5 text-content-muted">
                    {{ item.entry ? POSITION_LABELS[item.entry.position] : '' }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <UiBaseEmpty v-else title="還沒有出賽紀錄" icon="📋" />
        </section>
      </div>
    </div>
  </div>
</template>
