import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, IsNull, Repository } from 'typeorm';
import { SiteDocument, SiteDocumentVersion, VisitDocument } from '../entities';

export interface GuestDocument { id: string; documentId: string; version: number; locale: string; title: string; body: string }

/**
 * Documents a guest accepts at check-in (safety rules, NDA). The guest reads each one in their
 * language; when a document has no text in that language, the organisation's default language is
 * used, then any language it has. Only the latest version of each text can be accepted.
 */
@Injectable()
export class SiteDocumentsService {
  constructor(
    @InjectRepository(SiteDocument) private readonly docs: Repository<SiteDocument>,
    @InjectRepository(SiteDocumentVersion) private readonly versions: Repository<SiteDocumentVersion>,
  ) {}

  /** Latest text of every active document of the site, for each requested language. */
  async forSite(tenantId: string, siteId: string, locales: string[], defaultLocale: string): Promise<Record<string, GuestDocument[]>> {
    const docs = await this.docs.find({ where: [{ tenantId, siteId, active: true }, { tenantId, siteId: IsNull(), active: true }], order: { position: 'ASC', createdAt: 'ASC' } });
    const out: Record<string, GuestDocument[]> = Object.fromEntries(locales.map((l) => [l, []]));
    if (!docs.length) return out;
    const all = await this.versions.find({ where: { tenantId, documentId: In(docs.map((d) => d.id)) }, order: { version: 'DESC' } });
    for (const d of docs) {
      const latest = new Map<string, SiteDocumentVersion>();
      for (const v of all) if (v.documentId === d.id && !latest.has(v.locale)) latest.set(v.locale, v);
      if (!latest.size) continue; // a document without any text is not shown
      for (const l of locales) {
        const v = latest.get(l) ?? latest.get(defaultLocale) ?? [...latest.values()][0];
        out[l].push({ id: v.id, documentId: d.id, version: v.version, locale: v.locale, title: v.title, body: v.body });
      }
    }
    return out;
  }

  /** The guest must have accepted exactly the current texts: a stale tablet or link reloads them. */
  assertAccepted(required: GuestDocument[], accepted: string[] | undefined) {
    const got = new Set(accepted ?? []);
    if (required.some((d) => !got.has(d.id)) || got.size !== required.length) throw new ConflictException('DOCUMENTS_OUTDATED');
  }

  record(em: EntityManager, tenantId: string, visitId: string, docs: GuestDocument[], acceptedAt: Date) {
    if (!docs.length) return Promise.resolve();
    return em.insert(VisitDocument, docs.map((d) => ({ tenantId, visitId, documentId: d.documentId, versionId: d.id, acceptedAt })));
  }

  /** What a visit accepted, with the exact version, for the console. */
  async ofVisit(tenantId: string, visitId: string) {
    const rows = await this.versions.manager.find(VisitDocument, { where: { tenantId, visitId }, order: { acceptedAt: 'ASC' } });
    if (!rows.length) return [];
    const versions = await this.versions.find({ where: { tenantId, id: In(rows.map((r) => r.versionId)) } });
    return rows.map((r) => {
      const v = versions.find((x) => x.id === r.versionId);
      return { documentId: r.documentId, versionId: r.versionId, title: v?.title ?? null, version: v?.version ?? null, locale: v?.locale ?? null, acceptedAt: r.acceptedAt };
    });
  }
}
