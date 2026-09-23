/**
 * STARTING TEMPLATES ONLY - they must be reviewed and completed by the DPO / legal
 * department of each country before go-live. Placeholders in [square brackets].
 * {{visitRetentionDays}} is replaced at runtime with the value configured for the country.
 */
type Lang = 'it' | 'es' | 'en';

const authority: Record<string, Record<Lang, string>> = {
  IT: { it: 'il Garante per la protezione dei dati personali (www.garanteprivacy.it)', es: 'el Garante per la protezione dei dati personali (Italia)', en: 'the Italian Data Protection Authority (Garante)' },
  ES: { it: "l'Agencia Española de Protección de Datos (AEPD)", es: 'la Agencia Española de Protección de Datos (www.aepd.es)', en: 'the Spanish Data Protection Agency (AEPD)' },
  PE: { it: "l'Autoridad Nacional de Protección de Datos Personales (Perù)", es: 'la Autoridad Nacional de Protección de Datos Personales del MINJUSDH', en: 'the Peruvian National Data Protection Authority' },
  CO: { it: 'la Superintendencia de Industria y Comercio (Colombia)', es: 'la Superintendencia de Industria y Comercio (SIC)', en: 'the Colombian Superintendence of Industry and Commerce (SIC)' },
};

const law: Record<string, Record<Lang, string>> = {
  IT: { it: 'Regolamento (UE) 2016/679 (GDPR) e D.Lgs. 196/2003', es: 'Reglamento (UE) 2016/679 (RGPD)', en: 'Regulation (EU) 2016/679 (GDPR)' },
  ES: { it: 'Regolamento (UE) 2016/679 e Ley Orgánica 3/2018', es: 'Reglamento (UE) 2016/679 (RGPD) y Ley Orgánica 3/2018 (LOPDGDD)', en: 'Regulation (EU) 2016/679 (GDPR) and Organic Law 3/2018' },
  PE: { it: 'Ley N.º 29733 e relativo Regolamento', es: 'Ley N.º 29733, Ley de Protección de Datos Personales, y su Reglamento (D.S. 016-2024-JUS)', en: 'Law No. 29733 on Personal Data Protection and its Regulation' },
  CO: { it: 'Ley 1581 del 2012 e Decreto 1377 del 2013', es: 'Ley Estatutaria 1581 de 2012 y Decreto 1377 de 2013 (compilado en el Decreto 1074 de 2015)', en: 'Statutory Law 1581 of 2012 and Decree 1377 of 2013' },
};

const legalBasis: Record<string, Record<Lang, string>> = {
  EU: {
    it: "legittimo interesse del Titolare alla sicurezza di persone e beni (art. 6.1.f GDPR) e adempimento degli obblighi in materia di gestione delle emergenze (art. 6.1.c GDPR). Il conferimento dei dati è necessario per accedere alla sede.",
    es: 'interés legítimo del Responsable en la seguridad de personas y bienes (art. 6.1.f RGPD) y cumplimiento de obligaciones legales de gestión de emergencias (art. 6.1.c RGPD). Facilitar los datos es necesario para acceder a la sede.',
    en: "the controller's legitimate interest in the security of people and property (Art. 6(1)(f) GDPR) and compliance with emergency-management obligations (Art. 6(1)(c) GDPR). Providing the data is necessary to access the premises.",
  },
  LATAM: {
    it: 'consenso espresso, libero e informato, che fornisci firmando sul tablet. Senza il consenso non è possibile registrare l’accesso alla sede.',
    es: 'su consentimiento previo, expreso e informado, que otorga al firmar en la tableta. Sin su autorización no es posible registrar el acceso a la sede.',
    en: 'your prior, express and informed consent, given by signing on the tablet. Without it, access to the premises cannot be registered.',
  },
};

const EEA = new Set('AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE IS LI NO'.split(' '));
const CONSENT_BASED = new Set(['PE', 'CO']);

const genericLaw: Record<'EEA' | 'OTHER', Record<Lang, string>> = {
  EEA: { it: 'Regolamento (UE) 2016/679 (GDPR) e [NORMATIVA NAZIONALE]', es: 'Reglamento (UE) 2016/679 (RGPD) y [NORMATIVA NACIONAL]', en: 'Regulation (EU) 2016/679 (GDPR) and [NATIONAL LAW]' },
  OTHER: { it: '[NORMATIVA APPLICABILE]', es: '[NORMATIVA APLICABLE]', en: '[APPLICABLE LAW]' },
};
const genericAuthority: Record<Lang, string> = { it: "[AUTORITÀ DI CONTROLLO COMPETENTE]", es: '[AUTORIDAD DE CONTROL COMPETENTE]', en: '[COMPETENT SUPERVISORY AUTHORITY]' };
const genericBasis: Record<Lang, string> = { it: '[BASE GIURIDICA DA DEFINIRE CON IL DPO]', es: '[BASE JURÍDICA A DEFINIR CON EL DPO]', en: '[LEGAL BASIS TO BE DEFINED WITH THE DPO]' };

