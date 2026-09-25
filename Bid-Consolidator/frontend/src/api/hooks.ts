// Server state lives in React Query: one cache, shared across pages, with
// targeted invalidation after every mutation — so the compare sheet, factory
// list, landed cost, etc. always agree, and switching pages never refetches
// (or forgets) the current project.
import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { api } from './client';
import type {
  Cad, CompareSheet, EmailDrafts, EmailTemplate, EmailType, Factory, InvitedFactory, Invite, Item, Job,
  LandedCostInputs, LandedCostSheet, LandedCostSettings, Member, OrgSettings, Page, PortalView, Project,
  Quote, VendorLink,
} from './types';

export const qk = {
  me: ['me'] as const,
  projects: ['projects'] as const,
  project: (id: number) => ['project', id] as const,
  compare: (id: number) => ['compare', id] as const,
  deletedItems: (id: number) => ['items-deleted', id] as const,
  cads: (id: number) => ['cads', id] as const,
  invited: (id: number) => ['invited', id] as const,
  landed: (id: number) => ['landed', id] as const,
  drafts: (id: number) => ['drafts', id] as const,
  jobs: (id: number) => ['jobs', id] as const,
  job: (id: number) => ['job', id] as const,
  templates: ['templates'] as const,
  factories: ['factories'] as const,
  vendorLinks: ['vendor-links'] as const,
  org: ['org'] as const,
  members: ['members'] as const,
  invites: ['invites'] as const,
  portal: (token: string) => ['portal', token] as const,
};

function useInvalidate() {
  const qc = useQueryClient();
  return (...keys: QueryKey[]) => Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: k })));
}
/** Everything that depends on a project's items/quotes. */
const projectKeys = (id: number): QueryKey[] =>
  [qk.compare(id), qk.deletedItems(id), qk.invited(id), qk.landed(id), qk.drafts(id), qk.project(id), qk.projects];

// ---- Projects ---------------------------------------------------------------------
export const useProjects = () => useQuery({ queryKey: qk.projects, queryFn: () => api.get<Page<Project>>('/projects?limit=200') });
export const useProject = (id: number) => useQuery({ queryKey: qk.project(id), queryFn: () => api.get<Project>(`/projects/${id}`) });

export function useCreateProject() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (body: { name: string; buyer?: string | null; division?: string | null }) => api.post<Project>('/projects', body),
    onSuccess: () => inv(qk.projects),
  });
}
export function useUpdateProject(id: number) {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (body: Partial<Pick<Project, 'name' | 'buyer' | 'division' | 'status'>> & { lastPrice?: number | null; landedCost?: Partial<LandedCostSettings> }) =>
      api.patch<Project>(`/projects/${id}`, body),
    onSuccess: () => inv(qk.project(id), qk.projects, qk.compare(id), qk.landed(id)),
  });
}
export function useDeleteProject() {
  const inv = useInvalidate();
  return useMutation({ mutationFn: (id: number) => api.delete(`/projects/${id}`), onSuccess: () => inv(qk.projects) });
}

// ---- Compare sheet / items -----------------------------------------------------------
export const useCompare = (id: number) => useQuery({ queryKey: qk.compare(id), queryFn: () => api.get<CompareSheet>(`/projects/${id}/compare`) });
export const useDeletedItems = (id: number) => useQuery({ queryKey: qk.deletedItems(id), queryFn: () => api.get<Item[]>(`/projects/${id}/items/deleted`) });
export const useCads = (id: number) => useQuery({ queryKey: qk.cads(id), queryFn: () => api.get<Cad[]>(`/projects/${id}/cads`) });

export type ItemPatch = Partial<Pick<Item, 'styleNum' | 'description' | 'moq' | 'targetPrice' | 'innerPack' | 'masterPack' | 'cadId'>>;

export function useCreateItem(projectId: number) {
  const inv = useInvalidate();
  return useMutation({ mutationFn: (body: ItemPatch) => api.post<Item>(`/projects/${projectId}/items`, body), onSuccess: () => inv(...projectKeys(projectId)) });
}
export function useUpdateItem(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, patch }: { itemId: number; patch: ItemPatch }) => api.patch<Item>(`/projects/${projectId}/items/${itemId}`, patch),
    // Patch the cached sheet in place (no refetch flicker while typing).
    onSuccess: (item) => {
      qc.setQueryData<CompareSheet>(qk.compare(projectId), (s) => s && { ...s, items: s.items.map((i) => (i.id === item.id ? { ...i, ...item } : i)) });
      void qc.invalidateQueries({ queryKey: qk.landed(projectId) });
    },
  });
}
export function useDeleteItem(projectId: number) {
  const inv = useInvalidate();
  return useMutation({ mutationFn: (itemId: number) => api.delete(`/projects/${projectId}/items/${itemId}`), onSuccess: () => inv(...projectKeys(projectId)) });
}
export function useRestoreItem(projectId: number) {
  const inv = useInvalidate();
  return useMutation({ mutationFn: (itemId: number) => api.post<Item>(`/projects/${projectId}/items/${itemId}/restore`), onSuccess: () => inv(...projectKeys(projectId)) });
}

