import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Badge } from './badge';
import type { AppKey } from './invites';
import { ApiError, getTenant, revokeBadge } from './api';
import { disablePush, forgetPushToken, syncPush } from './push';
import { clearBadge, loadBadge, saveBadge } from './storage';

interface BadgeState {
  /** undefined while the keystore is being read. */
  badge: Badge | null | undefined;
  save: (b: Badge) => Promise<void>;
  remove: () => Promise<void>;
  /** What the tab bar shows: the apps on for this person and the parcels waiting. null until the server answers. */
  portal: Portal | null;
  setPortal: (p: Portal | null) => void;
}
export interface Portal { apps: AppKey[]; canInvite: boolean; parcels: number }

const Ctx = createContext<BadgeState | null>(null);

export function BadgeProvider({ children }: { children: React.ReactNode }) {
  const [badge, setBadge] = useState<Badge | null | undefined>(undefined);
  const [portal, setPortal] = useState<Portal | null>(null);
  // Another badge (or none): what the previous one could open no longer counts.
  useEffect(() => { setPortal(null); }, [badge?.employeeId, badge?.appToken]);
  useEffect(() => { loadBadge().then(setBadge); }, []);
  // A new activation makes the server forget this phone's notices: start again from "off".
  const save = useCallback(async (b: Badge) => { await forgetPushToken(); await saveBadge(b); setBadge(b); }, []);
  // The server is told first, so nothing issued to this phone keeps working (offline: the phone forgets
  // it anyway and the administrator can still revoke it from the console). Only a refusal by the
  // organisation keeps the badge on the phone.
  const remove = useCallback(async () => {
    if (badge) {
      if (badge.appToken) {
        try { await revokeBadge(badge); }
        catch (e) { if (e instanceof ApiError && e.code === 'SELF_REMOVE_DISABLED') throw e; }
      }
      await disablePush(badge);
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
  const value = useMemo(() => ({ badge, save, remove, portal, setPortal }), [badge, save, remove, portal]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useBadge(): BadgeState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useBadge outside BadgeProvider');
  return v;
}
