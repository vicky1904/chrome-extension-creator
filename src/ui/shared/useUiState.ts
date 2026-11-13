import { useCallback, useEffect, useState } from 'react';
import type { UiState } from '@/shared/messages';
import type { Job } from '@/shared/types';
import { bg } from './bg';

/** Poll-free state hook: loads once, then listens for progress broadcasts. */
export function useUiState() {
  const [state, setState] = useState<UiState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setState(await bg<UiState>({ type: 'ui.getState' }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const listener = (msg: { type?: string; job?: Job }) => {
      if (msg?.type !== 'bg.progress' || !msg.job) return;
      setState((s) => (s ? { ...s, job: msg.job! } : s));
      if (msg.job.state === 'done' || msg.job.state === 'failed') void refresh();
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [refresh]);

  return { state, error, refresh };
}

export function phaseLabel(job: Job | null): string {
  if (!job?.cursor) return '';
  switch (job.cursor.phase) {
    case 'enumerate': return `Listing library: ${job.counts.enumerated ?? 0} items`;
    case 'sizes': return `Reading sizes: ${job.cursor.processed}/${job.cursor.total ?? '?'}`;
    case 'hash': return `Fingerprinting: ${job.cursor.processed}/${job.cursor.total ?? '?'}`;
    case 'embed': return `Comparing similar shots: ${job.cursor.processed}/${job.cursor.total ?? '?'}`;
    case 'cluster': return 'Grouping results';
    case 'done': return 'Done';
  }
}

export function phaseProgress(job: Job | null): number {
  const c = job?.cursor;
  if (!c || !c.total) return 0;
  return Math.min(1, c.processed / c.total);
}
