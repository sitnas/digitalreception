import { MigrationInterface, QueryRunner } from "typeorm";

/** Rate-limit counters shared by all replicas, and the last run of each background job (monitoring). */
export class SharedThrottleAndJobRuns1791600000000 implements MigrationInterface {
    name = 'SharedThrottleAndJobRuns1791600000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE \`throttle_counters\` (\`k\` char(64) NOT NULL, \`hits\` int NOT NULL, \`expiresAt\` datetime(3) NOT NULL, \`blockedUntil\` datetime(3) NULL, INDEX \`IDX_throttle_counters_expires\` (\`expiresAt\`), PRIMARY KEY (\`k\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`job_runs\` (\`name\` varchar(40) NOT NULL, \`lastRunAt\` datetime(3) NOT NULL, \`lastError\` varchar(300) NULL, \`lastErrorAt\` datetime(3) NULL, PRIMARY KEY (\`name\`)) ENGINE=InnoDB`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE \`job_runs\``);
        await queryRunner.query(`DROP TABLE \`throttle_counters\``);
    }

}
