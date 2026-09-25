<script setup lang="ts">
/**
 * 隱私權政策。
 *
 * ## 為什麼需要這一頁
 * 直接的理由是 Google 的 OAuth 同意畫面要把應用程式切到「正式版」時，
 * 必須提供一個公開的隱私權政策網址（賽事錄影要上傳 YouTube，見
 * `docs/game-recording-plan.md`）。但這個站本來就該有一頁 —— 它有推播訂閱、
 * 有後台 session，還可以安裝成 PWA。
 *
 * ## 內容寫的是這個站**實際上**在做的事
 * 不套通用範本。每一條都對得上程式碼：推播訂閱的欄位來自
 * `shared/schemas/push.ts`、cookie 名稱來自 `shared/constants/`、
 * 外部服務就是 `server/utils/` 底下那幾支。**改動資料處理方式時要回來改這裡**，
 * 一份說明和實作對不上的隱私權政策，比沒有更糟。
 */
const { data: settings } = await useSiteSettings()

const teamName = computed(() => settings.value?.teamName ?? '本球隊')
const contactEmail = computed(() => settings.value?.contactEmail ?? '')

/**
 * 最後更新日期寫死。
 *
 * 不要用 `new Date()` —— 那會讓這一頁每天都宣稱自己「今天剛更新」，
 * 而政策內容根本沒變。改內容的時候一起改這個日期。
 */
const updatedAt = '2026-09-25'

useHead({ title: '隱私權政策' })
</script>

<template>
  <div>
    <CommonPageHero
      en="PRIVACY"
      zh="隱私權政策"
      :description="`${teamName}官方網站如何處理你的資料。`"
    />

    <div class="container-content py-12 md:py-16">
      <div class="markdown max-w-2xl">
        <p class="text-fluid-sm text-content-muted">最後更新：{{ updatedAt }}</p>

        <h2>簡單版</h2>
        <p>
          這個網站不需要註冊、不放廣告、也沒有安裝任何分析或追蹤工具。
          一般瀏覽時我們不會蒐集任何可以識別你身分的資料。
        </p>

        <h2>我們會存的東西</h2>

        <h3>推播通知（你主動開啟才會有）</h3>
        <p>按下「比賽與公告通知」的開關之後，瀏覽器會產生一組訂閱資料，我們會儲存：</p>
        <ul>
          <li>
            推送服務的 endpoint 網址（由你的瀏覽器指定，例如 Google、Mozilla 或 Apple 的服務）
          </li>
          <li>兩把加密金鑰，用來把通知內容加密後才送出</li>
          <li>瀏覽器的 User-Agent 字串，用來分辨同一個人的不同裝置</li>
        </ul>
        <p>
          這些資料只用來發送比賽提醒與公告通知，<strong>不會提供給任何第三方</strong>。
          關閉開關即刻刪除；換裝置或清除瀏覽器資料後，舊的訂閱也會在發送失敗時自動移除。
        </p>

        <h3>Cookie</h3>
        <p>這個站只用兩種 cookie，都不是用來追蹤的：</p>
        <ul>
          <li><code>color_mode</code>：記住你選的淺色或深色配色</li>
          <li>
            <code>app_session</code>：球隊管理者登入後台用的登入狀態。它是加密的 httpOnly
            cookie，一般訪客不會有
          </li>
        </ul>

        <h3>伺服器紀錄</h3>
        <p>
          和所有網站一樣，伺服器會記錄請求的時間、路徑與回應狀態，用於排查錯誤。
          這些紀錄會隨著部署環境的保留期限自動清除。
        </p>

        <h2>網站上的公開資訊</h2>
        <p>
          球員姓名、背號、守備位置、出賽紀錄與比賽影片，都是球隊自行登錄、
          刻意公開的內容。如果你是隊員且不希望自己的資料出現在網站上， 請直接告訴球隊，我們會移除。
        </p>

        <h2>會用到的外部服務</h2>
        <ul>
          <li><strong>Google Firebase</strong>：網站主機、資料庫與圖片儲存</li>
          <li>
            <strong>YouTube</strong>：賽事影片存放於球隊的 YouTube 頻道，播放時適用 YouTube
            自己的隱私權政策
          </li>
          <li>
            <strong>中央氣象署開放資料</strong
            >：查詢比賽當天的天氣預報（只送出場地所在縣市，不送任何個人資料）
          </li>
          <li>
            <strong>Google Gemini</strong
            >：後台管理者上傳的賽程圖、計分板照片與名冊會送去辨識。這只發生在管理者操作時，一般訪客不會觸發
          </li>
        </ul>

        <h2>兒童</h2>
        <p>
          本網站不主動向未滿 13 歲的對象蒐集個人資料。球隊登錄的球員資料若涉及未成年人，
          由球隊與其監護人自行確認。
        </p>

        <h2>你的權利</h2>
        <p>你可以隨時關閉推播通知、清除瀏覽器的 cookie，或要求我們移除網站上與你有關的資料。</p>

        <h2>聯絡我們</h2>
        <p v-if="contactEmail">
          有任何隱私相關的問題，請來信
          <a :href="`mailto:${contactEmail}`">{{ contactEmail }}</a
          >。
        </p>
        <p v-else>有任何隱私相關的問題，請透過網站上公布的聯絡方式與球隊聯繫。</p>
      </div>
    </div>
  </div>
</template>
