import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ActorType, AuditLog } from '../entities';
import { AppRequest, clientIp } from './request-context';

export interface AuditEntry {
  action: string;
  entityType?: string;
  entityId?: string | null;
  siteId?: string | null;
  details?: Record<string, unknown>;
}

/** Append-only trail. Never contains visitor personal data, only identifiers. */
@Injectable()
export class AuditService {
  private readonly log = new Logger(AuditService.name);
  constructor(@InjectRepository(AuditLog) private readonly repo: Repository<AuditLog>) {}

  async fromRequest(req: AppRequest, entry: AuditEntry): Promise<void> {
    let actorType = ActorType.ANONYMOUS, actorId: string | null = null, actorLabel: string | null = null;
    if (req.user) { actorType = ActorType.USER; actorId = req.user.id; actorLabel = req.user.email; }
    else if (req.device) { actorType = ActorType.DEVICE; actorId = req.device.id; actorLabel = req.device.name; }
    await this.write({ tenantId: req.tenant?.id ?? null, actorType, actorId, actorLabel, ip: clientIp(req), ...entry });
  }

  async system(tenantId: string | null, entry: AuditEntry): Promise<void> {
    await this.write({ tenantId, actorType: ActorType.SYSTEM, actorId: null, actorLabel: 'system', ip: null, ...entry });
  }

  private async write(e: AuditEntry & { tenantId: string | null; actorType: ActorType; actorId: string | null; actorLabel: string | null; ip: string | null }) {
    try {
      await this.repo.insert({
        tenantId: e.tenantId, at: new Date(), actorType: e.actorType, actorId: e.actorId, actorLabel: e.actorLabel, ip: e.ip,
        action: e.action, entityType: e.entityType ?? null, entityId: e.entityId ?? null, siteId: e.siteId ?? null, details: (e.details ?? null) as never,
      });
    } catch (err) {
      this.log.error(`Audit write failed for action ${e.action}: ${(err as Error).message}`);
      throw err;
    }
  }
}
