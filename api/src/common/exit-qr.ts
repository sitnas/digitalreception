import QRCode from 'qrcode';

/**
 * Exit QR: carries only the visit code (the same one printed under it), with a prefix so the
 * tablet ignores unrelated QR codes. It grants nothing the typed code does not already grant.
 */
export const EXIT_QR_PREFIX = 'DRX1:';
export const exitQrPayload = (code: string) => `${EXIT_QR_PREFIX}${code}`;

export function exitQrSvg(code: string): Promise<string> {
  return QRCode.toString(exitQrPayload(code), { type: 'svg', margin: 0, errorCorrectionLevel: 'M' });
}

export function exitQrPng(code: string): Promise<Buffer> {
  return QRCode.toBuffer(exitQrPayload(code), { type: 'png', margin: 2, width: 360, errorCorrectionLevel: 'M' });
}
