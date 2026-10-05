import { MigrationInterface, QueryRunner } from "typeorm";

/** Company parking: spots per site, bookings per day, the managers' weekly run, the benefit on each employee. Off by default. */
export class Parking1792700000000 implements MigrationInterface {
    name = 'Parking1792700000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE \`parking_spots\` (\`id\` varchar(36) NOT NULL, \`tenantId\` varchar(255) NOT NULL, \`siteId\` varchar(255) NOT NULL, \`code\` varchar(20) NOT NULL, \`note\` varchar(120) NULL, \`active\` tinyint NOT NULL DEFAULT 1, \`createdAt\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), UNIQUE INDEX \`IDX_parking_spots_code\` (\`tenantId\`, \`siteId\`, \`code\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`parking_bookings\` (\`id\` varchar(36) NOT NULL, \`tenantId\` varchar(255) NOT NULL, \`siteId\` varchar(255) NOT NULL, \`spotId\` varchar(255) NOT NULL, \`employeeId\` varchar(255) NOT NULL, \`date\` date NOT NULL, \`source\` varchar(8) NOT NULL, \`createdAt\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), UNIQUE INDEX \`IDX_parking_bookings_spot_day\` (\`tenantId\`, \`spotId\`, \`date\`), UNIQUE INDEX \`IDX_parking_bookings_person_day\` (\`tenantId\`, \`employeeId\`, \`date\`), INDEX \`IDX_parking_bookings_site_day\` (\`tenantId\`, \`siteId\`, \`date\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`parking_weeks\` (\`id\` varchar(36) NOT NULL, \`tenantId\` varchar(255) NOT NULL, \`siteId\` varchar(255) NOT NULL, \`monday\` date NOT NULL, \`booked\` smallint NOT NULL DEFAULT 0, \`createdAt\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), UNIQUE INDEX \`IDX_parking_weeks\` (\`tenantId\`, \`siteId\`, \`monday\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`ALTER TABLE \`employees\` ADD \`parkingRole\` varchar(8) NOT NULL DEFAULT 'NONE', ADD \`parkingSpotId\` varchar(255) NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`employees\` DROP COLUMN \`parkingSpotId\`, DROP COLUMN \`parkingRole\``);
        await queryRunner.query(`DROP TABLE \`parking_weeks\``);
        await queryRunner.query(`DROP TABLE \`parking_bookings\``);
        await queryRunner.query(`DROP TABLE \`parking_spots\``);
    }

}
