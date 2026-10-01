import { MigrationInterface, QueryRunner } from "typeorm";

/** Notifications to Microsoft Teams, Slack or any HTTPS endpoint, with a delivery outbox. */
export class Webhooks1791500000000 implements MigrationInterface {
    name = 'Webhooks1791500000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE \`webhooks\` (\`id\` varchar(36) NOT NULL, \`tenantId\` varchar(255) NOT NULL, \`name\` varchar(80) NOT NULL, \`kind\` varchar(10) NOT NULL, \`urlEnc\` text NOT NULL, \`urlHost\` varchar(190) NOT NULL, \`events\` varchar(200) NOT NULL, \`siteId\` varchar(255) NULL, \`includeNames\` tinyint NOT NULL DEFAULT 0, \`secretEnc\` text NULL, \`active\` tinyint NOT NULL DEFAULT 1, \`lastResult\` varchar(60) NULL, \`lastAt\` datetime(3) NULL, \`createdAt\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), INDEX \`IDX_webhooks_tenant\` (\`tenantId\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`webhook_deliveries\` (\`id\` varchar(36) NOT NULL, \`tenantId\` varchar(255) NOT NULL, \`webhookId\` varchar(255) NOT NULL, \`event\` varchar(30) NOT NULL, \`payloadEnc\` text NOT NULL, \`status\` varchar(8) NOT NULL, \`attempts\` tinyint NOT NULL DEFAULT 0, \`nextAt\` datetime(3) NOT NULL, \`createdAt\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), INDEX \`IDX_webhook_deliveries_due\` (\`status\`, \`nextAt\`), INDEX \`IDX_webhook_deliveries_created\` (\`createdAt\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE \`webhook_deliveries\``);
        await queryRunner.query(`DROP TABLE \`webhooks\``);
    }

}
