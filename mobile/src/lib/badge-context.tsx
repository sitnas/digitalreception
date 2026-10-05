import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Badge } from './badge';
import { getTenant, revokeBadge } from './api';
import { disablePush, forgetPushToken, syncPush } from './push';
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
  // The phone forgets the badge whatever happens; the server is told too, so nothing issued to this
  // phone keeps working (offline: the administrator can still revoke it from the console).
  const remove = useCallback(async () => {
    if (badge) {
      await disablePush(badge);
      if (badge.appToken) await revokeBadge(badge).catch(() => {});
    }
    await clearBadge(); setBadge(null);
  }, [badge]);
  // Once per start: keep the arrival notices pointing at this phone's current token.
  const synced = useRef(false);
  useEffect(() => { if (badge && !synced.current) { synced.current = true; syncPush(badge); } }, [badge]);
  // Once per start: the organisation may have changed its colours since activation (squares, buttons).
  const branded = useRef(false);
  useEffect(() => {
    if (!badge || branded.current) return;
    branded.current = true;
    getTenant(badge.origin).then(async (t) => {
      if (t.primaryColor === badge.primaryColor && (t.secondaryColor ?? null) === (badge.secondaryColor ?? null)) return;
      const next = { ...badge, primaryColor: t.primaryColor, secondaryColor: t.secondaryColor };
      await saveBadge(next); setBadge(next);
    }, () => {});
  }, [badge]);
  const value = useMemo(() => ({ badge, save, remove }), [badge, save, remove]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useBadge(): BadgeState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useBadge outside BadgeProvider');
  return v;
}
