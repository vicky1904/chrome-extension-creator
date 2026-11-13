import type { MediaItem } from '@/shared/types';

/**
 * Deterministic fixture library for development and tests. Includes:
 *  - exact duplicate pairs (same scene, same dims, hash distance 0)
 *  - a burst of 5 near-identical shots
 *  - items that do not take up space (pre-June-2021 backups)
 *  - a favorite inside a duplicate group (must never be trashed)
 *  - large videos
 *  - a live photo
 *
 * Thumbnail URLs point at the extension's own synthetic generator so the
 * offscreen document can hash them without network access.
 */

const HOUR = 3_600_000;
const T0 = Date.UTC(2024, 5, 1, 10, 0, 0);

function item(partial: Partial<MediaItem> & { mediaKey: string; scene: string }): MediaItem {
  const { scene, ...rest } = partial;
  return {
    dedupKey: `dedup-${partial.mediaKey}`,
    takenAt: T0,
    uploadedAt: T0 + HOUR,
    timezoneOffsetMs: 0,
    width: 4032,
    height: 3024,
    durationMs: null,
    isLivePhoto: false,
    isFavorite: false,
    isArchived: false,
    isPartialUpload: false,
    thumbUrl: `mock://thumb/${scene}`,
    sizeBytes: 3_500_000,
    takesUpSpace: true,
    spaceTakenBytes: 3_500_000,
    fileName: `${partial.mediaKey}.jpg`,
    status: 'cloud',
    protected: false,
    ...rest,
  };
}

export const FIXTURE_ITEMS: MediaItem[] = [
  // Exact duplicate pair: same scene, one is a favorite.
  item({ mediaKey: 'dup-a1', scene: 'beach-01', takenAt: T0, isFavorite: true }),
  item({ mediaKey: 'dup-a2', scene: 'beach-01', takenAt: T0 + 30 * 24 * HOUR, fileName: 'IMG_0001 (1).jpg' }),

  // Exact duplicate where the copy does not take up space: zero reclaim.
  item({ mediaKey: 'dup-b1', scene: 'cake-02', takenAt: T0 + 2 * HOUR }),
  item({ mediaKey: 'dup-b2', scene: 'cake-02', takenAt: T0 + 2 * HOUR, takesUpSpace: false, spaceTakenBytes: 0 }),

  // Burst of five similar shots, 2 seconds apart.
  item({ mediaKey: 'burst-1', scene: 'kids-03-v1', takenAt: T0 + 5 * HOUR, sizeBytes: 4_100_000, spaceTakenBytes: 4_100_000 }),
  item({ mediaKey: 'burst-2', scene: 'kids-03-v2', takenAt: T0 + 5 * HOUR + 2000, sizeBytes: 4_000_000, spaceTakenBytes: 4_000_000 }),
  item({ mediaKey: 'burst-3', scene: 'kids-03-v3', takenAt: T0 + 5 * HOUR + 4000, sizeBytes: 3_900_000, spaceTakenBytes: 3_900_000 }),
  item({ mediaKey: 'burst-4', scene: 'kids-03-v4', takenAt: T0 + 5 * HOUR + 6000, sizeBytes: 4_200_000, spaceTakenBytes: 4_200_000 }),
  item({ mediaKey: 'burst-5', scene: 'kids-03-v5', takenAt: T0 + 5 * HOUR + 8000, sizeBytes: 3_800_000, spaceTakenBytes: 3_800_000 }),

  // Same place, different shot, a day later: visually similar but outside the
  // time window, so it must NOT join the burst's similar group.
  item({ mediaKey: 'far-1', scene: 'kids-03-v9', takenAt: T0 + 30 * HOUR }),

  // Unique stills.
  item({ mediaKey: 'solo-1', scene: 'mountain-04', takenAt: T0 + 8 * HOUR }),
  item({ mediaKey: 'solo-2', scene: 'city-05', takenAt: T0 + 9 * HOUR }),
  item({ mediaKey: 'solo-3', scene: 'dog-06', takenAt: T0 + 10 * HOUR }),

  // Large videos.
  item({ mediaKey: 'vid-1', scene: 'video-07', takenAt: T0 + 12 * HOUR, durationMs: 185_000, width: 3840, height: 2160, sizeBytes: 812_000_000, spaceTakenBytes: 812_000_000, fileName: 'VID_0007.mp4' }),
  item({ mediaKey: 'vid-2', scene: 'video-08', takenAt: T0 + 13 * HOUR, durationMs: 42_000, width: 1920, height: 1080, sizeBytes: 95_000_000, spaceTakenBytes: 95_000_000, fileName: 'VID_0008.mp4' }),

  // Live photo.
  item({ mediaKey: 'live-1', scene: 'live-09', takenAt: T0 + 14 * HOUR, isLivePhoto: true, sizeBytes: 6_200_000, spaceTakenBytes: 6_200_000 }),
];

export const FIXTURE_USAGE = { usedBytes: 14.2 * 1024 ** 3, limitBytes: 15 * 1024 ** 3, usedByPhotosBytes: 11.9 * 1024 ** 3 };
