import { MigrationInterface, QueryRunner } from "typeorm";

/** Evacuation of a site with roll call. */
export class Evacuations1792000000000 implements MigrationInterface {
    name = 'Evacuations1792000000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE \`evacuations\` (\`id\` varchar(36) NOT NULL, \`tenantId\` varchar(255) NOT NULL, \`siteId\` varchar(255) NOT NULL, \`startedAt\` datetime(3) NOT NULL, \`startedByUserId\` varchar(255) NOT NULL, \`endedAt\` datetime(3) NULL, \`endedByUserId\` varchar(255) NULL, \`peopleCount\` int NULL, \`safeCount\` int NULL, INDEX \`IDX_evacuations_site\` (\`tenantId\`, \`siteId\`, \`startedAt\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`evacuation_checks\` (\`id\` varchar(36) NOT NULL, \`tenantId\` varchar(255) NOT NULL, \`evacuationId\` varchar(255) NOT NULL, \`kind\` varchar(8) NOT NULL, \`refId\` varchar(255) NOT NULL, \`checkedByUserId\` varchar(255) NOT NULL, \`checkedAt\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), UNIQUE INDEX \`IDX_evacuation_checks_person\` (\`evacuationId\`, \`kind\`, \`refId\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE \`evacuation_checks\``);
        await queryRunner.query(`DROP TABLE \`evacuations\``);
    }

}
