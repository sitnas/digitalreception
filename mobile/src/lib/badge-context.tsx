import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Badge } from './badge';
import { disablePush, forgetPushToken } from './push';
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
  // A new activation makes the server forget this phone's notices: start again from "off".
  const save = useCallback(async (b: Badge) => { await forgetPushToken(); await saveBadge(b); setBadge(b); }, []);
  const remove = useCallback(async () => { if (badge) await disablePush(badge); await clearBadge(); setBadge(null); }, [badge]);
  const value = useMemo(() => ({ badge, save, remove }), [badge, save, remove]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useBadge(): BadgeState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useBadge outside BadgeProvider');
  return v;
}
