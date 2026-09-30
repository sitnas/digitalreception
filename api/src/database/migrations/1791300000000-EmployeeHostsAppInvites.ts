import { MigrationInterface, QueryRunner } from "typeorm";

/** People to visit can be employees; employees who can be visited invite guests from the phone app. */
export class EmployeeHostsAppInvites1791300000000 implements MigrationInterface {
    name = 'EmployeeHostsAppInvites1791300000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`employees\` ADD \`departmentEnc\` text NULL`);
        await queryRunner.query(`ALTER TABLE \`employees\` ADD \`jobTitleEnc\` text NULL`);
        await queryRunner.query(`ALTER TABLE \`employees\` ADD \`appTokenHash\` char(64) NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX \`IDX_employees_app_token\` ON \`employees\` (\`appTokenHash\`)`);
        await queryRunner.query(`ALTER TABLE \`hosts\` ADD \`employeeId\` varchar(255) NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX \`IDX_hosts_employee\` ON \`hosts\` (\`tenantId\`, \`employeeId\`)`);
        await queryRunner.query(`ALTER TABLE \`invitations\` MODIFY \`createdByUserId\` varchar(255) NULL`);
        await queryRunner.query(`ALTER TABLE \`invitations\` ADD \`createdByEmployeeId\` varchar(255) NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`invitations\` DROP COLUMN \`createdByEmployeeId\``);
        await queryRunner.query(`DELETE FROM \`invitations\` WHERE \`createdByUserId\` IS NULL`);
        await queryRunner.query(`ALTER TABLE \`invitations\` MODIFY \`createdByUserId\` varchar(255) NOT NULL`);
        await queryRunner.query(`DROP INDEX \`IDX_hosts_employee\` ON \`hosts\``);
        await queryRunner.query(`ALTER TABLE \`hosts\` DROP COLUMN \`employeeId\``);
        await queryRunner.query(`DROP INDEX \`IDX_employees_app_token\` ON \`employees\``);
        await queryRunner.query(`ALTER TABLE \`employees\` DROP COLUMN \`appTokenHash\``);
        await queryRunner.query(`ALTER TABLE \`employees\` DROP COLUMN \`jobTitleEnc\``);
        await queryRunner.query(`ALTER TABLE \`employees\` DROP COLUMN \`departmentEnc\``);
    }

}
