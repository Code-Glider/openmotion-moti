/**
 * Black Friday campaign links from OpenMotion to the OpenDesign Pricing page.
 *
 * Each link carries the cross-product attribution the Pricing page already reads (`od_entry_id`, `od_entry_source`,
 * `od_entry_at`) and keeps as the first touch through checkout, plus `od_origin=openmotion` and standard UTM fields for
 * the website's session source. The same `entry_id` is reported on the OpenMotion click, so a click can be joined to
 * the Pricing visit and payment that followed it. No account, installation or device data is placed in the address.
 */
export const BLACK_FRIDAY_CAMPAIGN = 'black_friday_2026';

/** Where the click happened: the top campaign banner or the header Pricing entry. */
export type CampaignEntrySource = 'openmotion_bf_banner' | 'openmotion_header_pricing';
const utmMedium: Record<CampaignEntrySource, string> = { openmotion_bf_banner: 'banner', openmotion_header_pricing: 'header' };

export function newCampaignEntryId() {
  return crypto.randomUUID();
}

export function campaignPricingUrl(locale: string, source: CampaignEntrySource, entryId: string, at = new Date()) {
  const url = new URL(locale.startsWith('zh') ? 'https://open-design.ai/zh/pricing/' : 'https://open-design.ai/pricing/');
  url.search = new URLSearchParams({
    od_origin: 'openmotion', od_entry_source: source, od_entry_id: entryId, od_entry_at: at.toISOString(),
    utm_source: 'openmotion', utm_medium: utmMedium[source], utm_campaign: BLACK_FRIDAY_CAMPAIGN,
  }).toString();
  return url.toString();
}
