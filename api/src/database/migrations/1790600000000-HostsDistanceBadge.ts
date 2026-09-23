import { MigrationInterface, QueryRunner } from "typeorm";

/** Host directory, travel distance question and exit badge email. */
export class HostsDistanceBadge1790600000000 implements MigrationInterface {
    name = 'HostsDistanceBadge1790600000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE \`hosts\` (\`id\` varchar(36) NOT NULL, \`tenantId\` varchar(255) NOT NULL, \`firstName\` varchar(80) NOT NULL, \`lastName\` varchar(80) NOT NULL, \`department\` varchar(120) NULL, \`jobTitle\` varchar(120) NULL, \`email\` varchar(190) NULL, \`phone\` varchar(40) NULL, \`active\` tinyint NOT NULL DEFAULT 1, \`createdAt\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), INDEX \`IDX_hosts_tenant_lastname\` (\`tenantId\`, \`lastName\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`host_sites\` (\`hostId\` varchar(36) NOT NULL, \`siteId\` varchar(36) NOT NULL, INDEX \`IDX_52d2ae31d08739dcaa1f0cd473\` (\`hostId\`), INDEX \`IDX_89eb2b603ea97902be347c7417\` (\`siteId\`), PRIMARY KEY (\`hostId\`, \`siteId\`)) ENGINE=InnoDB`);
        await queryRunner.query(`ALTER TABLE \`host_sites\` ADD CONSTRAINT \`FK_host_sites_host\` FOREIGN KEY (\`hostId\`) REFERENCES \`hosts\`(\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE \`host_sites\` ADD CONSTRAINT \`FK_host_sites_site\` FOREIGN KEY (\`siteId\`) REFERENCES \`sites\`(\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`);

        await queryRunner.query(`ALTER TABLE \`visits\` ADD \`hostId\` varchar(255) NULL`);
        await queryRunner.query(`ALTER TABLE \`visits\` ADD \`travelDistance\` varchar(20) NULL`);
        await queryRunner.query(`ALTER TABLE \`visits\` ADD \`badgeEmailStatus\` varchar(16) NOT NULL DEFAULT 'NOT_REQUESTED'`);
        await queryRunner.query(`ALTER TABLE \`visits\` ADD \`badgeEmailAttempts\` tinyint NOT NULL DEFAULT '0'`);
        await queryRunner.query(`CREATE INDEX \`IDX_visits_badge_email_status\` ON \`visits\` (\`badgeEmailStatus\`)`);
        await queryRunner.query(`ALTER TABLE \`visits\` ADD CONSTRAINT \`FK_visits_host\` FOREIGN KEY (\`hostId\`) REFERENCES \`hosts\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`visits\` DROP FOREIGN KEY \`FK_visits_host\``);
        await queryRunner.query(`DROP INDEX \`IDX_visits_badge_email_status\` ON \`visits\``);
        await queryRunner.query(`ALTER TABLE \`visits\` DROP COLUMN \`badgeEmailAttempts\``);
        await queryRunner.query(`ALTER TABLE \`visits\` DROP COLUMN \`badgeEmailStatus\``);
        await queryRunner.query(`ALTER TABLE \`visits\` DROP COLUMN \`travelDistance\``);
        await queryRunner.query(`ALTER TABLE \`visits\` DROP COLUMN \`hostId\``);
        await queryRunner.query(`ALTER TABLE \`host_sites\` DROP FOREIGN KEY \`FK_host_sites_site\``);
        await queryRunner.query(`ALTER TABLE \`host_sites\` DROP FOREIGN KEY \`FK_host_sites_host\``);
        await queryRunner.query(`DROP TABLE \`host_sites\``);
        await queryRunner.query(`DROP TABLE \`hosts\``);
    }

}
