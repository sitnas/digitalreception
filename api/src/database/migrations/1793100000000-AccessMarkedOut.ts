import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * "Segna come uscito": the reception records by hand that an employee left (no badge at the way out,
 * no reader there, a reader that refused). The access log gets a synthetic way out with method MAN and
 * reason MARKED_OUT, which has no door and no reader: both columns become NULL-able. method (varchar(4))
 * and reason (varchar(24)) already fit 'MAN' and 'MARKED_OUT'.
 *
 * The dashboard's door counts leave the manual ways out aside (method <> 'MAN'). They are answered from
 * the (tenant, site, result, time) index alone (docs/CARICO.md): method goes at the end of that index so
 * they still are, instead of reading every row of the day. One ALTER, as changing NULL-ability rebuilds
 * the table anyway. The list of who is inside reads the same index.
 *
 * down: the columns cannot go back to NOT NULL while the manual ways out are there, so they are
 * deleted first (method = 'MAN', the only rows without a door). Going back loses them: after the
 * rollback those people count as inside again until their next way out at a reader.
 */
export class AccessMarkedOut1793100000000 implements MigrationInterface {
    name = 'AccessMarkedOut1793100000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`access_events\` MODIFY \`doorId\` varchar(255) NULL, MODIFY \`readerId\` varchar(255) NULL, DROP INDEX \`IDX_access_events_site_at\`, ADD INDEX \`IDX_access_events_site_at\` (\`tenantId\`, \`siteId\`, \`result\`, \`at\`, \`method\`)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DELETE FROM \`access_events\` WHERE \`method\` = 'MAN'`);
        await queryRunner.query(`ALTER TABLE \`access_events\` MODIFY \`doorId\` varchar(255) NOT NULL, MODIFY \`readerId\` varchar(255) NOT NULL, DROP INDEX \`IDX_access_events_site_at\`, ADD INDEX \`IDX_access_events_site_at\` (\`tenantId\`, \`siteId\`, \`result\`, \`at\`)`);
    }

}
