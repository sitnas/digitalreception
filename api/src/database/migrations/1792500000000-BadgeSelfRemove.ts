import { MigrationInterface, QueryRunner } from "typeorm";

/** Whether employees may remove the phone badge themselves (on by default, as before). */
export class BadgeSelfRemove1792500000000 implements MigrationInterface {
    name = 'BadgeSelfRemove1792500000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`tenants\` ADD \`badgeSelfRemove\` tinyint NOT NULL DEFAULT 1`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`tenants\` DROP COLUMN \`badgeSelfRemove\``);
    }

}
