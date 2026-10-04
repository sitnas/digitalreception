import { MigrationInterface, QueryRunner } from "typeorm";

/** The phone app activates the badge with the company account: where to send the phone back. */
export class BadgeSso1791900000000 implements MigrationInterface {
    name = 'BadgeSso1791900000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`sso_requests\` ADD \`returnTo\` varchar(300) NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DELETE FROM \`sso_requests\` WHERE \`mode\` = 'badge'`);
        await queryRunner.query(`ALTER TABLE \`sso_requests\` DROP COLUMN \`returnTo\``);
    }

}
