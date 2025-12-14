import {type ClassValue, clsx} from "clsx"
import {twMerge} from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getUsagePercentage(total: number, free: number) {
  const t = Number(total ?? 0);
  const f = Number(free ?? 0);
  if (!Number.isFinite(t) || t <= 0) return 0;
  if (!Number.isFinite(f)) return 0;
  const pct = ((t - f) / t) * 100;
  if (!Number.isFinite(pct)) return 0;
  return Math.max(0, Math.min(100, pct));
}
