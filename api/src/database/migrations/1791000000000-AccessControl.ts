import { MigrationInterface, QueryRunner } from "typeorm";

/** Employee access control: employees, doors, permissions, door readers, access log, integration API keys. */
export class AccessControl1791000000000 implements MigrationInterface {
    name = 'AccessControl1791000000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE \`employees\` (\`id\` varchar(36) NOT NULL, \`tenantId\` varchar(255) NOT NULL, \`externalId\` varchar(100) NOT NULL, \`firstNameEnc\` text NOT NULL, \`lastNameEnc\` text NOT NULL, \`emailEnc\` text NULL, \`emailIndex\` char(64) NULL, \`badgeIndex\` char(64) NULL, \`badgeHint\` varchar(8) NULL, \`active\` tinyint NOT NULL DEFAULT 1, \`validFrom\` datetime(3) NULL, \`validUntil\` datetime(3) NULL, \`credentialSecretEnc\` text NULL, \`credentialIssuedAt\` datetime(3) NULL, \`loginCodeHash\` char(64) NULL, \`loginCodeExpiresAt\` datetime(3) NULL, \`loginCodeAttempts\` tinyint NOT NULL DEFAULT '0', \`createdAt\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), \`updatedAt\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3), INDEX \`IDX_employees_badge\` (\`tenantId\`, \`badgeIndex\`), INDEX \`IDX_employees_email\` (\`tenantId\`, \`emailIndex\`), UNIQUE INDEX \`IDX_employees_external\` (\`tenantId\`, \`externalId\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`doors\` (\`id\` varchar(36) NOT NULL, \`tenantId\` varchar(255) NOT NULL, \`siteId\` varchar(255) NOT NULL, \`externalId\` varchar(100) NOT NULL, \`name\` varchar(80) NOT NULL, \`active\` tinyint NOT NULL DEFAULT 1, \`createdAt\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), INDEX \`IDX_doors_site\` (\`tenantId\`, \`siteId\`), UNIQUE INDEX \`IDX_doors_external\` (\`tenantId\`, \`externalId\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`access_rules\` (\`id\` varchar(36) NOT NULL, \`tenantId\` varchar(255) NOT NULL, \`employeeId\` varchar(255) NOT NULL, \`doorId\` varchar(255) NOT NULL, \`days\` varchar(20) NULL, \`fromTime\` char(5) NULL, \`toTime\` char(5) NULL, INDEX \`IDX_access_rules_door\` (\`tenantId\`, \`doorId\`), INDEX \`IDX_access_rules_employee\` (\`tenantId\`, \`employeeId\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`door_readers\` (\`id\` varchar(36) NOT NULL, \`tenantId\` varchar(255) NOT NULL, \`siteId\` varchar(255) NOT NULL, \`doorId\` varchar(255) NOT NULL, \`name\` varchar(80) NOT NULL, \`tokenHash\` char(64) NOT NULL, \`createdBy\` varchar(255) NULL, \`createdAt\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), \`lastSeenAt\` datetime(3) NULL, \`revokedAt\` datetime(3) NULL, UNIQUE INDEX \`IDX_door_readers_token\` (\`tokenHash\`), INDEX \`IDX_door_readers_door\` (\`tenantId\`, \`doorId\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`access_events\` (\`id\` varchar(36) NOT NULL, \`tenantId\` varchar(255) NOT NULL, \`siteId\` varchar(255) NOT NULL, \`doorId\` varchar(255) NOT NULL, \`readerId\` varchar(255) NOT NULL, \`employeeId\` varchar(255) NULL, \`method\` varchar(4) NOT NULL, \`result\` varchar(8) NOT NULL, \`reason\` varchar(24) NOT NULL, \`at\` datetime(3) NOT NULL, INDEX \`IDX_access_events_at\` (\`at\`), INDEX \`IDX_access_events_tenant_at\` (\`tenantId\`, \`at\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`api_keys\` (\`id\` varchar(36) NOT NULL, \`tenantId\` varchar(255) NOT NULL, \`name\` varchar(80) NOT NULL, \`prefix\` varchar(12) NOT NULL, \`keyHash\` char(64) NOT NULL, \`createdBy\` varchar(255) NOT NULL, \`createdAt\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), \`lastUsedAt\` datetime(3) NULL, \`revokedAt\` datetime(3) NULL, UNIQUE INDEX \`IDX_api_keys_hash\` (\`keyHash\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`ALTER TABLE \`pairing_codes\` ADD \`doorId\` varchar(255) NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`pairing_codes\` DROP COLUMN \`doorId\``);
        for (const t of ['api_keys', 'access_events', 'door_readers', 'access_rules', 'doors', 'employees']) await queryRunner.query(`DROP TABLE \`${t}\``);
    }

}
