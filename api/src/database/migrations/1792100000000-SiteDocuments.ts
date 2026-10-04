import { MigrationInterface, QueryRunner } from "typeorm";

/** Documents to accept at check-in (safety rules, NDA), versioned per language, and their acceptances. */
export class SiteDocuments1792100000000 implements MigrationInterface {
    name = 'SiteDocuments1792100000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE \`site_documents\` (\`id\` varchar(36) NOT NULL, \`tenantId\` varchar(255) NOT NULL, \`siteId\` varchar(255) NULL, \`name\` varchar(120) NOT NULL, \`active\` tinyint NOT NULL DEFAULT 1, \`position\` int NOT NULL DEFAULT '0', \`createdAt\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), \`updatedAt\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3), INDEX \`IDX_site_documents_tenant\` (\`tenantId\`, \`active\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`site_document_versions\` (\`id\` varchar(36) NOT NULL, \`tenantId\` varchar(255) NOT NULL, \`documentId\` varchar(255) NOT NULL, \`locale\` varchar(5) NOT NULL, \`version\` int NOT NULL, \`title\` varchar(200) NOT NULL, \`body\` text NOT NULL, \`createdBy\` varchar(255) NULL, \`createdAt\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), UNIQUE INDEX \`IDX_site_document_versions_doc\` (\`documentId\`, \`locale\`, \`version\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`visit_documents\` (\`id\` varchar(36) NOT NULL, \`tenantId\` varchar(255) NOT NULL, \`visitId\` varchar(255) NOT NULL, \`documentId\` varchar(255) NOT NULL, \`versionId\` varchar(255) NOT NULL, \`acceptedAt\` datetime(3) NOT NULL, INDEX \`IDX_visit_documents_visit\` (\`visitId\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE \`visit_documents\``);
        await queryRunner.query(`DROP TABLE \`site_document_versions\``);
        await queryRunner.query(`DROP TABLE \`site_documents\``);
    }

}
