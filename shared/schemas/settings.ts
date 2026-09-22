import { z } from 'zod'
import { citySchema } from './weather'

/**
 * 網站設定 —— Firestore 中 `siteSettings/main` 這一份單一文件。
 *
 * 隊名、Logo、主視覺這些會出現在每一頁的東西放這裡，改一次全站生效，
 * 不需要重新部署。
 */

export const socialLinkSchema = z.object({
  label: z.string().trim().min(1).max(20),
  url: z.url('請輸入有效的網址'),
})

export const siteSettingsInputSchema = z.object({
  teamName: z.string().trim().min(1, '請輸入球隊名稱').max(40),
  /** 用於辨識賽程圖中的我隊名稱，也是 AI 辨識時的預設隊名。 */
  shortName: z.string().trim().max(20).default(''),
  /** 隊名的其他寫法，逗號分隔。AI 辨識賽程圖時一併比對，提高命中率。 */
  aliases: z.string().trim().max(200).default(''),
  slogan: z.string().trim().max(60).default(''),
  intro: z.string().trim().max(1000).default(''),
  logoUrl: z.string().trim().default(''),
  /**
   * 隊徽是否要墊一塊白色底板。
   *
   * 去背的隊徽直接放在深色標題列上最好看，但很多球隊手上只有白底或淺底的圖，
   * 那樣會在深藍列上留下一塊突兀的方塊。開啟這個選項後，圖會被放進一個白色
   * 圓角底板裡 —— 同一張圖就從「沒去乾淨的背景」變成「刻意的徽章牌」。
   */
  logoPlate: z.boolean().default(false),
  heroImageUrl: z.string().trim().default(''),
  foundedYear: z.number().int().min(1900).max(2100).nullable().default(null),
  homeField: z.string().trim().max(60).default(''),
  /** 主場所在縣市。新增比賽時會帶進去當預設，省下每一場都要選一次。 */
  homeCity: citySchema.default(''),
  contactEmail: z.string().trim().max(80).default(''),
  socialLinks: z.array(socialLinkSchema).max(6).default([]),
})

/** 後台送出的資料（有預設值的欄位可省略）。 */
export type SiteSettingsInput = z.input<typeof siteSettingsInputSchema>

/**
 * 表單狀態用的型別（所有欄位都已套用預設值，因此都是必填）。
 *
 * 表單綁定要用這個而不是 `SiteSettingsInput`：`v-model` 的目標不能是
 * `string | undefined`，否則每個欄位都要寫 `?? ''` 才過得了型別檢查，
 * 那些 fallback 除了滿足編譯器之外沒有任何作用。
 */
export type SiteSettingsForm = z.output<typeof siteSettingsInputSchema>

export const siteSettingsSchema = siteSettingsInputSchema.extend({
  updatedAt: z.string().default(''),
})

export type SiteSettings = z.infer<typeof siteSettingsSchema>

/** 尚未在後台設定過任何東西時使用的預設值。 */
export const DEFAULT_SITE_SETTINGS: SiteSettings = {
  teamName: '球隊官網',
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
  updatedAt: '',
}

/**
 * 組出 AI 辨識賽程時要比對的隊名清單。
 *
 * 放在 shared 而不是 server：後台的辨識表單也要顯示「將比對這些名稱」，
 * 兩邊用同一份邏輯才不會出現「畫面說會比對、實際沒比對」的落差。
 */
export function teamNameCandidates(
  settings: Pick<SiteSettings, 'teamName' | 'shortName' | 'aliases'>,
): string[] {
  return [settings.teamName, settings.shortName, ...settings.aliases.split(/[,，]/)]
    .map((name) => name.trim())
    .filter((name) => name.length > 0)
}
