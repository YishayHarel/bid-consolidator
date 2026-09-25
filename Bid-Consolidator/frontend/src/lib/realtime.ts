// Live updates. Connects to the backend WebSocket, authenticates with the first
// message (never the URL), reconnects with backoff, and turns server events
// into cache refreshes + notifications: a factory submitting refreshes that
// project's compare sheet; job progress updates the job cache.
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { API_BASE, tokenStore } from '../api/client';
import { qk } from '../api/hooks';
import type { Job } from '../api/types';

type ServerEvent =
  | { type: 'ready' }
  | { type: 'quote:new'; projectId: number; projectName: string; factoryName: string }
  | { type: 'job:update'; job: Pick<Job, 'id' | 'type' | 'state' | 'progress' | 'message' | 'projectId'> };

function wsUrl(): string {
  const override = import.meta.env.VITE_WS_URL as string | undefined;
  if (override) return override;
  if (/^https?:/.test(API_BASE)) return API_BASE.replace(/^http/, 'ws').replace(/\/api$/, '') + '/ws';
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`; // dev: Vite proxies /ws
}

export function useRealtime(enabled: boolean, onQuote: (e: { projectId: number; projectName: string; factoryName: string }) => void) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let closed = false;

    const connect = () => {
      const token = tokenStore.get();
      if (!token || closed) return;
      ws = new WebSocket(wsUrl());
      ws.onopen = () => ws?.send(JSON.stringify({ type: 'auth', token }));
      ws.onmessage = (msg) => {
        let e: ServerEvent;
        try { e = JSON.parse(String(msg.data)) as ServerEvent; } catch { return; }
        if (e.type === 'ready') attempt = 0;
        if (e.type === 'quote:new') {
          for (const key of [qk.compare(e.projectId), qk.invited(e.projectId), qk.drafts(e.projectId), qk.landed(e.projectId), qk.project(e.projectId), qk.projects]) {
            void qc.invalidateQueries({ queryKey: key });
          }
          onQuote(e);
        }
        if (e.type === 'job:update') {
          qc.setQueryData<Job>(qk.job(e.job.id), (old) => (old ? { ...old, ...e.job } : old));
          if (e.job.projectId) {
            void qc.invalidateQueries({ queryKey: qk.jobs(e.job.projectId) });
            if (e.job.state === 'succeeded') {
              for (const key of [qk.compare(e.job.projectId), qk.cads(e.job.projectId), qk.invited(e.job.projectId), qk.landed(e.job.projectId), qk.projects]) {
                void qc.invalidateQueries({ queryKey: key });
              }
            }
          }
        }
      };
      ws.onclose = (ev) => {
        if (closed || ev.code === 4401) return; // signed out / bad token: stop
        timer = setTimeout(connect, Math.min(30_000, 1000 * 2 ** attempt++));
      };
    };
    connect();
    return () => { closed = true; clearTimeout(timer); ws?.close(); };
  }, [enabled, qc, onQuote]);
}
