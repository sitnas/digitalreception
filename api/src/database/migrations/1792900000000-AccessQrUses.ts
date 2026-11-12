import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Phone badge QR codes used once per door: a code (employee + 30-second step) that opened a door is
 * written here, and the unique index refuses a second use of it at the same door (a screenshot sent
 * to a colleague). Rows are only needed for about 90 seconds; the retention job deletes older ones.
 */
export class AccessQrUses1792900000000 implements MigrationInterface {
    name = 'AccessQrUses1792900000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE \`access_qr_uses\` (\`id\` bigint NOT NULL AUTO_INCREMENT, \`tenantId\` varchar(255) NOT NULL, \`doorId\` varchar(255) NOT NULL, \`employeeId\` varchar(255) NOT NULL, \`step\` int NOT NULL, \`usedAt\` datetime(3) NOT NULL, UNIQUE INDEX \`IDX_access_qr_uses_code\` (\`tenantId\`, \`doorId\`, \`employeeId\`, \`step\`), INDEX \`IDX_access_qr_uses_at\` (\`usedAt\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE \`access_qr_uses\``);
    }

}
