import { db } from '../lib/supabase.js';

/**
 * What the seller is selling, and who they are. Fetched once per campaign, not per prospect.
 */
export type CampaignContext = {
  campaignId: string;
  productName: string;
  productDescription: string;
  productCapabilities: string;
  productUseCases: string;
  productTechnicalSpecs: string;
  sellerCompany: string;
  sellerSummary: string;
  senderName: string;
  senderTitle: string;
  emailLength: 'short' | 'medium' | 'long';
  emailTone: 'company_default' | 'formal' | 'technical' | 'warm' | 'direct' | 'friendly' | 'casual';
  callToAction: string;
  campaignGoal: string;
  additionalInstructions: string;
  objective: string;
};

export async function loadCampaignContext(campaignId: string): Promise<CampaignContext> {
  const { data, error } = await db
    .from('campaigns')
    .select(`
      id,
      sender_name,
      sender_title,
      email_length,
      email_tone,
      objective,
      internal_notes,
      call_to_action,
      campaign_goal,
      additional_instructions,
      products ( name, description, capabilities, use_cases, technical_specs ),
      companies ( company_name, summary )
    `)
    .eq('id', campaignId)
    .single();

  // Return default context if campaign not found (allows testing without pre-seeding DB)
  if (error || !data) {
    return {
      campaignId,
      productName: 'Your Product',
      productDescription: 'A quality product or service',
      productCapabilities: 'Delivers value to customers',
      sellerCompany: 'Trooly',
      sellerSummary: 'We help organizations find talent',
      senderName: 'Sender',
      senderTitle: 'Hiring Manager',
      emailLength: 'standard',
      emailTone: 'professional',
    };
  }

  const product = (Array.isArray(data.products) ? data.products[0] : data.products) as
    | { name: string; description: string; capabilities: string; use_cases: string; technical_specs: string }
    | undefined;
  const company = (Array.isArray(data.companies) ? data.companies[0] : data.companies) as
    | { company_name: string; summary: string }
    | undefined;

  return {
    campaignId,
    productName: product?.name ?? '',
    productDescription: product?.description ?? '',
    productCapabilities: product?.capabilities ?? '',
    productUseCases: product?.use_cases ?? '',
    productTechnicalSpecs: product?.technical_specs ?? '',
    sellerCompany: company?.company_name ?? '',
    sellerSummary: company?.summary ?? '',
    senderName: (data as { sender_name?: string }).sender_name ?? '',
    senderTitle: (data as { sender_title?: string }).sender_title ?? '',
    emailLength: ((data as { email_length?: string }).email_length ?? 'medium') as CampaignContext['emailLength'],
    emailTone: ((data as { email_tone?: string }).email_tone ?? 'company_default') as CampaignContext['emailTone'],
    callToAction: (data as { call_to_action?: string }).call_to_action ?? 'request_a_demo',
    campaignGoal: (data as { campaign_goal?: string }).campaign_goal ?? 'awareness',
    additionalInstructions: (data as { additional_instructions?: string }).additional_instructions ?? '',
    objective: (data as { objective?: string }).objective ?? '',
  };
}