/** Known countries get a pre-filled draft; any other country gets a template with explicit placeholders. */
function body(cc: string, lang: Lang): string {
  const basis = EEA.has(cc) ? legalBasis.EU[lang] : CONSENT_BASED.has(cc) ? legalBasis.LATAM[lang] : genericBasis[lang];
  const L = law[cc]?.[lang] ?? genericLaw[EEA.has(cc) ? 'EEA' : 'OTHER'][lang];
  const A = authority[cc]?.[lang] ?? genericAuthority[lang];
  if (lang === 'it') return [
    `Informativa resa ai sensi di: ${L}.`,
    `Titolare del trattamento: [RAGIONE SOCIALE], [INDIRIZZO]. Responsabile della protezione dei dati (DPO): [EMAIL DPO].`,
    `Dati trattati: nome, cognome, azienda di provenienza, email (facoltativa), persona di riferimento, motivo della visita, distanza percorsa per raggiungere la sede (fascia), orari di ingresso e uscita, firma. Ove previsto dalla sede: tipo e numero del documento di identità, foto del documento, foto del numero di serie del computer portatile.`,
    `Finalità: controllo degli accessi e sicurezza di persone e beni, gestione delle emergenze e dell'evacuazione (elenco dei presenti), statistiche aggregate sulla provenienza dei visitatori, invio via email del badge di uscita e, su richiesta, della presente informativa.`,
    `Base giuridica: ${basis}`,
    `Conservazione: i dati sono conservati per {{visitRetentionDays}} giorni dall'ingresso e poi anonimizzati in modo irreversibile; le eventuali foto sono cancellate prima, secondo i tempi stabiliti per la sede. I dati sono cifrati e accessibili solo a personale autorizzato; ogni consultazione viene registrata.`,
    `Destinatari: personale di reception e sicurezza autorizzato, fornitori IT nominati responsabili del trattamento. I dati non sono diffusi. [TRASFERIMENTI EXTRA UE: DA VALUTARE CON IL DPO].`,
    `Diritti: puoi chiedere accesso, rettifica, cancellazione, limitazione e opporti al trattamento scrivendo a [EMAIL PRIVACY]. Hai diritto di proporre reclamo a ${A}.`,
  ].join('\n');
  if (lang === 'es') return [
    `Información facilitada conforme a: ${L}.`,
    `Responsable del tratamiento: [RAZÓN SOCIAL], [DIRECCIÓN]. Delegado de Protección de Datos / Oficial de datos: [EMAIL].`,
    `Datos tratados: nombre, apellidos, empresa, correo electrónico (opcional), persona de contacto, motivo de la visita, distancia recorrida para llegar a la sede (tramo), horas de entrada y salida y firma. Cuando la sede lo requiera: tipo y número de documento de identidad, foto del documento y foto del número de serie del portátil.`,
    `Finalidad: control de accesos, seguridad de personas y bienes, gestión de emergencias y evacuación (listado de presentes), estadísticas agregadas sobre la procedencia de los visitantes, envío por correo de la credencial de salida y, si se solicita, de esta información.`,
    `Base jurídica: ${basis}`,
    `Conservación: los datos se conservan durante {{visitRetentionDays}} días desde la entrada y después se anonimizan de forma irreversible; las fotos se eliminan antes, según los plazos definidos para la sede. Los datos están cifrados, solo el personal autorizado puede consultarlos y cada consulta queda registrada.`,
    `Destinatarios: personal autorizado de recepción y seguridad y proveedores informáticos en calidad de encargados. No se ceden a terceros. [TRANSFERENCIAS INTERNACIONALES: A VALORAR CON EL DPO].`,
    `Derechos: puede ejercer sus derechos de acceso, rectificación, supresión, oposición y limitación (derechos ARCO) escribiendo a [EMAIL PRIVACIDAD]. Puede presentar una reclamación ante ${A}.`,
  ].join('\n');
  return [
    `Notice provided under: ${L}.`,
    `Controller: [COMPANY NAME], [ADDRESS]. Data protection officer: [DPO EMAIL].`,
    `Data processed: first and last name, company, email (optional), host, purpose of visit, distance travelled to reach the site (range), entry and exit times, signature. Where required by the site: identity document type and number, document photo, photo of the laptop serial number.`,
    `Purposes: access control and security of people and property, emergency and evacuation management (list of people on site), aggregate statistics on where visitors come from, emailing the exit badge and, on request, this notice.`,
    `Legal basis: ${basis}`,
    `Retention: data is kept for {{visitRetentionDays}} days from entry and then irreversibly anonymised; any photos are deleted earlier, according to the site's rules. Data is encrypted, accessible only to authorised staff, and every access is logged.`,
    `Recipients: authorised reception and security staff, IT providers acting as processors. Data is never disclosed publicly. [INTERNATIONAL TRANSFERS: TO BE ASSESSED WITH THE DPO].`,
    `Your rights: access, rectification, erasure, restriction and objection, by writing to [PRIVACY EMAIL]. You may lodge a complaint with ${A}.`,
  ].join('\n');
}

const titles: Record<Lang, string> = {
  it: 'Informativa privacy per i visitatori',
  es: 'Información sobre protección de datos para visitantes',
  en: 'Privacy notice for visitors',
};

export function noticeTemplate(countryCode: string, locale: Lang) {
  return { title: titles[locale], body: body(countryCode, locale) };
}
