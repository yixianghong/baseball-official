<script setup lang="ts">
import {
  isNotPlayed,
  MAX_GAME_QUERY_LIMIT,
  playerAppearance,
  type PlayerAppearance,
} from '#shared/schemas/game'
import { describeHands, POSITION_LABELS } from '#shared/schemas/player'
import { formatGameDate } from '~/utils/format'

/**
 * 球員個人頁。
 *
 * ## 出賽紀錄怎麼來的
 * 把已結束的比賽抓回來，逐場問 `playerAppearance()`「這個人上場了沒有」——
 * 不需要為了這一小段資訊多開一張資料表或多一支端點。球隊一季的場次是數十場
 * 的量級，在前端過濾完全划算。
 *
 * ⚠️ **判斷不能只看打線。** 原本是 `lineup.find(...)`，於是 **DH 制下的
 * 先發投手整場都不會出現** —— 他投了七局，個人頁卻說那天沒有他的紀錄
 * （中繼、終結與代打同理：他們是比賽中才登錄到打席上的）。那條規則住在
 * `playerAppearance()`，和候補名單 `deriveBench()` 是同一條的正反兩面。
 *
 * ⚠️ **沒有打成的場次（延賽、取消）要排掉。** `scope: 'past'` 只看日期，
 * 所以那些場次也在裡面 —— 而打線是**賽前**排的，延賽的那一場照樣有他的名字。
 * 不排掉的話，「共 12 場」裡會混著幾場根本沒打的，而畫面上完全看不出來
 * （那一列和真的出賽過的長得一模一樣）。和 `tallyRecord()` 只算已結束場次
 * 是同一條原則。
 */
const route = useRoute()
const playerId = computed(() => String(route.params.id))

const { data: player, error } = await usePlayer(playerId)
const { data: games } = await useGames({ scope: 'past', limit: MAX_GAME_QUERY_LIMIT })

const appearances = computed(() => {
  const self = player.value
  if (!self) return []

  return (games.value ?? [])
    .filter((game) => !isNotPlayed(game))
    .map((game) => ({
      game,
      appearance: playerAppearance(game, { id: self.id, name: self.name }),
    }))
    .filter((item): item is { game: (typeof item)['game']; appearance: PlayerAppearance } =>
      Boolean(item.appearance),
    )
})

/**
 * 「守備」欄的字。
 *
 * 打線上有守位就寫守位；DH 制的先發投手沒有打擊順位，但他的守位就是投手。
 * **後援與代打接在後面而不是取代它** —— 一個守二壘、後來上來投球的人，
 * 兩件事都發生過，只寫其中一件都是漏掉一半。
 */
function roleText(appearance: PlayerAppearance): string {
  const parts: string[] = []
  if (appearance.position) parts.push(POSITION_LABELS[appearance.position])
  else if (appearance.startingPitcher) parts.push(POSITION_LABELS.P)
  if (appearance.relieved) parts.push('後援')
  if (appearance.pinchHit) parts.push('代打')
  return parts.join('・')
}

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
                  <!--
                    ⚠️ 棒次是**選填**的：DH 制的先發投手不打擊，後援與代打也
                    不在賽前的打線上。空著會讓那一格看起來像漏資料，所以寫「—」。
                  -->
                  <td class="px-4 py-2.5 text-center tabular-nums">
                    {{ item.appearance.order ?? '—' }}
                  </td>
                  <td class="px-4 py-2.5 text-content-muted">{{ roleText(item.appearance) }}</td>
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