// ---- Quotes ---------------------------------------------------------------------------------
export function useUpdateQuote(projectId: number) {
  const qc = useQueryClient();
  const inv = useInvalidate();
  return useMutation({
    mutationFn: ({ quoteId, patch }: { quoteId: number; patch: Partial<LandedCostInputs> & { notes?: string | null; itemId?: number } }) =>
      api.patch<Quote>(`/projects/${projectId}/quotes/${quoteId}`, patch),
    onSuccess: (quote, vars) => {
      if (vars.patch.itemId !== undefined) return inv(qk.compare(projectId), qk.landed(projectId));
      qc.setQueryData<CompareSheet>(qk.compare(projectId), (s) => s && {
        ...s,
        items: s.items.map((i) => ({ ...i, quotes: i.quotes.map((q) => (q.id === quote.id ? quote : q)) })),
      });
      return inv(qk.landed(projectId));
    },
  });
}
export function useSetWinner(projectId: number) {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: ({ itemId, quoteId }: { itemId: number; quoteId: number | null }) => api.put(`/projects/${projectId}/items/${itemId}/winner`, { quoteId }),
    onSuccess: () => inv(qk.compare(projectId), qk.landed(projectId)),
  });
}
export function useDeleteQuote(projectId: number) {
  const inv = useInvalidate();
  return useMutation({ mutationFn: (quoteId: number) => api.delete(`/projects/${projectId}/quotes/${quoteId}`), onSuccess: () => inv(...projectKeys(projectId)) });
}
export const useLandedCost = (id: number) => useQuery({ queryKey: qk.landed(id), queryFn: () => api.get<LandedCostSheet>(`/projects/${id}/landed-cost`) });

// ---- Uploads / jobs ------------------------------------------------------------------------------
export function useUpload(projectId: number) {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: ({ kind, files, fields }: { kind: 'excel' | 'cads' | 'quote'; files: File[]; fields?: Record<string, string> }) => {
      const fd = new FormData();
      if (kind === 'cads') files.forEach((f) => fd.append('files', f));
      else fd.append('file', files[0]!);
      for (const [k, v] of Object.entries(fields ?? {})) fd.append(k, v);
      const path = kind === 'excel' ? 'items/import-excel' : kind === 'cads' ? 'cads' : 'quotes/import';
      return api.post<Job | { job: Job | null; createdItems: number; ai: boolean }>(`/projects/${projectId}/${path}`, fd);
    },
    onSuccess: () => inv(qk.jobs(projectId), qk.cads(projectId), ...projectKeys(projectId)),
  });
}
export function useDetectItems(projectId: number) {
  const inv = useInvalidate();
  return useMutation({ mutationFn: () => api.post<Job>(`/projects/${projectId}/detect-items`), onSuccess: () => inv(qk.jobs(projectId)) });
}
/** One job, polled until it finishes (WebSocket updates also land in this cache). */
export const useJob = (id: number) =>
  useQuery({
    queryKey: qk.job(id),
    queryFn: () => api.get<Job>(`/jobs/${id}`),
    refetchInterval: (q) => (q.state.data && ['succeeded', 'failed'].includes(q.state.data.state) ? false : 1500),
  });

/** Active jobs for a project; polls while any are running (WebSocket also nudges it). */
export const useActiveJobs = (projectId: number) =>
  useQuery({
    queryKey: qk.jobs(projectId),
    queryFn: () => api.get<Job[]>(`/jobs?projectId=${projectId}&active=true`),
    refetchInterval: (q) => ((q.state.data?.length ?? 0) > 0 ? 2000 : false),
  });

// ---- Factories on a project ------------------------------------------------------------------------
export const useInvited = (id: number) => useQuery({ queryKey: qk.invited(id), queryFn: () => api.get<InvitedFactory[]>(`/projects/${id}/factories`) });
export function useInviteFactories(projectId: number) {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (body: { factoryIds?: number[]; newFactories?: { name: string; emails?: string[]; contactName?: string | null }[] }) =>
      api.post<{ invited: number; factories: InvitedFactory[] }>(`/projects/${projectId}/factories`, body),
    onSuccess: () => inv(qk.invited(projectId), qk.factories, qk.vendorLinks, qk.drafts(projectId), qk.project(projectId), qk.projects),
  });
}
export function useRemoveInvited(projectId: number) {
  const inv = useInvalidate();
  return useMutation({ mutationFn: (pfId: number) => api.delete(`/projects/${projectId}/factories/${pfId}`), onSuccess: () => inv(...projectKeys(projectId), qk.vendorLinks, qk.factories) });
}
export function useNewLink(projectId: number) {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (pfId: number) => api.post<{ portalUrl: string; expiresAt: string }>(`/projects/${projectId}/factories/${pfId}/link`),
    onSuccess: () => inv(qk.invited(projectId), qk.vendorLinks, qk.drafts(projectId)),
  });
}

