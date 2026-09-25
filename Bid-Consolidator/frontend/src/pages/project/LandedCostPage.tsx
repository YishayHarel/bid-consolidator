// Landed cost for each item's winning quote. All math runs on the server with
// the org's constants (overridable per project) — nothing is hardcoded here.
// Inputs autosave on blur; computed columns refresh from the server.
import { useOutletContext } from 'react-router';
import { errorMessage } from '../../api/client';
import { useLandedCost, useUpdateProject, useUpdateQuote } from '../../api/hooks';
import type { LandedCostInputs, LandedCostRow, Project } from '../../api/types';
import { useFeedback } from '../../components/feedback';
import { Card, EmptyState, ErrorBox, InlineInput, Loading } from '../../components/ui';
import { field, money, pct, toNum } from '../../lib/format';
import { useProjectId } from './ProjectLayout';

const INPUTS: { key: keyof LandedCostInputs; label: string; hint?: string }[] = [
  { key: 'totalFob', label: 'Total FOB', hint: 'defaults to quoted price' },
  { key: 'baseDutyPct', label: 'Duty %' },
  { key: 'addlDutyPct', label: 'Addl duty %' },
  { key: 'unitsPerContainer', label: "Units / 40'" },
  { key: 'etcAmount', label: 'Etc. $' },
  { key: 'sellPrice', label: 'Sell $' },
  { key: 'retailPrice', label: 'Retail $' },
];

export default function LandedCostPage() {
  const projectId = useProjectId();
  const project = useOutletContext<Project>();
  const sheet = useLandedCost(projectId);
  const updateQuote = useUpdateQuote(projectId);
  const updateProject = useUpdateProject(projectId);
  const { toast } = useFeedback();

  if (sheet.isPending) return <Loading />;
  if (sheet.isError) return <ErrorBox error={sheet.error} onRetry={() => sheet.refetch()} />;
  const { rows, settings } = sheet.data;

  const saveInput = (row: LandedCostRow, key: keyof LandedCostInputs, v: string) => {
    const n = toNum(v);
    if (v.trim() !== '' && n === null) return toast('Enter a number', 'error');
    updateQuote.mutate({ quoteId: row.quoteId, patch: { [key]: n } }, { onError: (e) => toast(errorMessage(e), 'error') });
  };
  const saveSetting = (key: 'commissionDivisor' | 'freightPerContainer', v: string) => {
    const n = toNum(v);
    if (n === null || n <= 0) return toast('Enter a positive number', 'error');
    updateProject.mutate({ landedCost: { [key]: n } }, { onSuccess: () => toast('Constant updated for this project'), onError: (e) => toast(errorMessage(e), 'error') });
  };

  return (
    <div className="stack">
      <Card title="Constants for this project">
        <div className="constants">
          <label className="mini-field"><span>Commission divisor</span>
            <InlineInput value={field(settings.commissionDivisor)} onSave={(v) => saveSetting('commissionDivisor', v)} />
          </label>
          <label className="mini-field"><span>Freight per 40' container</span>
            <InlineInput value={field(settings.freightPerContainer)} onSave={(v) => saveSetting('freightPerContainer', v)} />
          </label>
          <span className="muted small">Org defaults are set in Settings. VSR FOB = Total FOB ÷ divisor; freight/unit = container cost ÷ units.</span>
        </div>
      </Card>

      {rows.length === 0 ? (
        <EmptyState title="No winners selected yet">Pick a winning quote for each item on the Compare sheet and it appears here for landed-cost math.</EmptyState>
      ) : (
        <div className="table-wrap card">
          <table className="table table--dense">
            <thead>
              <tr className="group-row">
                <th colSpan={3}>Product</th>
                <th colSpan={INPUTS.length} className="grp-input">Inputs (enter in VSR)</th>
                <th colSpan={6} className="grp-auto">Calculated</th>
                <th colSpan={2} className="grp-margin">Margins</th>
              </tr>
              <tr>
                <th>Style #</th><th>Description</th><th>Factory</th>
                {INPUTS.map((i) => <th key={i.key} className="grp-input" title={i.hint}>{i.label}</th>)}
                <th className="grp-auto">VSR FOB</th><th className="grp-auto">Commission</th><th className="grp-auto">Duty</th>
                <th className="grp-auto">Freight / unit</th><th className="grp-auto">Freight %</th><th className="grp-auto">Landed each</th>
                <th className="grp-margin">Margin</th><th className="grp-margin">IMU</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.quoteId}>
                  <td><strong>{r.styleNum ?? `Item ${r.position + 1}`}</strong></td>
                  <td className="wrap small">{r.description ?? '—'}</td>
                  <td>{r.factory.name}<div className="muted small">quoted {money(r.price)}</div></td>
                  {INPUTS.map((i) => (
                    <td key={i.key} className="grp-input">
                      <InlineInput className="num" value={field(r.inputs[i.key])} placeholder={i.key === 'totalFob' ? field(r.price) : i.key === 'etcAmount' ? field(project.landedCost?.defaultEtc ?? 0.1) : '—'}
                        onSave={(v) => saveInput(r, i.key, v)} />
                    </td>
                  ))}
                  <td className="num">{money(r.computed.vsrFob, 4)}</td>
                  <td className="num">{money(r.computed.commission, 4)}</td>
                  <td className="num">{money(r.computed.dutyPerUnit, 4)}</td>
                  <td className="num">{money(r.computed.freightPerUnit, 4)}</td>
                  <td className="num">{pct(r.computed.freightPct)}</td>
                  <td className="num strong">{money(r.computed.landed, 4)}</td>
                  <td className="num">{pct(r.computed.marginPct)}</td>
                  <td className="num">{pct(r.computed.imuPct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
