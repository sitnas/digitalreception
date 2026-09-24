import { useCallback, useState } from 'react';
import { ApiError, api } from '../lib/api';
import { INVITE_QR, QrScanner } from './QrScanner';
import type { Strings } from './strings';

export interface InvitePrefill {
  firstName: string; lastName: string; company: string | null; email: string; hostId: string; purpose: string; locale: string; expectedAt: string;
}
export interface Invite { code: string; data: InvitePrefill }

type InviteError = 'INVITATION_NOT_FOUND' | 'INVITATION_USED' | 'INVITATION_NOT_TODAY' | 'INVITATION_OTHER_SITE';
const KNOWN: InviteError[] = ['INVITATION_NOT_FOUND', 'INVITATION_USED', 'INVITATION_NOT_TODAY', 'INVITATION_OTHER_SITE'];

/** Arrival with an invitation: scan the QR (or type the code) and go on with the details already filled. */
export function InviteScan({ t, onFound, onWithout, onCancel }: { t: Strings; onFound: (i: Invite) => void; onWithout: () => void; onCancel: () => void }) {
  const [scanning, setScanning] = useState(true);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lookup = useCallback(async (raw: string) => {
    const code = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
    setScanning(false); setBusy(true); setError(null);
    try {
      onFound({ code, data: await api.kiosk.get<InvitePrefill>(`/invitations/${encodeURIComponent(code)}`) });
    } catch (e) {
      const c = e instanceof ApiError ? e.code : undefined;
      setError(e instanceof ApiError ? t.errors[KNOWN.includes(c as InviteError) ? (c as InviteError) : 'generic'] : t.errors.offline);
    } finally { setBusy(false); }
  }, [onFound, t]);

  return (
    <div className="stack">
      <div><h1 className="k-h2">{t.inviteTitle}</h1><p className="muted" style={{ margin: 0 }}>{t.inviteHint}</p></div>
      {error && <p className="alert" role="alert" style={{ margin: 0 }}>{error}</p>}
      {scanning ? (
        <QrScanner onCode={lookup} onCancel={() => setScanning(false)} t={t} accept={INVITE_QR} wrongText={t.inviteWrong} cancelText={t.inviteType} />
      ) : (
        <>
          <button type="button" className="btn btn-primary k-scan-btn" onClick={() => { setError(null); setScanning(true); }}>{t.inviteTitle}</button>
          <form className="field" onSubmit={(e) => { e.preventDefault(); if (typed.replace(/[^A-Za-z0-9]/g, '').length === 8) lookup(typed); }}>
            <label htmlFor="ic">{t.inviteType}</label>
            <div className="inline">
              <input id="ic" className="input" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={t.inviteCode} maxLength={12} autoCapitalize="characters" autoComplete="off" style={{ flex: 1, letterSpacing: '.12em' }} />
              <button className="btn btn-ghost" disabled={busy || typed.replace(/[^A-Za-z0-9]/g, '').length !== 8}>{busy ? '…' : t.inviteFind}</button>
            </div>
          </form>
        </>
      )}
      <div className="k-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>{t.cancel}</button>
        <button type="button" className="btn btn-ghost" onClick={onWithout}>{t.inviteNoInvite}</button>
      </div>
    </div>
  );
}
