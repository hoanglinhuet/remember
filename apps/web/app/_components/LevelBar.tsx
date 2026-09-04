import { LEVELS } from '@/lib/domain/memory';

/** Thanh phân bố bậc độ nhớ. Server Component - không cần JS ở client. */
export function LevelBar({ levels }: { levels: readonly number[] }) {
  const total = levels.reduce((a, b) => a + b, 0);
  if (!total) return null;
  return (
    <span className="lvlbar" aria-hidden="true">
      {levels.map((n, i) =>
        n ? (
          <i key={i} data-level={i + 1} style={{ flexGrow: n }} title={`${LEVELS[i]!.name}: ${n}`} />
        ) : null,
      )}
    </span>
  );
}
