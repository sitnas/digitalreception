import QRCode from 'qrcode';

/**
 * Exit QR: carries only the visit code (the same one printed under it), with a prefix so the
 * tablet ignores unrelated QR codes. It grants nothing the typed code does not already grant.
 */
export const EXIT_QR_PREFIX = 'DRX1:';
export const exitQrPayload = (code: string) => `${EXIT_QR_PREFIX}${code}`;

/** Invitation QR: the invite code, with its own prefix so exit and invite codes never mix. */
export const INVITE_QR_PREFIX = 'DRI1:';
export const inviteQrPayload = (code: string) => `${INVITE_QR_PREFIX}${code}`;

export function qrSvg(payload: string): Promise<string> {
  return QRCode.toString(payload, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' });
}

export function qrPng(payload: string): Promise<Buffer> {
  return QRCode.toBuffer(payload, { type: 'png', margin: 2, width: 360, errorCorrectionLevel: 'M' });
}

export const exitQrSvg = (code: string) => qrSvg(exitQrPayload(code));
export const exitQrPng = (code: string) => qrPng(exitQrPayload(code));
