import { MigrationInterface, QueryRunner } from "typeorm";

/** Pre-registered visits (invitations with QR). */
export class Invitations1790900000000 implements MigrationInterface {
    name = 'Invitations1790900000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE \`invitations\` (\`id\` varchar(36) NOT NULL, \`tenantId\` varchar(255) NOT NULL, \`siteId\` varchar(255) NOT NULL, \`hostId\` varchar(255) NOT NULL, \`expectedAt\` datetime(3) NOT NULL, \`validFrom\` datetime(3) NOT NULL, \`validUntil\` datetime(3) NOT NULL, \`firstNameEnc\` text NOT NULL, \`lastNameEnc\` text NOT NULL, \`companyEnc\` text NULL, \`emailEnc\` text NOT NULL, \`purpose\` varchar(20) NOT NULL, \`locale\` varchar(5) NOT NULL, \`codeHash\` char(64) NOT NULL, \`codeEnc\` text NOT NULL, \`status\` varchar(12) NOT NULL, \`visitId\` varchar(255) NULL, \`usedAt\` datetime(3) NULL, \`emailStatus\` varchar(16) NOT NULL, \`emailAttempts\` tinyint NOT NULL DEFAULT '0', \`createdByUserId\` varchar(255) NOT NULL, \`createdAt\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), UNIQUE INDEX \`IDX_invitations_code\` (\`tenantId\`, \`codeHash\`), INDEX \`IDX_invitations_site_day\` (\`tenantId\`, \`siteId\`, \`validFrom\`), INDEX \`IDX_invitations_email_status\` (\`emailStatus\`), INDEX \`IDX_invitations_valid_until\` (\`validUntil\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE \`invitations\``);
    }

}