// ---- Emails ---------------------------------------------------------------------------------------------
export const useDrafts = (id: number) => useQuery({ queryKey: qk.drafts(id), queryFn: () => api.get<EmailDrafts>(`/projects/${id}/emails/drafts`) });
export function useSendEmail(projectId: number) {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (body: { type: EmailType; projectFactoryId?: number; subject: string; body: string; dueDate?: string }) =>
      api.post<{ sent: boolean; to: string[] }>(`/projects/${projectId}/emails/send`, body),
    onSuccess: () => inv(qk.drafts(projectId), qk.invited(projectId), qk.vendorLinks),
  });
}
export function usePrepareLink(projectId: number) {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (body: { projectFactoryId: number; type: Exclude<EmailType, 'comparison_ready'> }) =>
      api.post<{ portalUrl: string }>(`/projects/${projectId}/emails/link`, body),
    onSuccess: () => inv(qk.vendorLinks),
  });
}
export const useTemplates = () => useQuery({ queryKey: qk.templates, queryFn: () => api.get<EmailTemplate[]>('/email-templates') });
export function useSaveTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ type, subject, body }: { type: string; subject: string; body: string }) => api.put<EmailTemplate>(`/email-templates/${type}`, { subject, body }),
    onSuccess: () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'templates' || q.queryKey[0] === 'drafts' }),
  });
}
export function useResetTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (type: string) => api.delete<EmailTemplate>(`/email-templates/${type}`),
    onSuccess: () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'templates' || q.queryKey[0] === 'drafts' }),
  });
}

// ---- Factory directory ------------------------------------------------------------------------------------
export const useFactories = () => useQuery({ queryKey: qk.factories, queryFn: () => api.get<Factory[]>('/factories') });
export function useSaveFactory() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: ({ id, ...body }: { id?: number; name?: string; emails?: string[] | string; contactName?: string | null; divisions?: string[] }) =>
      id ? api.patch<Factory>(`/factories/${id}`, body) : api.post<Factory>('/factories', body),
    onSuccess: () => inv(qk.factories),
  });
}
export function useDeleteFactory() {
  const inv = useInvalidate();
  return useMutation({ mutationFn: (id: number) => api.delete(`/factories/${id}`), onSuccess: () => inv(qk.factories) });
}

// ---- Vendor links -------------------------------------------------------------------------------------------
export const useVendorLinks = () => useQuery({ queryKey: qk.vendorLinks, queryFn: () => api.get<VendorLink[]>('/vendor-links') });
export function useRevokeLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete(`/vendor-links/${id}`),
    onSuccess: () => qc.invalidateQueries({ predicate: (q) => ['vendor-links', 'invited', 'drafts'].includes(String(q.queryKey[0])) }),
  });
}

// ---- Org (admin) ------------------------------------------------------------------------------------------------
export const useOrgSettings = () => useQuery({ queryKey: qk.org, queryFn: () => api.get<OrgSettings>('/org') });
export function useUpdateOrg() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (body: { name?: string; allowedDomains?: string[]; landedCost?: Partial<LandedCostSettings>; branding?: Partial<OrgSettings['branding']> }) =>
      api.patch<OrgSettings>('/org', body),
    onSuccess: () => inv(qk.org, qk.me),
  });
}
export const useMembers = (enabled: boolean) => useQuery({ queryKey: qk.members, queryFn: () => api.get<Member[]>('/org/members'), enabled });
export function useSetRole() {
  const inv = useInvalidate();
  return useMutation({ mutationFn: ({ userId, role }: { userId: number; role: 'admin' | 'member' }) => api.patch(`/org/members/${userId}`, { role }), onSuccess: () => inv(qk.members) });
}
export const useInvites = (enabled: boolean) => useQuery({ queryKey: qk.invites, queryFn: () => api.get<Invite[]>('/org/invites'), enabled });
export function useCreateInvite() {
  const inv = useInvalidate();
  return useMutation({ mutationFn: (body: { email: string; role: 'admin' | 'member' }) => api.post<Invite>('/org/invites', body), onSuccess: () => inv(qk.invites) });
}
export function useRevokeInvite() {
  const inv = useInvalidate();
  return useMutation({ mutationFn: (id: number) => api.delete(`/org/invites/${id}`), onSuccess: () => inv(qk.invites) });
}

// ---- Factory portal (public) ----------------------------------------------------------------------------------------
export const usePortal = (token: string) =>
  useQuery({ queryKey: qk.portal(token), queryFn: () => api.public.get<PortalView>(`/portal/${token}`), enabled: !!token, retry: false });
