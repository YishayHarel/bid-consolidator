// Follows background jobs started from this page and reports the outcome —
// including failures, which would otherwise vanish silently once the job
// leaves the "active" list.
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { qk, useJob } from '../api/hooks';
import type { Job } from '../api/types';
import { useFeedback } from './feedback';

function summarize(job: Job): string {
  const r = (job.result ?? {}) as Record<string, number | string>;
  switch (job.type) {
    case 'import-excel': return `Imported ${r.created ?? 0} item${r.created === 1 ? '' : 's'}${r.photos ? ` with ${r.photos} photo${r.photos === 1 ? '' : 's'}` : ''}.`;
    case 'detect-items': return `Found ${r.created ?? 0} item${r.created === 1 ? '' : 's'} in your designs.`;
    case 'import-quotes': return `${r.factory ?? 'Factory'}: ${r.matched ?? 0} row${r.matched === 1 ? '' : 's'} matched${r.unmatched ? `, ${r.unmatched} to place by hand` : ''}${r.seededItems ? ` (created ${r.seededItems} items)` : ''}.`;
    default: return 'Done.';
  }
}

function Watch({ id, projectId, onDone }: { id: number; projectId: number; onDone: (id: number) => void }) {
  const job = useJob(id);
  const { toast } = useFeedback();
  const qc = useQueryClient();
  const reported = useRef(false);
  useEffect(() => {
    const j = job.data;
    if (!j || reported.current || (j.state !== 'succeeded' && j.state !== 'failed')) return;
    reported.current = true;
    if (j.state === 'succeeded') toast(summarize(j), 'success');
    else toast(j.error ?? 'The import failed — please try again.', 'error');
    for (const key of [qk.compare(projectId), qk.cads(projectId), qk.jobs(projectId), qk.invited(projectId), qk.landed(projectId), qk.projects]) {
      void qc.invalidateQueries({ queryKey: key });
    }
    onDone(id);
  }, [job.data, id, projectId, onDone, qc, toast]);
  return null;
}

export function useJobWatcher(projectId: number) {
  const [ids, setIds] = useState<number[]>([]);
  const watch = useCallback((job: Pick<Job, 'id'> | null | undefined) => { if (job) setIds((x) => [...x, job.id]); }, []);
  const done = useCallback((id: number) => setIds((x) => x.filter((y) => y !== id)), []);
  const watchers = ids.map((id) => <Watch key={id} id={id} projectId={projectId} onDone={done} />);
  return { watch, watchers };
}
