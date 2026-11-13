# Implementation plan: Photos Storage Cleaner

Status as of 2026-11-13. This plan supersedes the original build brief where
they differ. It folds in the plan review and the owner's decision to favour
accuracy over download size: a larger model downloaded once at runtime is
acceptable if it earns user trust.

---

## 1. Decisions

| Topic | Decision | Why |
|---|---|---|
| Google access | Internal batchexecute RPCs from a content script, not UI automation | Only route that yields file size and the quota flag; UI automation would take hours over 50k items |
| Storage number | `getStorageQuota` RPC | Removes the `identity` permission and an OAuth consent screen |
| Reclaimable number | Counts only items with `takesUpSpace !== false`, minus the keeper | Pre-June-2021 and Pixel-original items free nothing when trashed. Showing them would make the badge lie |
| Exact duplicates | Same dimensions and pHash distance ≤ 2 | Google already blocks byte-identical re-uploads, so real duplicates are metadata-differing copies |
| Similar shots | Accuracy-first: DINOv2-base embeddings, time-windowed, then verified (section 4) | Owner preference. Trust beats download size |
| Model delivery | Weights downloaded once from Hugging Face, cached. ONNX runtime bundled | Weights are data (allowed). Runtime is code (MV3 forbids remote code) |
| Model failure | Scan finishes without the similar pass and says so | Duplicates never depend on the model |
| Permanent delete | Not implemented until the RPC is captured in Milestone 0 | Toolkit has no purge RPC. Until then, tell the user to empty Trash |
| Trash retention | 30 days (Google cut it from 60, reported September 2026) | Copy and timers must say 30 |
| Autopilot destination | Downloads folder only. Custom folders in approval mode only | Restored File System Access handles need a user gesture to re-grant |
| Permissions | `storage`, `unlimitedStorage`, `alarms`, `downloads`, `offscreen`, host access to photos.google.com and googleusercontent.com | `tabs` is not needed: host permission covers URL queries on Photos tabs |

---

## 2. What is already on this branch

Built and tested in this session. "Live" means verified against a real
Google account, which has not happened yet.

| Area | Files | Unit tested | Browser smoke | Live |
|---|---|---|---|---|
| MV3 manifest, Vite build, content script as IIFE | `public/manifest.json`, `vite*.config.ts` | n/a | yes | no |
| Domain types and message protocol | `src/shared/` | via jobs | yes | n/a |
| Remote-refreshable adapter config with validation | `src/config/` | yes | n/a | no |
| batchexecute transport: retries, backoff, pacing, concurrency | `src/adapter/google/batchexecute.ts` | yes | no | no |
| Page token extraction from `WIZ_global_data` | `src/adapter/google/page-globals.ts` | yes | no | no |
| Google adapter and response parsers | `src/adapter/google/` | yes, synthetic fixtures | no | no |
| Mock adapter with fixture library | `src/adapter/mock/` | yes | yes | n/a |
| IndexedDB schema and repository | `src/storage/` | yes | yes | n/a |
| pHash, dHash, sharpness, banded lookup | `src/ml/phash.ts` | yes | yes | n/a |
| Duplicate and similar clustering, best-shot scoring | `src/ml/` | yes | yes | n/a |
| Embedding model registry and transformers.js wrapper | `src/ml/embedding/` | no | load path only | no |
| Offscreen document: decode, hash, embed | `src/offscreen/` | no | hashing yes | no |
| Resumable scan job, graceful model failure | `src/background/jobs/scan-job.ts` | yes | yes | no |
| Clean job with dry run, safety rules, audit log | `src/background/jobs/clean-job.ts` | yes | dry run yes | no |
| Service worker: orchestration, badge, alarms | `src/background/index.ts` | no | yes | no |
| Popup and review dashboard | `src/ui/` | no | yes | no |
| Milestone 0 probe for the owner | `spikes/m0-probe.js` | no | no | pending |

---

## 3. Architecture

```
popup / dashboard (React)
        |  chrome.runtime messages (src/shared/messages.ts)
        v
service worker (src/background)
  - job orchestration, cursor persistence, badge, alarms
  - RemoteAdapter ---- chrome.tabs messages ----> content script on photos.google.com
  |                                                 - reads WIZ_global_data tokens
  |                                                 - GoogleAdapter over batchexecute
  |                                                 - thin relay, no logic
  - offscreen client --- runtime messages ---> offscreen document
                                                 - fetch + decode thumbnails
                                                 - pHash / dHash / sharpness
                                                 - transformers.js on WebGPU or WASM
IndexedDB (src/storage): items, analyses, embeddings, groups, jobs, kv, audit
```

