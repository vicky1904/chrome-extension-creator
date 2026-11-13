import { formatBytes } from '@/shared/bytes';
import { bg } from '../shared/bg';
import { phaseLabel, phaseProgress, useUiState } from '../shared/useUiState';

export function Popup() {
  const { state, error, refresh } = useUiState();
  const job = state?.job ?? null;
  const running = job?.state === 'running';
  const r = state?.reclaimable;

  const start = async () => {
    await bg({ type: running ? 'ui.pauseJob' : 'ui.startScan', ...(running && job ? { jobId: job.id } : {}) } as never);
    await refresh();
  };

  return (
    <div className="stack" style={{ width: 340, padding: 16 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <strong>Photos Storage Cleaner</strong>
        {state?.dryRun && <span className="pill">Dry run</span>}
      </div>

      <div className="card stack">
        <span className="muted">Reclaimable</span>
        <span className="big">{r ? formatBytes(r.totalBytes) : '–'}</span>
        {r && (
          <span className="muted">
            Duplicates {formatBytes(r.duplicatesBytes)} · Similar {formatBytes(r.similarBytes)}
          </span>
        )}
        {state?.usage && (
          <span className="muted">
            Google storage {formatBytes(state.usage.usedBytes)} of {formatBytes(state.usage.limitBytes)}
          </span>
        )}
      </div>

      {running && (
        <div className="stack">
          <span className="muted">{phaseLabel(job)}</span>
          <div className="bar"><span style={{ width: `${phaseProgress(job) * 100}%` }} /></div>
        </div>
      )}
      {job?.state === 'failed' && <span className="error">Scan stopped: {job.error}</span>}
      {job?.warning && <span className="muted">{job.warning}</span>}
      {error && <span className="error">{error}</span>}

      <div className="row">
        <button className="primary" onClick={start}>
          {running ? 'Pause' : job?.state === 'paused' ? 'Resume scan' : 'Scan library'}
        </button>
        <button onClick={() => bg({ type: 'ui.openDashboard' })}>Review results</button>
      </div>
      <span className="muted" style={{ fontSize: 12 }}>
        Photos are analysed on this computer. Nothing is uploaded.
      </span>
    </div>
  );
}
