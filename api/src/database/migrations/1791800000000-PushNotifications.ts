import { MigrationInterface, QueryRunner } from "typeorm";

/** Push notifications to the employee's phone when their guest arrives. */
export class PushNotifications1791800000000 implements MigrationInterface {
    name = 'PushNotifications1791800000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE \`push_devices\` (\`id\` varchar(36) NOT NULL, \`tenantId\` varchar(255) NOT NULL, \`employeeId\` varchar(255) NOT NULL, \`kind\` varchar(8) NOT NULL, \`targetHash\` char(64) NOT NULL, \`targetEnc\` text NOT NULL, \`locale\` varchar(5) NOT NULL, \`createdAt\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), INDEX \`IDX_push_devices_employee\` (\`tenantId\`, \`employeeId\`), UNIQUE INDEX \`IDX_push_devices_target\` (\`targetHash\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`push_deliveries\` (\`id\` varchar(36) NOT NULL, \`tenantId\` varchar(255) NOT NULL, \`employeeId\` varchar(255) NOT NULL, \`payloadEnc\` text NOT NULL, \`status\` varchar(8) NOT NULL, \`attempts\` tinyint NOT NULL DEFAULT 0, \`nextAt\` datetime(3) NOT NULL, \`createdAt\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), INDEX \`IDX_push_deliveries_due\` (\`status\`, \`nextAt\`), INDEX \`IDX_push_deliveries_created\` (\`createdAt\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`platform_secrets\` (\`name\` varchar(40) NOT NULL, \`valueWrapped\` text NOT NULL, \`createdAt\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (\`name\`)) ENGINE=InnoDB`);
        await queryRunner.query(`ALTER TABLE \`tenants\` ADD \`pushIncludeNames\` tinyint NOT NULL DEFAULT 0`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`tenants\` DROP COLUMN \`pushIncludeNames\``);
        await queryRunner.query(`DROP TABLE \`platform_secrets\``);
        await queryRunner.query(`DROP TABLE \`push_deliveries\``);
        await queryRunner.query(`DROP TABLE \`push_devices\``);
    }

}
