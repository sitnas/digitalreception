import { MigrationInterface, QueryRunner } from "typeorm";

/** Apps of the portal: on or off per organisation (all on, as before) and per employee. */
export class Apps1792600000000 implements MigrationInterface {
    name = 'Apps1792600000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`tenants\` ADD \`apps\` varchar(200) NOT NULL DEFAULT 'reception,access,parcels'`);
        await queryRunner.query(`ALTER TABLE \`employees\` ADD \`appsOff\` varchar(200) NOT NULL DEFAULT ''`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`employees\` DROP COLUMN \`appsOff\``);
        await queryRunner.query(`ALTER TABLE \`tenants\` DROP COLUMN \`apps\``);
    }

}
