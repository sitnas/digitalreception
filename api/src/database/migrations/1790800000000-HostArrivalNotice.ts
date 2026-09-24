import { MigrationInterface, QueryRunner } from "typeorm";

/** Arrival notice sent to the host picked from the directory. */
export class HostArrivalNotice1790800000000 implements MigrationInterface {
    name = 'HostArrivalNotice1790800000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`visits\` ADD \`hostEmailStatus\` varchar(16) NOT NULL DEFAULT 'NOT_REQUESTED'`);
        await queryRunner.query(`ALTER TABLE \`visits\` ADD \`hostEmailAttempts\` tinyint NOT NULL DEFAULT '0'`);
        await queryRunner.query(`CREATE INDEX \`IDX_visits_host_email_status\` ON \`visits\` (\`hostEmailStatus\`)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX \`IDX_visits_host_email_status\` ON \`visits\``);
        await queryRunner.query(`ALTER TABLE \`visits\` DROP COLUMN \`hostEmailAttempts\``);
        await queryRunner.query(`ALTER TABLE \`visits\` DROP COLUMN \`hostEmailStatus\``);
    }

}
