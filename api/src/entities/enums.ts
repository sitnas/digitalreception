export enum Role {
  SUPER_ADMIN = 'SUPER_ADMIN',   // system configuration, all sites
  SITE_MANAGER = 'SITE_MANAGER', // full history of assigned sites, devices, export, erasure
  RECEPTIONIST = 'RECEPTIONIST', // assigned sites, last 7 days, no export
  AUDITOR = 'AUDITOR',           // audit trail only, never visitor data (separation of duties)
}

export enum VisitStatus { OPEN = 'OPEN', CLOSED = 'CLOSED', AUTO_CLOSED = 'AUTO_CLOSED', ERASED = 'ERASED' }
export enum VisitPurpose { MEETING = 'MEETING', INTERVIEW = 'INTERVIEW', SUPPLIER = 'SUPPLIER', MAINTENANCE = 'MAINTENANCE', DELIVERY = 'DELIVERY', OTHER = 'OTHER' }
export enum DocumentType { ID_CARD = 'ID_CARD', PASSPORT = 'PASSPORT', DRIVING_LICENSE = 'DRIVING_LICENSE', OTHER = 'OTHER' }
export enum FileKind { SIGNATURE = 'SIGNATURE', DOCUMENT = 'DOCUMENT', ASSET_IN = 'ASSET_IN', ASSET_OUT = 'ASSET_OUT' }
export enum NoticeEmailStatus { NOT_REQUESTED = 'NOT_REQUESTED', PENDING = 'PENDING', SENT = 'SENT', FAILED = 'FAILED', SKIPPED = 'SKIPPED' }
export enum ActorType { USER = 'USER', DEVICE = 'DEVICE', SYSTEM = 'SYSTEM', ANONYMOUS = 'ANONYMOUS' }
