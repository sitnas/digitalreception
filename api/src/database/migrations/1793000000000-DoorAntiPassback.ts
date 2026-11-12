import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Optional anti-passback per door. Each door gets a direction (NONE as today, IN or OUT) and, for a
 * way in, a switch that refuses a second way in before a way out. The check reads the person's last
 * granted access of the day: access_events had no index by employee, so one is added (the table is
 * the largest one, hence a single index that also serves the log filtered by job / contract).
 * Each access event also keeps the door's direction at that moment (NULL for older events), so that
 * changing a door's direction during the day does not change who counts as inside.
 */
export class DoorAntiPassback1793000000000 implements MigrationInterface {
    name = 'DoorAntiPassback1793000000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`doors\` ADD \`direction\` varchar(4) NOT NULL DEFAULT 'NONE', ADD \`antiPassback\` tinyint NOT NULL DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE \`access_events\` ADD \`direction\` varchar(4) NULL`);
        await queryRunner.query(`CREATE INDEX \`IDX_access_events_employee_at\` ON \`access_events\` (\`tenantId\`, \`employeeId\`, \`at\`)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX \`IDX_access_events_employee_at\` ON \`access_events\``);
        await queryRunner.query(`ALTER TABLE \`access_events\` DROP COLUMN \`direction\``);
        await queryRunner.query(`ALTER TABLE \`doors\` DROP COLUMN \`antiPassback\`, DROP COLUMN \`direction\``);
    }

}
