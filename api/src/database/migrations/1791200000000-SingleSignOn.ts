import { MigrationInterface, QueryRunner } from "typeorm";

/** Single sign-on with Microsoft Entra ID or Google Workspace, linked per organisation. */
export class SingleSignOn1791200000000 implements MigrationInterface {
    name = 'SingleSignOn1791200000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`tenants\` ADD \`ssoProvider\` varchar(12) NULL`);
        await queryRunner.query(`ALTER TABLE \`tenants\` ADD \`ssoOrgId\` varchar(100) NULL`);
        await queryRunner.query(`ALTER TABLE \`tenants\` ADD \`ssoOrgLabel\` varchar(190) NULL`);
        await queryRunner.query(`ALTER TABLE \`tenants\` ADD \`ssoLinkedAt\` datetime(3) NULL`);
        await queryRunner.query(`ALTER TABLE \`tenants\` ADD \`ssoEnforced\` tinyint NOT NULL DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE \`users\` ADD \`ssoSubject\` varchar(255) NULL`);
        await queryRunner.query(`ALTER TABLE \`users\` ADD \`ssoExempt\` tinyint NOT NULL DEFAULT 0`);
        await queryRunner.query(`CREATE TABLE \`sso_requests\` (\`id\` varchar(36) NOT NULL, \`tenantId\` varchar(255) NOT NULL, \`provider\` varchar(12) NOT NULL, \`mode\` varchar(8) NOT NULL, \`userId\` varchar(255) NULL, \`stateHash\` char(64) NOT NULL, \`browserHash\` char(64) NOT NULL, \`nonce\` varchar(64) NOT NULL, \`codeVerifier\` varchar(128) NOT NULL, \`handoffHash\` char(64) NULL, \`subject\` varchar(255) NULL, \`orgId\` varchar(100) NULL, \`orgLabel\` varchar(190) NULL, \`email\` varchar(190) NULL, \`error\` varchar(40) NULL, \`expiresAt\` datetime(3) NOT NULL, \`createdAt\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), UNIQUE INDEX \`IDX_sso_requests_state\` (\`stateHash\`), UNIQUE INDEX \`IDX_sso_requests_handoff\` (\`handoffHash\`), INDEX \`IDX_sso_requests_expires\` (\`expiresAt\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE \`sso_requests\``);
        await queryRunner.query(`ALTER TABLE \`users\` DROP COLUMN \`ssoExempt\``);
        await queryRunner.query(`ALTER TABLE \`users\` DROP COLUMN \`ssoSubject\``);
        await queryRunner.query(`ALTER TABLE \`tenants\` DROP COLUMN \`ssoEnforced\``);
        await queryRunner.query(`ALTER TABLE \`tenants\` DROP COLUMN \`ssoLinkedAt\``);
        await queryRunner.query(`ALTER TABLE \`tenants\` DROP COLUMN \`ssoOrgLabel\``);
        await queryRunner.query(`ALTER TABLE \`tenants\` DROP COLUMN \`ssoOrgId\``);
        await queryRunner.query(`ALTER TABLE \`tenants\` DROP COLUMN \`ssoProvider\``);
    }

}