Rules that keep this maintainable:

- Nothing outside `src/adapter/google` and `src/config` knows an RPC id or
  response index.
- Index paths and RPC ids live in a versioned config that can be refreshed
  from a static JSON file. Argument arrays stay in code, because a change to
  them usually changes response shapes too.
- Every phase writes its cursor after each batch, so a killed service worker
  resumes where it stopped.
- Hashing and inference run in the offscreen document, never in the Photos
  tab, which Chrome throttles in the background.

---

## 4. Accuracy-first similar-shot detection

The goal is that a pre-selected "trash" mark is almost never wrong. A user
who finds one good photo marked for deletion stops trusting the product.

### 4.1 Pipeline

1. **Candidate window.** Only stills with another still within
   `similarTimeWindowMin` (default 10 minutes) are embedded. This removes most
   of the library from the expensive step and rules out "same place, different
   day" by construction.
2. **Global embedding.** DINOv2-base, 768 dimensions, mean-pooled, L2
   normalised, stored as int8. Cosine similarity inside the window.
3. **Verification pass (to build in Milestone 3).** For each candidate pair
   above the lower threshold, compute a second, independent signal:
   - patch-level agreement: mutual nearest neighbours between the two images'
     DINO patch tokens, as a fraction of patches. This separates "same scene,
     slightly moved" from "similar-looking scene" far better than one pooled
     vector, and reuses the same forward pass.
   - pHash distance as a cheap sanity check.
4. **Confidence tiers.**
   - High: both signals agree above calibrated thresholds. Group is shown and
     non-keepers are pre-marked for trash.
   - Medium: embedding agrees, verification is borderline. Group is shown,
     nothing pre-marked.
   - Low: hidden.
5. **Best shot.** Deterministic, explainable scoring already implemented:
   favourite, resolution, sharpness, file size, penalties for partial uploads,
   near-black frames and copy-like file names. The dashboard must show the
   reasons next to the keeper.

### 4.2 Model candidates

All have transformers.js-ready ONNX exports on the Hub. Sizes are
approximate and must be confirmed in the bake-off, since huggingface.co was
unreachable from the build environment.

| Model | Params | Dim | Approx download | Role |
|---|---|---|---|---|
| `onnx-community/dinov2-base` | 86M | 768 | ~175 MB fp16, ~90 MB q8 | Default |
| `onnx-community/dinov2-with-registers-base` | 86M | 768 | similar | Challenger: cleaner patch features, may help the verification pass |
| `onnx-community/dinov3-vitb16-pretrain-lvd1689m-ONNX` | 86M | 768 | similar | Challenger. Custom licence, review before shipping |
| `onnx-community/dinov2-large` | 300M | 1024 | ~600 MB fp16 | Accuracy ceiling for the bake-off only, not shippable |
| `onnx-community/dinov2-small` | 22M | 384 | ~45 MB fp16 | Automatic fallback on machines without WebGPU |

CLIP-family models such as MobileCLIP and SigLIP are semantic. They match
"two beach photos" too readily, so they are not candidates for this job.

### 4.3 Bake-off protocol

1. Build a labelled set on the test account: at least 300 positive pairs
   (bursts, re-takes, slight reframes, exposure brackets) and 1,000 hard
   negatives (same event, different subject; same place, different moment).
   Store labels as JSON in `tests/fixtures/bakeoff/`, never the photos.
2. For each model, compute precision and recall at every threshold, with and
   without the verification pass.
3. Pick the threshold where high-tier precision is at least 99 percent. Report
   recall at that point. Prefer the model with the best recall at that
   precision, then the smaller one.
4. Record per-model thresholds in `src/ml/embedding/model-registry.ts` and pin
   the exact Hub `revision` commit so a model update cannot silently change
   behaviour.

### 4.4 Download experience

- Before the first similar-shot scan, show the size, that it downloads once,
  and that photos never leave the device. One click to accept.
- Progress bar from the transformers.js progress callback.
- Cached in Cache Storage. A "Remove AI model" button in settings frees it.
- If the download fails, the scan still completes with duplicates only and
  the popup explains why. This path is implemented and tested.

### 4.5 Throughput budget

| Step | Estimate | Mitigation |
|---|---|---|
| Enumerate 50k items | 100 sequential pages, 1 to 3 minutes | Cursor saved per page |
| Size lookup | 100 batch calls | Batched, paced, resumable |
| Hash 50k thumbnails at 128 px | 10 to 20 minutes | 6 parallel decodes in the offscreen document |
| Embed time-window candidates (typically 10 to 20 percent of stills) | WebGPU base model ~15 to 30 per second | Window filter, int8 storage |
| Same on WASM | Several times slower | Fall back to dinov2-small automatically |

