import { db } from '../lib/supabase.js';

/**
 * What the seller is selling, and who they are. Fetched once per campaign, not per prospect.
 *
 * NOTE: column names here must match your Supabase schema exactly. Mismatches
 * (status vs lead_status, name vs company_name) have been the single most common
 * cause of silent save failures. Verify these once and they stop being a problem.
 */
export type CampaignContext = {
  campaignId: string;
  productName: string;
  productDescription: string;
  productCapabilities: string;
  sellerCompany: string;
  sellerSummary: string;
  senderName: string;
  senderTitle: string;
  emailLength: 'concise' | 'standard' | 'detailed';
  emailTone: 'formal' | 'technical' | 'warm' | 'direct' | 'friendly' | 'casual';
};

export async function loadCampaignContext(campaignId: string): Promise<CampaignContext> {
  const { data, error } = await db
    .from('campaigns')
    .select(`
      id,
      sender_name,
      sender_title,
      products ( name, description, capabilities ),
      companies ( company_name, summary )
    `)
    .eq('id', campaignId)
    .single();

  if (error) throw new Error(`loadCampaignContext(${campaignId}): ${error.message}`);
  if (!data) throw new Error(`Campaign ${campaignId} not found`);

  const product = (Array.isArray(data.products) ? data.products[0] : data.products) as
    | { name: string; description: string; capabilities: string }
    | undefined;
  const company = (Array.isArray(data.companies) ? data.companies[0] : data.companies) as
    | { company_name: string; summary: string }
    | undefined;

  return {
    campaignId,
    productName: product?.name ?? '',
    productDescription: product?.description ?? '',
    productCapabilities: product?.capabilities ?? '',
    sellerCompany: company?.company_name ?? '',
    sellerSummary: company?.summary ?? '',
    senderName: (data as { sender_name?: string }).sender_name ?? '',
    senderTitle: (data as { sender_title?: string }).sender_title ?? '',
    emailLength: ((data as { email_length?: string }).email_length ?? 'standard') as CampaignContext['emailLength'],
    emailTone: ((data as { email_tone?: string }).email_tone ?? 'formal') as CampaignContext['emailTone'],
  };
}
