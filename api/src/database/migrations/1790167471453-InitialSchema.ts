import { MigrationInterface, QueryRunner } from "typeorm";

export class InitialSchema1790167471453 implements MigrationInterface {
    name = 'InitialSchema1790167471453'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE \`audit_logs\` (\`id\` bigint NOT NULL AUTO_INCREMENT, \`tenantId\` varchar(255) NULL, \`at\` datetime(3) NOT NULL, \`actorType\` varchar(12) NOT NULL, \`actorId\` varchar(255) NULL, \`actorLabel\` varchar(190) NULL, \`action\` varchar(40) NOT NULL, \`entityType\` varchar(30) NULL, \`entityId\` varchar(36) NULL, \`siteId\` varchar(255) NULL, \`ip\` varchar(45) NULL, \`details\` text NULL, INDEX \`IDX_b1242ad5160aac0feb5da4aa15\` (\`tenantId\`, \`entityType\`, \`entityId\`), INDEX \`IDX_43b6015f9c67eaa8217a80f466\` (\`tenantId\`, \`action\`, \`at\`), INDEX \`IDX_cb5f3f71cb985e63b8617ce4c9\` (\`tenantId\`, \`at\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`country_policies\` (\`id\` varchar(36) NOT NULL, \`tenantId\` varchar(255) NOT NULL, \`countryCode\` varchar(2) NOT NULL, \`name\` varchar(80) NOT NULL, \`defaultLocale\` varchar(5) NOT NULL, \`locales\` text NOT NULL, \`visitRetentionDays\` int NOT NULL, \`documentDataEnabled\` tinyint NOT NULL DEFAULT 0, \`documentPhotoEnabled\` tinyint NOT NULL DEFAULT 0, \`documentPhotoRetentionDays\` int NOT NULL DEFAULT '7', \`assetPhotosRequired\` tinyint NOT NULL DEFAULT 0, \`assetPhotoRetentionDays\` int NOT NULL DEFAULT '30', \`updatedAt\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3), UNIQUE INDEX \`IDX_2791750c67bb876aeca38f7da7\` (\`tenantId\`, \`countryCode\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`sites\` (\`id\` varchar(36) NOT NULL, \`tenantId\` varchar(255) NOT NULL, \`code\` varchar(16) NOT NULL, \`name\` varchar(120) NOT NULL, \`countryCode\` varchar(2) NOT NULL, \`timezone\` varchar(64) NOT NULL, \`active\` tinyint NOT NULL DEFAULT 1, \`createdAt\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), UNIQUE INDEX \`IDX_cdcc9e7b8204e5886e31a26ffc\` (\`tenantId\`, \`code\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`devices\` (\`id\` varchar(36) NOT NULL, \`tenantId\` varchar(255) NOT NULL, \`siteId\` varchar(255) NOT NULL, \`name\` varchar(80) NOT NULL, \`tokenHash\` char(64) NOT NULL, \`createdBy\` varchar(255) NULL, \`createdAt\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), \`lastSeenAt\` datetime(3) NULL, \`revokedAt\` datetime(3) NULL, UNIQUE INDEX \`IDX_8d6f603fe8f34ce155c1cf723c\` (\`tokenHash\`), INDEX \`IDX_6697c204cde9adc56ce65e5068\` (\`tenantId\`, \`siteId\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`pairing_codes\` (\`id\` varchar(36) NOT NULL, \`tenantId\` varchar(255) NOT NULL, \`siteId\` varchar(255) NOT NULL, \`deviceName\` varchar(80) NOT NULL, \`codeHash\` char(64) NOT NULL, \`expiresAt\` datetime(3) NOT NULL, \`usedAt\` datetime(3) NULL, \`createdBy\` varchar(255) NOT NULL, \`createdAt\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), UNIQUE INDEX \`IDX_597cc017349f387c9632234614\` (\`codeHash\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`privacy_notices\` (\`id\` varchar(36) NOT NULL, \`tenantId\` varchar(255) NOT NULL, \`countryCode\` varchar(2) NOT NULL, \`locale\` varchar(5) NOT NULL, \`version\` int NOT NULL, \`title\` varchar(200) NOT NULL, \`body\` text NOT NULL, \`createdBy\` varchar(255) NULL, \`createdAt\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), UNIQUE INDEX \`IDX_281f1a997492ece710c9d0e254\` (\`tenantId\`, \`countryCode\`, \`locale\`, \`version\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`visits\` (\`id\` varchar(36) NOT NULL, \`tenantId\` varchar(255) NOT NULL, \`siteId\` varchar(255) NOT NULL, \`status\` varchar(12) NOT NULL, \`code\` varchar(8) NOT NULL, \`checkInAt\` datetime(3) NOT NULL, \`checkOutAt\` datetime(3) NULL, \`checkInDeviceId\` varchar(255) NULL, \`checkOutBy\` varchar(80) NULL, \`firstNameEnc\` text NULL, \`lastNameEnc\` text NULL, \`lastNameIndex\` char(64) NULL, \`companyEnc\` text NULL, \`emailEnc\` text NULL, \`emailIndex\` char(64) NULL, \`hostEnc\` text NULL, \`purpose\` varchar(20) NOT NULL, \`documentType\` varchar(20) NULL, \`documentNumberEnc\` text NULL, \`locale\` varchar(5) NOT NULL, \`privacyNoticeId\` varchar(255) NOT NULL, \`privacyNoticeVersion\` int NOT NULL, \`privacyAcceptedAt\` datetime(3) NOT NULL, \`noticeEmailStatus\` varchar(16) NOT NULL, \`noticeEmailAttempts\` tinyint NOT NULL DEFAULT '0', \`anonymizedAt\` datetime(3) NULL, \`createdAt\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), INDEX \`IDX_93a894ab618bfd7b0d40b966e6\` (\`lastNameIndex\`), INDEX \`IDX_8875012cfd70f68f6177bd8cb9\` (\`emailIndex\`), INDEX \`IDX_4f300273ee777972881751cbba\` (\`noticeEmailStatus\`), INDEX \`IDX_59f495323ddcbea584ff8d7920\` (\`tenantId\`, \`checkInAt\`), INDEX \`IDX_ff860f3bef749c9147be781bb9\` (\`tenantId\`, \`siteId\`, \`status\`), INDEX \`IDX_bc3b722d2e7dc572d6d3203779\` (\`tenantId\`, \`siteId\`, \`checkInAt\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`stored_files\` (\`id\` varchar(36) NOT NULL, \`tenantId\` varchar(255) NOT NULL, \`visitId\` varchar(255) NOT NULL, \`kind\` varchar(16) NOT NULL, \`keyId\` varchar(8) NOT NULL, \`mime\` varchar(32) NOT NULL, \`size\` int NOT NULL, \`storagePath\` varchar(255) NOT NULL, \`purgeAfter\` datetime(3) NOT NULL, \`purgedAt\` datetime(3) NULL, \`createdAt\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), INDEX \`IDX_4b1ff723e94ac03b716d49229c\` (\`purgeAfter\`, \`purgedAt\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`tenants\` (\`id\` varchar(36) NOT NULL, \`slug\` varchar(40) NOT NULL, \`name\` varchar(120) NOT NULL, \`status\` varchar(12) NOT NULL DEFAULT 'ACTIVE', \`dataKeyId\` varchar(8) NOT NULL, \`dataKeysWrapped\` text NOT NULL, \`blindIndexKeyWrapped\` text NOT NULL, \`maxSites\` int NULL, \`maxDevices\` int NULL, \`maxUsers\` int NULL, \`logoDataUrl\` mediumtext NULL, \`createdAt\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), UNIQUE INDEX \`IDX_2310ecc5cb8be427097154b18f\` (\`slug\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`users\` (\`id\` varchar(36) NOT NULL, \`tenantId\` varchar(255) NOT NULL, \`email\` varchar(190) NOT NULL, \`displayName\` varchar(120) NOT NULL, \`passwordHash\` varchar(255) NOT NULL, \`role\` varchar(20) NOT NULL, \`active\` tinyint NOT NULL DEFAULT 1, \`mustChangePassword\` tinyint NOT NULL DEFAULT 1, \`sessionVersion\` int NOT NULL DEFAULT '0', \`failedLogins\` int NOT NULL DEFAULT '0', \`lockedUntil\` datetime(3) NULL, \`lastLoginAt\` datetime(3) NULL, \`createdAt\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), UNIQUE INDEX \`IDX_7346b08032078107fce81e014f\` (\`tenantId\`, \`email\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`user_sites\` (\`userId\` varchar(36) NOT NULL, \`siteId\` varchar(36) NOT NULL, INDEX \`IDX_832c931a178f7619cd565b4a66\` (\`userId\`), INDEX \`IDX_f4e0fdd55e0d722a9167890539\` (\`siteId\`), PRIMARY KEY (\`userId\`, \`siteId\`)) ENGINE=InnoDB`);
        await queryRunner.query(`ALTER TABLE \`devices\` ADD CONSTRAINT \`FK_94d5e76a8d2ecbb9f905886eece\` FOREIGN KEY (\`siteId\`) REFERENCES \`sites\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`visits\` ADD CONSTRAINT \`FK_1ecaa5b0cf9f52cc4aafa5ad549\` FOREIGN KEY (\`siteId\`) REFERENCES \`sites\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`stored_files\` ADD CONSTRAINT \`FK_c60a4604fcdfc3a0223ca874078\` FOREIGN KEY (\`visitId\`) REFERENCES \`visits\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`user_sites\` ADD CONSTRAINT \`FK_832c931a178f7619cd565b4a665\` FOREIGN KEY (\`userId\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE \`user_sites\` ADD CONSTRAINT \`FK_f4e0fdd55e0d722a91678905394\` FOREIGN KEY (\`siteId\`) REFERENCES \`sites\`(\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`user_sites\` DROP FOREIGN KEY \`FK_f4e0fdd55e0d722a91678905394\``);
        await queryRunner.query(`ALTER TABLE \`user_sites\` DROP FOREIGN KEY \`FK_832c931a178f7619cd565b4a665\``);
        await queryRunner.query(`ALTER TABLE \`stored_files\` DROP FOREIGN KEY \`FK_c60a4604fcdfc3a0223ca874078\``);
        await queryRunner.query(`ALTER TABLE \`visits\` DROP FOREIGN KEY \`FK_1ecaa5b0cf9f52cc4aafa5ad549\``);
        await queryRunner.query(`ALTER TABLE \`devices\` DROP FOREIGN KEY \`FK_94d5e76a8d2ecbb9f905886eece\``);
        await queryRunner.query(`DROP INDEX \`IDX_f4e0fdd55e0d722a9167890539\` ON \`user_sites\``);
        await queryRunner.query(`DROP INDEX \`IDX_832c931a178f7619cd565b4a66\` ON \`user_sites\``);
        await queryRunner.query(`DROP TABLE \`user_sites\``);
        await queryRunner.query(`DROP INDEX \`IDX_7346b08032078107fce81e014f\` ON \`users\``);
        await queryRunner.query(`DROP TABLE \`users\``);
        await queryRunner.query(`DROP INDEX \`IDX_2310ecc5cb8be427097154b18f\` ON \`tenants\``);
        await queryRunner.query(`DROP TABLE \`tenants\``);
        await queryRunner.query(`DROP INDEX \`IDX_4b1ff723e94ac03b716d49229c\` ON \`stored_files\``);
        await queryRunner.query(`DROP TABLE \`stored_files\``);
        await queryRunner.query(`DROP INDEX \`IDX_bc3b722d2e7dc572d6d3203779\` ON \`visits\``);
        await queryRunner.query(`DROP INDEX \`IDX_ff860f3bef749c9147be781bb9\` ON \`visits\``);
        await queryRunner.query(`DROP INDEX \`IDX_59f495323ddcbea584ff8d7920\` ON \`visits\``);
        await queryRunner.query(`DROP INDEX \`IDX_4f300273ee777972881751cbba\` ON \`visits\``);
        await queryRunner.query(`DROP INDEX \`IDX_8875012cfd70f68f6177bd8cb9\` ON \`visits\``);
        await queryRunner.query(`DROP INDEX \`IDX_93a894ab618bfd7b0d40b966e6\` ON \`visits\``);
        await queryRunner.query(`DROP TABLE \`visits\``);
        await queryRunner.query(`DROP INDEX \`IDX_281f1a997492ece710c9d0e254\` ON \`privacy_notices\``);
        await queryRunner.query(`DROP TABLE \`privacy_notices\``);
        await queryRunner.query(`DROP INDEX \`IDX_597cc017349f387c9632234614\` ON \`pairing_codes\``);
        await queryRunner.query(`DROP TABLE \`pairing_codes\``);
        await queryRunner.query(`DROP INDEX \`IDX_6697c204cde9adc56ce65e5068\` ON \`devices\``);
        await queryRunner.query(`DROP INDEX \`IDX_8d6f603fe8f34ce155c1cf723c\` ON \`devices\``);
        await queryRunner.query(`DROP TABLE \`devices\``);
        await queryRunner.query(`DROP INDEX \`IDX_cdcc9e7b8204e5886e31a26ffc\` ON \`sites\``);
        await queryRunner.query(`DROP TABLE \`sites\``);
        await queryRunner.query(`DROP INDEX \`IDX_2791750c67bb876aeca38f7da7\` ON \`country_policies\``);
        await queryRunner.query(`DROP TABLE \`country_policies\``);
        await queryRunner.query(`DROP INDEX \`IDX_cb5f3f71cb985e63b8617ce4c9\` ON \`audit_logs\``);
        await queryRunner.query(`DROP INDEX \`IDX_43b6015f9c67eaa8217a80f466\` ON \`audit_logs\``);
        await queryRunner.query(`DROP INDEX \`IDX_b1242ad5160aac0feb5da4aa15\` ON \`audit_logs\``);
        await queryRunner.query(`DROP TABLE \`audit_logs\``);
    }

}
