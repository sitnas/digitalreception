import { MigrationInterface, QueryRunner } from "typeorm";

/** Guest pre-registration from the phone: details on the invitation, files waiting for the visit. */
export class GuestPreregistration1792200000000 implements MigrationInterface {
    name = 'GuestPreregistration1792200000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`invitations\` ADD \`preregisteredAt\` datetime(3) NULL, ADD \`preDataEnc\` text NULL, ADD \`preLocale\` varchar(5) NULL, ADD \`preNoticeId\` varchar(255) NULL, ADD \`preNoticeVersion\` int NULL, ADD \`preDocuments\` text NULL`);
        await queryRunner.query(`ALTER TABLE \`stored_files\` MODIFY \`visitId\` varchar(255) NULL`);
        await queryRunner.query(`ALTER TABLE \`stored_files\` ADD \`invitationId\` varchar(255) NULL, ADD INDEX \`IDX_stored_files_invitation\` (\`invitationId\`)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`stored_files\` DROP INDEX \`IDX_stored_files_invitation\`, DROP COLUMN \`invitationId\``);
        await queryRunner.query(`DELETE FROM \`stored_files\` WHERE \`visitId\` IS NULL`);
        await queryRunner.query(`ALTER TABLE \`stored_files\` MODIFY \`visitId\` varchar(255) NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`invitations\` DROP COLUMN \`preDocuments\`, DROP COLUMN \`preNoticeVersion\`, DROP COLUMN \`preNoticeId\`, DROP COLUMN \`preLocale\`, DROP COLUMN \`preDataEnc\`, DROP COLUMN \`preregisteredAt\``);
    }

}
