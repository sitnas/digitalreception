import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Door events counted per site, outcome and day (console dashboard) read only small ranges of this
 * index: without the site in it, every count re-read all the organisation's rows of those days (load
 * test: 2 s per query on a 3,000-person organisation, 4 queries per dashboard).
 */
export class AccessEventsBySite1792800000000 implements MigrationInterface {
    name = 'AccessEventsBySite1792800000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE INDEX \`IDX_access_events_site_at\` ON \`access_events\` (\`tenantId\`, \`siteId\`, \`result\`, \`at\`)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX \`IDX_access_events_site_at\` ON \`access_events\``);
    }

}
