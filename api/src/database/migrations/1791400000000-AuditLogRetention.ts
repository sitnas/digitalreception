import { MigrationInterface, QueryRunner } from "typeorm";

/** The audit trail is now purged by date across all organisations: index on the date alone. */
export class AuditLogRetention1791400000000 implements MigrationInterface {
    name = 'AuditLogRetention1791400000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE INDEX \`IDX_audit_logs_at\` ON \`audit_logs\` (\`at\`)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX \`IDX_audit_logs_at\` ON \`audit_logs\``);
    }

}
