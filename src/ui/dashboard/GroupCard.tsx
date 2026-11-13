import type { Group } from '@/shared/types';
import { formatBytes } from '@/shared/bytes';
import { bg } from '../shared/bg';

interface Props {
  group: Group;
  selected: boolean;
  onToggle: () => void;
  onChanged: () => void;
}

/**
 * One duplicate or similar group. The keeper is marked; clicking another item
 * makes it the keeper. Thumbnails are loaded by mediaKey through the item's
 * Google thumbnail URL only on the dashboard, never sent anywhere else.
 */
export function GroupCard({ group, selected, onToggle, onChanged }: Props) {
  const keepId = Object.entries(group.decisions ?? {}).find(([, d]) => d === 'keep')?.[0] ?? group.keepId;

  const makeKeeper = async (id: string) => {
    const decisions = Object.fromEntries(group.itemIds.map((x) => [x, x === id ? 'keep' : 'trash'])) as Record<string, 'keep' | 'trash'>;
    await bg({ type: 'ui.decide', groupId: group.id, decisions });
    onChanged();
  };

  return (
    <div className="card stack" style={{ outline: selected ? '2px solid var(--accent)' : 'none' }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <label className="row" style={{ cursor: 'pointer' }}>
          <input type="checkbox" checked={selected} onChange={onToggle} />
          <span>{group.itemIds.length} photos</span>
        </label>
        <span className="pill">{Math.round(group.confidence * 100)}% match</span>
      </div>
      <div className="row" style={{ gap: 6 }}>
        {group.itemIds.map((id) => (
          <button
            key={id}
            onClick={() => makeKeeper(id)}
            title={id === keepId ? 'Keeping this one' : 'Keep this one instead'}
            style={{ padding: 4, borderColor: id === keepId ? 'var(--ok)' : 'var(--rule)', borderWidth: 2 }}
          >
            <span style={{ display: 'block', width: 64, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis' }}>{id}</span>
            <span className={id === keepId ? '' : 'muted'} style={{ fontSize: 11 }}>{id === keepId ? 'Keep' : 'Trash'}</span>
          </button>
        ))}
      </div>
      <span className="muted">Frees {formatBytes(group.reclaimableBytes)}</span>
    </div>
  );
}
