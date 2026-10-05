import { MigrationInterface, QueryRunner } from "typeorm";

/** Jobs / contracts ("commesse") and the one each employee belongs to. */
export class Projects1792400000000 implements MigrationInterface {
    name = 'Projects1792400000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE \`projects\` (\`id\` varchar(36) NOT NULL, \`tenantId\` varchar(255) NOT NULL, \`code\` varchar(40) NOT NULL, \`name\` varchar(120) NOT NULL, \`client\` varchar(120) NULL, \`active\` tinyint NOT NULL DEFAULT 1, \`createdAt\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), \`updatedAt\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3), UNIQUE INDEX \`IDX_projects_code\` (\`tenantId\`, \`code\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`ALTER TABLE \`employees\` ADD \`projectId\` varchar(255) NULL, ADD INDEX \`IDX_employees_project\` (\`tenantId\`, \`projectId\`)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`employees\` DROP INDEX \`IDX_employees_project\`, DROP COLUMN \`projectId\``);
        await queryRunner.query(`DROP TABLE \`projects\``);
    }

}
