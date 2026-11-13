import { Repo } from '@/storage/repo';
import { MockAdapter } from '@/adapter/mock/mock-adapter';
import type { PhotosAdapter } from '@/adapter/types';
import { RemoteAdapter } from './remote-adapter';
import { offscreenAnalyzer, closeOffscreen } from './offscreen-client';
import { newScanJob, runScan } from './jobs/scan-job';
import { runClean } from './jobs/clean-job';
import { isMessage, ok, fail, type UiState } from '@/shared/messages';
import type { Job } from '@/shared/types';
import { formatBytes } from '@/shared/bytes';
import { loadConfig, refreshConfig } from '@/config/remote-config';
import { thumbUrlForSize } from '@/adapter/google/parsers';
import { logger } from '@/shared/log';

const log = logger('background');
const WEEKLY_ALARM = 'weekly-scan';
const CONFIG_ALARM = 'config-refresh';

let repoPromise: Promise<Repo> | null = null;
const repo = () => (repoPromise ??= Repo.open());

let activeJob: Job | null = null;
let stopFlag = false;
let remote: RemoteAdapter | null = null;

async function getAdapter(): Promise<PhotosAdapter> {
  const settings = await (await repo()).getSettings();
  if (settings.useMockAdapter || import.meta.env.VITE_MOCK_ADAPTER === '1') return new MockAdapter();
  remote ??= new RemoteAdapter();
  return remote;
}

async function updateBadge() {
  const r = await repo();
  const summary = await r.getKv('reclaimable');
  if (activeJob?.state === 'running') {
    await chrome.action.setBadgeText({ text: '…' });
    await chrome.action.setBadgeBackgroundColor({ color: '#5f6368' });
    return;
  }
  if (!summary || summary.totalBytes <= 0) {
    await chrome.action.setBadgeText({ text: '' });
    return;
  }
  const gb = summary.totalBytes / 1024 ** 3;
  await chrome.action.setBadgeText({ text: gb >= 10 ? `${Math.round(gb)}G` : gb >= 1 ? `${gb.toFixed(1)}G` : `${Math.round(summary.totalBytes / 1024 ** 2)}M` });
  await chrome.action.setBadgeBackgroundColor({ color: '#1a73e8' });
}

async function startScan(): Promise<Job> {
  if (activeJob && activeJob.state === 'running') return activeJob;
  const r = await repo();
  const settings = await r.getSettings();
  const adapter = await getAdapter();
  const cfg = await loadConfig();
  stopFlag = false;
  const resumable = await r.activeJob();
  let job = resumable?.type === 'scan' && resumable.state === 'paused' ? resumable : newScanJob(`scan-${Date.now()}`);
  activeJob = job;
  await updateBadge();
  log.info('scan starting', job.id, 'adapter', adapter.name);

  job = await runScan(job, {
    adapter,
    repo: r,
    analyzer: offscreenAnalyzer,
    settings,
    shouldStop: () => stopFlag,
    thumbFor: adapter.name === 'google' ? (base, size) => thumbUrlForSize(base, size, size, cfg) : undefined,
    onProgress: (j) => {
      activeJob = j;
      chrome.runtime.sendMessage({ type: 'bg.progress', job: j }).catch(() => {});
    },
  });
  activeJob = job;
  if (remote) await remote.releaseTab();
  await closeOffscreen();
  await updateBadge();
  log.info('scan finished', job.state, job.counts);
  return job;
}

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.alarms.create(WEEKLY_ALARM, { periodInMinutes: 7 * 24 * 60 });
  await chrome.alarms.create(CONFIG_ALARM, { periodInMinutes: 24 * 60 });
  await updateBadge();
});

chrome.runtime.onStartup.addListener(async () => {
  const r = await repo();
  const pending = await r.activeJob();
  if (pending?.state === 'running') {
    // Service worker died mid-job; mark it resumable.
    await r.putJob({ ...pending, state: 'paused' });
  }
  await updateBadge();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === CONFIG_ALARM) {
    await refreshConfig(chrome.runtime.getManifest().version);
  } else if (alarm.name === WEEKLY_ALARM) {
    const settings = await (await repo()).getSettings();
    if (settings.licensed) await startScan().catch((e) => log.error('scheduled scan failed', e));
  }
});

chrome.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse) => {
  if (!isMessage(msg) || !msg.type.startsWith('ui.')) return false;
  (async () => {
    const r = await repo();
    switch (msg.type) {
      case 'ui.getState': {
        const settings = await r.getSettings();
        const job = activeJob ?? (await r.activeJob()) ?? null;
        const state: UiState = {
          job,
          usage: (await r.getKv('usage')) ?? null,
          reclaimable: (await r.getKv('reclaimable')) ?? null,
          adapterHealthy: null,
          licensed: settings.licensed,
          dryRun: settings.dryRun,
        };
        return state;
      }
      case 'ui.startScan': {
        void startScan().catch((e) => log.error(e));
        await new Promise((res) => setTimeout(res, 50));
        return activeJob;
      }
      case 'ui.pauseJob':
      case 'ui.cancelJob':
        stopFlag = true;
        return activeJob;
      case 'ui.resumeJob':
        void startScan().catch((e) => log.error(e));
        return activeJob;
      case 'ui.getGroups':
        return { groups: await r.allGroups(msg.kind) };
      case 'ui.decide': {
        const g = await r.getGroup(msg.groupId);
        if (!g) throw new Error('group not found');
        await r.putGroup({ ...g, decisions: { ...(g.decisions ?? {}), ...msg.decisions }, reviewed: true });
        return true;
      }
      case 'ui.startClean': {
        const settings = await r.getSettings();
        if (!settings.licensed && !settings.dryRun) throw new Error('Cleaning requires the one-time unlock.');
        const groups = (await Promise.all(msg.groupIds.map((id) => r.getGroup(id)))).filter((g): g is NonNullable<typeof g> => !!g);
        const adapter = await getAdapter();
        const job: Job = { id: `clean-${Date.now()}`, type: 'clean', state: 'queued', cursor: null, startedAt: Date.now(), updatedAt: Date.now(), finishedAt: null, error: null, counts: {} };
        const done = await runClean(job, groups, { adapter, repo: r, dryRun: settings.dryRun, delayMs: 750 });
        if (remote) await remote.releaseTab();
        await updateBadge();
        return done;
      }
      case 'ui.openDashboard':
        await chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
        return true;
      case 'ui.runSelfTest': {
        const adapter = await getAdapter();
        const report = await adapter.selfTest();
        if (remote) await remote.releaseTab();
        return report;
      }
    }
  })()
    .then((v) => sendResponse(ok(v)))
    .catch((e) => sendResponse(fail(e)));
  return true;
});

log.info('service worker started', formatBytes(0));
