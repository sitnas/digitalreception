export type Role = 'SUPER_ADMIN' | 'SITE_MANAGER' | 'RECEPTIONIST' | 'AUDITOR';
export type VisitStatus = 'OPEN' | 'CLOSED' | 'AUTO_CLOSED' | 'ERASED';
export interface Me { id: string; tenantId: string; email: string; displayName: string; role: Role; siteIds: string[]; mustChangePassword: boolean }
export interface Site { id: string; code: string; name: string; countryCode: string; timezone: string; active: boolean }
export interface VisitRow {
  id: string; code: string; status: VisitStatus; siteId: string; siteName: string | null; siteTimezone: string | null; checkInAt: string; checkOutAt: string | null;
  purpose: string; travelDistance: string | null; firstName: string | null; lastName: string | null; company: string | null; host: string | null; anonymized: boolean;
}
export interface VisitDetail extends VisitRow {
  email: string | null; documentType: string | null; documentNumber: string | null; checkOutBy: string | null; locale: string;
  privacyNoticeVersion: number; privacyAcceptedAt: string; noticeEmailStatus: string; badgeEmailStatus: string; hostEmailStatus: string; anonymizedAt: string | null;
  files: { id: string; kind: string; available: boolean; purgeAfter: string; viewable: boolean }[];
}
export interface Paged<T> { items: T[]; total: number; page: number; pageSize: number }
export interface Device { id: string; siteId: string; site?: Site; name: string; createdAt: string; lastSeenAt: string | null; revokedAt: string | null }
export interface HostRow { id: string; firstName: string; lastName: string; department: string | null; jobTitle: string | null; email: string | null; phone: string | null; sites: Site[]; active: boolean }
export interface UserRow { id: string; email: string; displayName: string; role: Role; sites: Site[]; active: boolean; lastLoginAt: string | null }
export interface Policy {
  countryCode: string; name: string; defaultLocale: string; locales: string[]; visitRetentionDays: number; documentDataEnabled: boolean;
  documentPhotoEnabled: boolean; documentPhotoRetentionDays: number; assetPhotosRequired: boolean; assetPhotoRetentionDays: number;
}
export interface Notice { id: string; countryCode: string; locale: string; version: number; title: string; body: string; createdAt: string }
export interface AuditRow { id: string; at: string; actorType: string; actorLabel: string | null; action: string; entityType: string | null; entityId: string | null; siteId: string | null; ip: string | null; details: Record<string, unknown> | null }
