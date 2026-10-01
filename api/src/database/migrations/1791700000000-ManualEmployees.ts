import { MigrationInterface, QueryRunner } from "typeorm";

/** Employees can also be created by hand in the console: remember who manages each one. */
export class ManualEmployees1791700000000 implements MigrationInterface {
    name = 'ManualEmployees1791700000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`employees\` ADD \`source\` varchar(8) NOT NULL DEFAULT 'API'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`employees\` DROP COLUMN \`source\``);
    }

}
