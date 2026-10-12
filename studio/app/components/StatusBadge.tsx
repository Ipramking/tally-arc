import { LEVELS, type Level } from "@/lib/status";

export function StatusBadge({ level, label }: { level: Level; label?: string }) {
  return (
    <span className={`badge ${LEVELS[level].css}`}>
      <span className="swatch" /> {label ?? LEVELS[level].label}
    </span>
  );
}
