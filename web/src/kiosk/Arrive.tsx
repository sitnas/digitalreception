import { useState } from 'react';
import { ApiError, api } from '../lib/api';
import type { CheckInResult } from './CheckIn';
import type { Invite } from './InviteScan';
import { PhotoCapture } from './parts';
import type { Strings } from './strings';
import type { KioskConfig } from './types';

/**
 * Arrival of a guest who pre-registered from the phone: details, signature and acceptances are
 * already on the invitation, so the tablet only confirms (and takes the laptop serial photo where
 * the policy asks for it at the entrance).
 */
export function Arrive({ cfg, invite, t, onDone, onCancel, onFallback }: {
  cfg: KioskConfig; invite: Invite; t: Strings; onDone: (r: CheckInResult) => void; onCancel: () => void; onFallback: () => void;
}) {
  const [assetPhoto, setAssetPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsPhoto = cfg.policy.assetPhotosRequired;
  const { firstName, lastName } = invite.data;

  const confirm = async () => {
    setBusy(true); setError(null);
    try {
      const r = await api.kiosk.post<Omit<CheckInResult, 'label'>>('/visits/preregistered', { invitationCode: invite.code, assetPhoto: needsPhoto ? assetPhoto : undefined });
      onDone({ ...r, label: `${firstName} ${lastName.charAt(0)}.` });
    } catch (e) {
      const c = e instanceof ApiError ? e.code : '';
      // Something the site asks changed since the phone registration: the normal form, prefilled.
      if (c === 'PREREGISTRATION_INCOMPLETE' || c === 'HOST_NOT_FOUND') onFallback();
      else if (c.startsWith('INVITATION_') && c in t.errors) setError(t.errors[c as keyof Strings['errors']]);
      else setError(e instanceof ApiError ? t.errors.generic : t.errors.offline);
    } finally { setBusy(false); }
  };

  return (
    <div className="stack">
      <div className="k-invite-hello" role="status">
        <strong>{t.preHello.replace('{name}', firstName)}</strong>
        <span>{needsPhoto ? t.preAsset : t.preHint}</span>
      </div>
      {error && <p className="alert" role="alert">{error}</p>}
      {needsPhoto && <PhotoCapture title={t.photoAssetTitle} hint={t.photoAssetHint} value={assetPhoto} onChange={setAssetPhoto} t={t} />}
      <div className="k-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>{t.cancel}</button>
        <button type="button" className="btn btn-primary" onClick={confirm} disabled={busy || (needsPhoto && !assetPhoto)} aria-busy={busy}>{busy ? t.sending : t.confirmCheckIn}</button>
      </div>
    </div>
  );
}
