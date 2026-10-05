import { MigrationInterface, QueryRunner } from "typeorm";

/** Parcels left at reception for employees, with an optional photo. */
export class Parcels1792300000000 implements MigrationInterface {
    name = 'Parcels1792300000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE \`parcels\` (\`id\` varchar(36) NOT NULL, \`tenantId\` varchar(255) NOT NULL, \`siteId\` varchar(255) NOT NULL, \`employeeId\` varchar(255) NOT NULL, \`carrier\` varchar(12) NOT NULL, \`pieces\` tinyint NOT NULL DEFAULT 1, \`trackingEnc\` text NULL, \`noteEnc\` text NULL, \`status\` varchar(12) NOT NULL, \`receivedAt\` datetime(3) NOT NULL, \`receivedByUserId\` varchar(255) NOT NULL, \`collectedAt\` datetime(3) NULL, \`collectedByUserId\` varchar(255) NULL, \`emailStatus\` varchar(16) NOT NULL, \`emailAttempts\` tinyint NOT NULL DEFAULT 0, \`createdAt\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), INDEX \`IDX_parcels_site_status\` (\`tenantId\`, \`siteId\`, \`status\`, \`receivedAt\`), INDEX \`IDX_parcels_employee_status\` (\`tenantId\`, \`employeeId\`, \`status\`), INDEX \`IDX_parcels_email_status\` (\`emailStatus\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`ALTER TABLE \`stored_files\` ADD \`parcelId\` varchar(255) NULL, ADD INDEX \`IDX_stored_files_parcel\` (\`parcelId\`)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DELETE FROM \`stored_files\` WHERE \`parcelId\` IS NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`stored_files\` DROP INDEX \`IDX_stored_files_parcel\`, DROP COLUMN \`parcelId\``);
        await queryRunner.query(`DROP TABLE \`parcels\``);
    }

}
