import { MigrationInterface, QueryRunner } from "typeorm";

/** White-label colours chosen by each organisation. */
export class TenantColors1790700000000 implements MigrationInterface {
    name = 'TenantColors1790700000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`tenants\` ADD \`primaryColor\` varchar(7) NULL`);
        await queryRunner.query(`ALTER TABLE \`tenants\` ADD \`secondaryColor\` varchar(7) NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`tenants\` DROP COLUMN \`secondaryColor\``);
        await queryRunner.query(`ALTER TABLE \`tenants\` DROP COLUMN \`primaryColor\``);
    }

}
