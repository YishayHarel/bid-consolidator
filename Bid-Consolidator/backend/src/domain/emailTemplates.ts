// Built-in email formats. A user's saved templates override these per type.
// Bodies use [Placeholder] tokens filled per email:
//   [Contact Name] [Project Name] [Portal Link] [Sender Name] [Items] [Quote Count] [Due Date]
export const TEMPLATE_TYPES = ['vendor_invite', 'follow_up_reminder', 'comparison_ready', 'revision_request'] as const;
export type TemplateType = (typeof TEMPLATE_TYPES)[number];

export const DEFAULT_TEMPLATES: Record<TemplateType, { subject: string; body: string }> = {
  vendor_invite: {
    subject: 'Quote Request: [Project Name]',
    body: `Hi [Contact Name],\n\nWe'd like to invite you to quote on our [Project Name] program.\n\nPlease open the Supplier Portal below and enter your best FOB pricing, MOQ and lead time for each item you'd like to quote. Your entries save as you go — press "Submit my quote" when you're done.\n\nSupplier Portal:\n[Portal Link]\n\nThank you, and we look forward to your quotation.\n\nBest regards,\n[Sender Name]`,
  },
  follow_up_reminder: {
    subject: 'Reminder: Quote Request for [Project Name]',
    body: `Hi [Contact Name],\n\nJust following up — we haven't received your quote for [Project Name] yet, and the deadline is approaching.\n\nPlease submit your best FOB pricing as soon as possible through our Supplier Portal:\n[Portal Link]\n\nThank you!\n[Sender Name]`,
  },
  comparison_ready: {
    subject: 'Quote Comparison Ready: [Project Name]',
    body: `Hi Team,\n\nWe've received [Quote Count] quote(s) for [Project Name]. The comparison is now available in the system.\n\nReview the Compare sheet to see pricing and details.\n\nBest regards,\n[Sender Name]`,
  },
  revision_request: {
    subject: 'Best & Final Pricing Request: [Project Name]',
    body: `Hi [Contact Name],\n\nThank you for submitting your quotation.\n\nAfter reviewing all supplier quotations, we'd like to give you one final opportunity to revise your pricing.\n\nThe following item(s) came in above our current best price:\n\n[Items]\n\nIf you would like to remain competitive for this project, please review your pricing and submit your best and final quotation through the Supplier Portal.\n\nSupplier Portal: [Portal Link]\n\nPlease submit any revised pricing by [Due Date].\n\nThank you, and we look forward to your updated quotation.\n\nBest Regards,\n[Sender Name]`,
  },
};

/** Replace [Token] placeholders present in `vars`; unknown tokens are left as-is. */
export function fillTemplate(text: string, vars: Record<string, string | number | null | undefined>): string {
  let out = text ?? '';
  for (const [k, v] of Object.entries(vars)) out = out.split(`[${k}]`).join(v == null ? '' : String(v));
  return out;
}
