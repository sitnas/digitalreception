/** Web NFC record, as much of it as the reader uses. */
export interface NfcRecord { recordType: string; encoding?: string | null; data?: DataView | null }

/**
 * The phone app ("Il mio badge", Android) answers as an NFC tag holding one text record with the
 * same rotating code as its QR ("DRE1:…"). Plain access cards carry no such record: for them the
 * reader keeps using the card's serial number.
 */
export function phoneBadgeCode(records: readonly NfcRecord[] | undefined): string | null {
  for (const r of records ?? []) {
    if (r.recordType !== 'text' || !r.data) continue;
    let text: string;
    try { text = new TextDecoder(r.encoding || 'utf-8').decode(r.data).trim(); } catch { continue; }
    if (/^DRE1:[0-9a-f-]{36}\.\d{1,12}\.[0-9a-f]{16}$/.test(text)) return text;
  }
  return null;
}
