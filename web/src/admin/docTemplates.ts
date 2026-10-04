/**
 * Starting texts for the documents guests accept at check-in. They are drafts: the organisation
 * completes the parts in square brackets and has them checked (RSPP for safety, legal for the NDA).
 */
export type TemplateKind = 'safety' | 'nda';
type Text = { title: string; body: string };

export const DOC_TEMPLATES: Record<TemplateKind, { name: Record<'it' | 'es' | 'en', string>; texts: Record<'it' | 'es' | 'en', Text> }> = {
  safety: {
    name: { it: 'Informazioni di sicurezza (D.Lgs. 81/08)', es: 'Información de seguridad', en: 'Safety information' },
    texts: {
      it: {
        title: 'Informazioni di sicurezza per gli ospiti',
        body: `Queste informazioni ti vengono date ai sensi del D.Lgs. 81/08 prima di entrare in [nome della sede].

Durante la visita resta con la persona che ti ospita e non entrare nelle aree segnalate come riservate al personale, nei laboratori o nei magazzini se non sei accompagnato.

Se suona l'allarme, interrompi quello che stai facendo e segui le indicazioni degli addetti all'emergenza. Esci dall'uscita di sicurezza più vicina seguendo i cartelli verdi, non usare gli ascensori e raggiungi il punto di raccolta [posizione del punto di raccolta]. Non allontanarti finché non ti hanno contato: in reception sanno che sei in sede.

In caso di infortunio o malore avvisa subito la persona che ti ospita o la reception (interno [numero]). Il numero unico di emergenza è 112.

È vietato fumare in tutti gli ambienti, compresi i locali tecnici. Rispetta i cartelli di obbligo e divieto e, dove richiesti, indossa i dispositivi di protezione che ti consegniamo.

Responsabile del servizio di prevenzione e protezione: [nome e contatto RSPP].`,
      },
      es: {
        title: 'Información de seguridad para visitantes',
        body: `Le facilitamos esta información antes de entrar en [nombre de la sede].

Durante la visita permanezca con la persona que le recibe y no entre en zonas reservadas al personal, laboratorios o almacenes sin acompañante.

Si suena la alarma, deje lo que esté haciendo y siga las indicaciones del personal de emergencias. Salga por la salida de emergencia más cercana siguiendo las señales verdes, no use los ascensores y diríjase al punto de encuentro [ubicación del punto de encuentro]. No se vaya hasta que le hayan contado: en recepción saben que está en el edificio.

En caso de accidente o malestar avise enseguida a la persona que le recibe o a recepción (extensión [número]). El teléfono de emergencias es el 112.

Está prohibido fumar en todo el edificio. Respete las señales de obligación y prohibición y, donde se pidan, use los equipos de protección que le entreguemos.

Responsable de prevención de riesgos: [nombre y contacto].`,
      },
      en: {
        title: 'Safety information for visitors',
        body: `Please read this before entering [site name].

Stay with the person you are visiting, and don't enter staff-only areas, labs or warehouses unless someone goes with you.

If the alarm sounds, stop what you are doing and follow the emergency team. Leave by the nearest emergency exit following the green signs, don't use the lifts, and go to the assembly point at [assembly point location]. Stay there until you have been counted: reception knows you are in the building.

If you are injured or feel unwell, tell the person you are visiting or reception (extension [number]) straight away. The emergency number is 112.

Smoking is not allowed anywhere on site. Follow the mandatory and prohibition signs and, where asked, wear the protective equipment we give you.

Health and safety contact: [name and contact].`,
      },
    },
  },
  nda: {
    name: { it: 'Accordo di riservatezza', es: 'Acuerdo de confidencialidad', en: 'Non-disclosure agreement' },
    texts: {
      it: {
        title: 'Impegno di riservatezza',
        body: `Durante la visita a [ragione sociale] potresti vedere o ascoltare informazioni non pubbliche: progetti, prodotti in sviluppo, dati di clienti e fornitori, processi, documenti e schermi.

Accettando ti impegni a non divulgarle a terzi, a non usarle per scopi diversi dalla visita e a non fotografare, filmare o registrare senza l'autorizzazione della persona che ti ospita.

L'impegno non riguarda le informazioni già pubbliche o che conoscevi prima della visita per altra via. Resta valido per [durata, per esempio 5 anni] dalla data della visita.

Se la tua azienda ha già firmato un accordo di riservatezza con [ragione sociale], vale quello e questo testo lo integra.`,
      },
      es: {
        title: 'Compromiso de confidencialidad',
        body: `Durante su visita a [razón social] puede ver u oír información no pública: proyectos, productos en desarrollo, datos de clientes y proveedores, procesos, documentos y pantallas.

Al aceptar se compromete a no divulgarla a terceros, a no usarla para fines distintos de la visita y a no hacer fotos, vídeos ni grabaciones sin la autorización de la persona que le recibe.

El compromiso no afecta a la información ya pública o que conociera antes de la visita por otra vía. Es válido durante [duración, por ejemplo 5 años] desde la fecha de la visita.

Si su empresa ya ha firmado un acuerdo de confidencialidad con [razón social], prevalece ese acuerdo y este texto lo completa.`,
      },
      en: {
        title: 'Confidentiality undertaking',
        body: `During your visit to [company name] you may see or hear information that isn't public: projects, products in development, customer and supplier data, processes, documents and screens.

By accepting you agree not to disclose it to anyone, not to use it for anything other than the visit, and not to take photos, video or recordings without permission from the person you are visiting.

This doesn't cover information that is already public or that you knew before the visit from another source. It applies for [duration, for example 5 years] from the date of the visit.

If your company has already signed a non-disclosure agreement with [company name], that agreement applies and this text adds to it.`,
      },
    },
  },
};
