import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Badge } from './badge';
import { clearBadge, loadBadge, saveBadge } from './storage';

interface BadgeState {
  /** undefined while the keystore is being read. */
  badge: Badge | null | undefined;
  save: (b: Badge) => Promise<void>;
  remove: () => Promise<void>;
}

const Ctx = createContext<BadgeState | null>(null);

export function BadgeProvider({ children }: { children: React.ReactNode }) {
  const [badge, setBadge] = useState<Badge | null | undefined>(undefined);
  useEffect(() => { loadBadge().then(setBadge); }, []);
  const save = useCallback(async (b: Badge) => { await saveBadge(b); setBadge(b); }, []);
  const remove = useCallback(async () => { await clearBadge(); setBadge(null); }, []);
  const value = useMemo(() => ({ badge, save, remove }), [badge, save, remove]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useBadge(): BadgeState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useBadge outside BadgeProvider');
  return v;
}
