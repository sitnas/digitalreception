import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, IsNull } from 'typeorm';
import { StoredFile, Visit, VisitStatus } from '../entities';
import { FilesService } from './files.service';

/**
 * Irreversible removal of personal data from a visit. The row survives with site, times
 * and purpose only, so aggregate statistics stay correct but nobody can be identified.
 */
@Injectable()
export class VisitLifecycleService {
  constructor(@InjectDataSource() private readonly ds: DataSource, private readonly files: FilesService) {}

  async anonymize(tenantId: string, visitId: string, opts: { erased: boolean }): Promise<void> {
    const files = await this.ds.getRepository(StoredFile).find({ where: { tenantId, visitId, purgedAt: IsNull() } });
    for (const f of files) await this.files.purge(f);
    const patch: Partial<Visit> = {
      firstNameEnc: null, lastNameEnc: null, lastNameIndex: null, companyEnc: null, emailEnc: null, emailIndex: null,
      hostEnc: null, documentNumberEnc: null, documentType: null, anonymizedAt: new Date(),
    };
    if (opts.erased) patch.status = VisitStatus.ERASED;
    await this.ds.getRepository(Visit).update({ id: visitId, tenantId }, patch);
  }
}
