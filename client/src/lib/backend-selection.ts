import { BackendConfig } from '../types';

export function pickEffectiveBackendId(
  backends: BackendConfig[] | undefined,
  activeBackendId: string | null,
  defaultBackendId: string | null,
): string | null {
  const hasAddress = (id: string | null) =>
    !!id && !!backends?.some((b) => b.id === id && !!b.address);

  if (hasAddress(activeBackendId)) return activeBackendId;
  if (hasAddress(defaultBackendId)) return defaultBackendId;
  return backends?.find((b) => b.address)?.id ?? null;
}
