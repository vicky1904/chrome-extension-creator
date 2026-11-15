# Photos Storage Cleaner

A Chrome extension that frees Google storage without a subscription. It finds
duplicate and similar Google Photos with on-device AI, moves them to Google
Photos Trash after you review them, and later can offload old items to your
own drive.

Photos never leave your computer. Hashing and the similarity model run
locally in an offscreen document. The only network traffic is to Google
Photos itself and a one-time model download from the Hugging Face Hub.

Read [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) before
changing code. It records the decisions, what is built, what is unverified,
and the milestones.

## Quick start

```
npm install
npm test
npm run build:mock   # fixture library, no Google account needed
```

Open chrome://extensions, enable Developer mode, choose "Load unpacked" and
select `dist/`. Click the toolbar icon and run a scan.

`npm run build` produces the real build that talks to photos.google.com.
Use a dedicated test Google account until Milestone 0 is complete.

## Layout

```
src/adapter/      all Google Photos knowledge, plus a mock adapter
src/config/       remotely refreshable RPC ids and response paths
src/background/   service worker: jobs, badge, alarms
src/content/      thin relay running in the photos.google.com tab
src/offscreen/    thumbnail decoding, hashing, model inference
src/ml/           perceptual hashes, clustering, best-shot scoring, models
src/storage/      IndexedDB schema and repository
src/ui/           popup and review dashboard
spikes/           Milestone 0 probe to run on the test account
tests/            unit and pipeline tests (vitest, fake-indexeddb)
```

## Safety defaults

Dry run is on by default. Items only ever go to Google Photos Trash.
Favourites are never touched. A group is never emptied. Items that do not
count against your quota are never counted as reclaimable.

See [NOTICE.md](NOTICE.md) for third-party credits and model licences.