Measure these in Milestone 0 and replace the estimates.

---

## 5. Milestones

Each milestone lists what "done" means. Work against the mock adapter first;
every milestone ends with a run on the test account.

### Milestone 0: verify the Google protocol (owner plus Claude)

Owner runs `spikes/m0-probe.js` in DevTools on photos.google.com with the
**test account**, then sends back the downloaded JSON.

Done when:
- Storage quota, listing, batch media info, item info and trash listing all
  return payloads that the parsers in `src/adapter/google/parsers.ts` read
  correctly. Captures become test fixtures, replacing the synthetic ones.
- `takesUpSpace` behaves as expected on a known pre-2021 item.
- `psc.trashRoundTrip(5)` trashes and restores five items.
- The permanent-delete-from-Trash RPC is captured from the Network panel by
  deleting one item from Trash by hand. Record its id and arguments.
- Original-quality download URL works for one photo and one video, and bytes
  match the reported size.
- Timings for a 1,000-item enumeration and a 500-item size lookup are written
  to `docs/spike-findings.md`.

### Milestone 1: scan MVP

Mostly built. Remaining:
- Run against the live account. Fix any parser paths from Milestone 0.
- Real thumbnails on the dashboard (currently media keys).
- Self-test on every scan start. On failure, stop and show "Needs update".
- Remote config host chosen by the owner; set `REMOTE_CONFIG_URL`.

Done when a 1,000-item test library scans to a correct duplicate list and a
badge number that matches a hand count.

### Milestone 2: clean

- Review grid with thumbnails, keeper reasons, keyboard navigation.
- Dry run on by default. A separate, explicit switch turns it off.
- After a real clean: "Moved N items to Trash. Empty Trash in Google Photos
  to free X." with a link to photos.google.com/trash. Undo button restores the
  last batch via the restore RPC.
- Audit log page.

Done when a full clean on the test account matches the dry run exactly and
undo restores everything.

### Milestone 3: similar shots, accuracy-first

- Bake-off per section 4.3, verification pass, confidence tiers.
- Model download consent and progress UI.
- Pin model revision and thresholds.

Done when high-tier precision is at least 99 percent on the labelled set.

### Milestone 4: licensing

Ask the owner which one-time unlock mechanism Smart Blur uses, and reuse it.
The licence check is the only network call besides Google and the model
download. Scanning and dry runs stay free.

### Milestone 5: offload

Download originals to Downloads/PhotosCleaner/YYYY/MM, verify byte size and
decode, write a manifest, record a local index with thumbnails, then trash
only verified items. Live photos need both the still and the video.

### Milestone 6: autopilot

Weekly alarm, background Photos tab, approval mode for the first runs, then
optional automatic mode. Missed runs happen on next startup.

### Milestone 7: store readiness

Privacy policy, permission justifications, onboarding that explains the
background tab and the model download, final icons, and a release checklist.

---

## 6. Safety rules and where they are enforced

| Rule | Enforcement |
|---|---|
| Dry run by default | `DEFAULT_SETTINGS.dryRun = true` |
| Trash only, never permanent delete | Adapter has no purge method |
| Favourites and protected items never trashed | `planClean`, even if the user marks them |
| A group is never emptied | `planClean` keeps one item back |
| Items that free nothing never count as reclaimable | `cluster.ts`, `summary.ts`, `clean-job.ts` |
| Paced requests | Transport `minIntervalMs`, concurrency gate, clean `delayMs` |
| Every destructive action logged | `audit` store |
| Stop on adapter breakage | Self-test, no retries on 401 or 403 |

Each rule has a unit test in `tests/jobs.test.ts` or `tests/cluster.test.ts`.

---

## 7. Questions for the owner

1. Which one-time payment and licence mechanism does Smart Blur use?
2. Where should the remote config JSON be hosted?
3. Run the Milestone 0 probe on the test account and send back the file.
4. Is roughly 175 MB for the default model acceptable, given the 90 MB WASM
   variant and the 45 MB fallback?
5. Final product name for the store listing.

---

## 8. Working on the code

```
npm install
npm test            # unit and pipeline tests
npm run build       # production build into dist/
npm run build:mock  # build against the fixture library, no Google needed
```

Load `dist/` with "Load unpacked" at chrome://extensions.
