// API response shapes, mirroring the backend DTOs (backend/src/modules/*).
// File URLs (imageUrl, url) are signed paths relative to the API root — pass
// them through apiUrl() before using them in <img src>.

export type Role = 'admin' | 'member';
export interface User { id: number; email: string; name: string; role: Role; orgId: number }
export interface OrgBranding { mark: string; title: string; subtitle: string; color: string }
export interface Org { id: number; name: string; branding: OrgBranding }
export interface Session { token: string; user: User; org: Org }

export interface LandedCostSettings { commissionDivisor: number; freightPerContainer: number; defaultEtc: number }
export interface OrgSettings extends Org { allowedDomains: string[]; landedCost: LandedCostSettings }
export interface Member { id: number; email: string; name: string; role: Role; createdAt: string }
export interface Invite { id: number; email: string; role: Role; expiresAt: string; usedAt: string | null; createdAt: string; inviteUrl?: string }

export interface DivisionFormat { packCounts: boolean }
export interface Project {
  id: number; name: string; buyer: string | null; division: string | null; status: string;
  lastPrice: number | null; format: DivisionFormat; landedCost?: LandedCostSettings;
  counts?: { items: number; factories: number; submitted: number; quotes: number };
  createdAt: string; updatedAt: string;
}
export interface Page<T> { items: T[]; total: number; limit: number; offset: number }

export interface ItemImage { position: number; url: string | null }
export interface Item {
  id: number; position: number; styleNum: string | null; description: string | null;
  moq: number | null; targetPrice: number | null; innerPack: number | null; masterPack: number | null;
  cadId: number | null; imageUrl: string | null; images: ItemImage[]; deletedAt: string | null;
}
export interface Quote {
  id: number; itemId: number | null; projectFactoryId: number;
  factory: { id: number; name: string; submitted: boolean };
  price: number | null; moq: number | null; leadTime: string | null;
  styleNum: string | null; description: string | null; imageUrl: string | null;
  notes: string | null; isWinner: boolean; submittedAt: string | null; updatedAt: string;
}
export interface CompareSheet { format: DivisionFormat; items: (Item & { quotes: Quote[] })[]; unmatched: Quote[] }
export interface Cad { id: number; name: string | null; contentType: string | null; createdAt: string; url: string | null }

export interface Factory {
  id: number; name: string; emails: string[]; contactName: string | null; divisions: string[];
  projectCount: number; createdAt: string; updatedAt: string;
}
export type InviteStatus = 'pending' | 'no_response' | 'submitted';
export interface InvitedFactory {
  id: number; factory: { id: number; name: string; emails: string[]; contactName: string | null };
  status: InviteStatus; invitedAt: string; submittedAt: string | null; lastEmailedAt: string | null;
  itemsReceived: number; totalItems: number; portalUrl: string | null; linkExpiresAt: string | null;
}
export interface VendorLink {
  id: number; url: string; purpose: 'quote' | 'revision'; status: 'active' | 'submitted' | 'expired';
  expiresAt: string; usedAt: string | null; createdAt: string;
  project: { id: number; name: string }; projectFactoryId: number; factoryName: string;
}

export interface LandedCostInputs {
  totalFob: number | null; baseDutyPct: number | null; addlDutyPct: number | null; unitsPerContainer: number | null;
  sellPrice: number | null; retailPrice: number | null; etcAmount: number | null;
}
export interface LandedCostComputed {
  totalFob: number | null; vsrFob: number | null; commission: number | null; dutyPerUnit: number | null;
  totalDutyPct: number; freightPerUnit: number | null; freightPct: number | null; etc: number;
  landed: number | null; marginPct: number | null; imuPct: number | null;
}
export interface LandedCostRow {
  quoteId: number; itemId: number; position: number; styleNum: string | null; description: string | null;
  factory: { id: number; name: string }; price: number | null; inputs: LandedCostInputs; computed: LandedCostComputed;
}
export interface LandedCostSheet { settings: LandedCostSettings; rows: LandedCostRow[] }

export type EmailType = 'vendor_invite' | 'follow_up_reminder' | 'revision_request' | 'comparison_ready';
export interface EmailDraft {
  key: string; type: EmailType; projectFactoryId: number | null; factoryName: string | null; contactName?: string | null;
  to: string[]; status: string; lastSentAt: string | null; portalUrl: string | null; itemsAbove?: number;
  subject: string; body: string;
}
export interface EmailDrafts { inviteTemplate: { subject: string; body: string }; senderName: string; drafts: EmailDraft[] }
export interface EmailTemplate { type: Exclude<EmailType, never>; subject: string; body: string; isCustom: boolean }

export type JobState = 'queued' | 'running' | 'succeeded' | 'failed';
export interface Job {
  id: number; type: string; state: JobState; progress: number; message: string | null;
  result: Record<string, unknown> | null; error: string | null; projectId: number | null;
  createdAt: string; finishedAt: string | null;
}

export interface PortalItem {
  id: number; position: number; styleNum: string | null; description: string | null; targetMoq: number | null;
  innerPack?: number | null; masterPack?: number | null; imageUrl: string | null;
  quote: { price: number | null; moq: number | null; leadTime: string | null } | null;
}
export type PortalView =
  | { status: 'valid'; purpose: 'quote' | 'revision'; factoryName: string; projectName: string; format: DivisionFormat; expiresAt: string; items: PortalItem[] }
  | { status: 'used'; factoryName: string; projectName: string }
  | { status: 'expired'; factoryName: string; projectName: string }
  | { status: 'invalid' };
