/**
 * The apps of the portal. The shared data (employees, jobs, sites, console users) is always there;
 * each app is turned on per organisation, and per employee where it concerns them.
 *  - reception: visitors at the tablet, invitations, evacuation roll call, site documents;
 *  - access: doors and readers, the phone badge that opens them;
 *  - parcels: parcels and letters left at reception.
 */
export const APP_KEYS = ['reception', 'access', 'parcels'] as const;
export type AppKey = (typeof APP_KEYS)[number];
/** What an organisation had before apps could be turned off: everything. */
export const DEFAULT_APPS: AppKey[] = ['reception', 'access', 'parcels'];

/** Comma-separated list in a varchar column, unknown names dropped (an app removed in a later version). */
export const appListTransformer = {
  // Not set (a new organisation or employee): the column default applies.
  to: (v: string[] | undefined | null) => (v === undefined ? undefined : (v ?? []).join(',')),
  // TypeORM also passes back what it just wrote (an array) after an insert.
  from: (v: string | string[] | null): AppKey[] => (Array.isArray(v) ? v : typeof v === 'string' && v ? v.split(',') : [])
    .filter((x): x is AppKey => (APP_KEYS as readonly string[]).includes(x)),
};

/** The apps an employee sees: those of the organisation, minus the ones turned off for them. */
export const employeeApps = (tenantApps: AppKey[], appsOff: AppKey[]) => tenantApps.filter((a) => !appsOff.includes(a));

