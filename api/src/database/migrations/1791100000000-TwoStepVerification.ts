import { MigrationInterface, QueryRunner } from "typeorm";

/** Two-step verification (TOTP) for console users, optionally required by the organisation. */
export class TwoStepVerification1791100000000 implements MigrationInterface {
    name = 'TwoStepVerification1791100000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`users\` ADD \`mfaSecretEnc\` text NULL`);
        await queryRunner.query(`ALTER TABLE \`users\` ADD \`mfaEnabledAt\` datetime(3) NULL`);
        await queryRunner.query(`ALTER TABLE \`users\` ADD \`mfaLastStep\` bigint NULL`);
        await queryRunner.query(`ALTER TABLE \`users\` ADD \`mfaRecoveryHashes\` text NULL`);
        await queryRunner.query(`ALTER TABLE \`tenants\` ADD \`mfaRequired\` tinyint NOT NULL DEFAULT 0`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`tenants\` DROP COLUMN \`mfaRequired\``);
        await queryRunner.query(`ALTER TABLE \`users\` DROP COLUMN \`mfaRecoveryHashes\``);
        await queryRunner.query(`ALTER TABLE \`users\` DROP COLUMN \`mfaLastStep\``);
        await queryRunner.query(`ALTER TABLE \`users\` DROP COLUMN \`mfaEnabledAt\``);
        await queryRunner.query(`ALTER TABLE \`users\` DROP COLUMN \`mfaSecretEnc\``);
    }

}
