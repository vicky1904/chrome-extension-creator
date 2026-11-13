import { useEffect, useMemo, useState } from 'react';
import type { Group, Job } from '@/shared/types';
import type { UiGroupsReply } from '@/shared/messages';
import type { SelfTestReport } from '@/adapter/types';
import { formatBytes } from '@/shared/bytes';
import { bg } from '../shared/bg';
import { phaseLabel, phaseProgress, useUiState } from '../shared/useUiState';
import { GroupCard } from './GroupCard';

type Tab = 'duplicate' | 'similar';

export function Dashboard() {
  const { state, refresh } = useUiState();
  const [tab, setTab] = useState<Tab>('duplicate');
  const [groups, setGroups] = useState<Group[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<string | null>(null);
  const [selfTest, setSelfTest] = useState<SelfTestReport | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const r = await bg<UiGroupsReply>({ type: 'ui.getGroups' });
    setGroups(r.groups.sort((a, b) => b.reclaimableBytes - a.reclaimableBytes));
  };
  useEffect(() => { void load(); }, [state?.reclaimable?.computedAt]);

  const shown = useMemo(() => groups.filter((g) => g.kind === tab), [groups, tab]);
  const selectedBytes = shown.filter((g) => selected.has(g.id)).reduce((a, g) => a + g.reclaimableBytes, 0);

  const toggle = (id: string) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const clean = async () => {
    setBusy(true);
    try {
      const job = await bg<Job>({ type: 'ui.startClean', groupIds: [...selected] });
      setResult(
        state?.dryRun
          ? `Dry run: ${job.counts.planned ?? 0} items (${formatBytes(job.counts.plannedBytes ?? 0)}) would move to Trash. Nothing was changed.`
          : `Moved ${job.counts.trashed ?? 0} items to Google Photos Trash. Space is freed when Trash is emptied.`,
      );
      setSelected(new Set());
      await load();
      await refresh();
    } catch (e) {
      setResult(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const job = state?.job ?? null;

  return (
    <div className="stack" style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 16px' }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Review results</h1>
        <div className="row">
          <button onClick={async () => setSelfTest(await bg<SelfTestReport>({ type: 'ui.runSelfTest' }))}>Check connection</button>
          <button className="primary" onClick={() => bg({ type: 'ui.startScan' })}>Rescan</button>
        </div>
      </div>

      {selfTest && (
        <div className="card">
          <strong className={selfTest.ok ? '' : 'error'}>{selfTest.ok ? 'Google Photos connection OK' : 'Needs update: Google changed something'}</strong>
          <ul>{selfTest.checks.map((c) => <li key={c.name} className={c.ok ? 'muted' : 'error'}>{c.name}: {c.ok ? 'ok' : 'failed'} {c.detail ? `(${c.detail})` : ''}</li>)}</ul>
        </div>
      )}

      {job?.state === 'running' && (
        <div className="card stack">
          <span>{phaseLabel(job)}</span>
          <div className="bar"><span style={{ width: `${phaseProgress(job) * 100}%` }} /></div>
        </div>
      )}

      <div className="row">
        <button className={tab === 'duplicate' ? 'primary' : ''} onClick={() => setTab('duplicate')}>
          Duplicates ({groups.filter((g) => g.kind === 'duplicate').length})
        </button>
        <button className={tab === 'similar' ? 'primary' : ''} onClick={() => setTab('similar')}>
          Similar shots ({groups.filter((g) => g.kind === 'similar').length})
        </button>
        <span className="muted">Large videos: {formatBytes(state?.reclaimable?.largeVideosBytes ?? 0)}</span>
      </div>

      <div className="row" style={{ justifyContent: 'space-between', position: 'sticky', top: 0, background: 'var(--bg)', padding: '8px 0', zIndex: 1 }}>
        <span>{selected.size} groups selected · {formatBytes(selectedBytes)}</span>
        <div className="row">
          <button onClick={() => setSelected(new Set(shown.map((g) => g.id)))}>Select all</button>
          <button className="primary" disabled={!selected.size || busy} onClick={clean}>
            {state?.dryRun ? 'Preview clean (dry run)' : 'Move to Trash'}
          </button>
        </div>
      </div>
      {result && <div className="card">{result}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
        {shown.map((g) => (
          <GroupCard key={g.id} group={g} selected={selected.has(g.id)} onToggle={() => toggle(g.id)} onChanged={load} />
        ))}
      </div>
      {shown.length === 0 && <p className="muted">Nothing here yet. Run a scan from the toolbar button.</p>}
    </div>
  );
}
