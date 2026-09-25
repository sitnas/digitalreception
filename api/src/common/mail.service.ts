import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import nodemailer, { Transporter } from 'nodemailer';
import type Mail from 'nodemailer/lib/mailer';
type Attachment = Mail.Attachment;
import { APP_CONFIG, AppConfig } from './app-config';
import { exitQrPng, inviteQrPayload, qrPng } from './exit-qr';

/** Sends the privacy notice and the exit badge, through the configured SMTP relay (STARTTLS mandatory). */
@Injectable()
export class MailService implements OnApplicationBootstrap {
  private readonly log = new Logger(MailService.name);
  private readonly transport: Transporter | null;

  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {
    this.transport = cfg.mail.host
      ? nodemailer.createTransport({
          host: cfg.mail.host, port: cfg.mail.port, secure: cfg.mail.secure,
          auth: cfg.mail.user ? { user: cfg.mail.user, pass: cfg.mail.pass } : undefined,
          requireTLS: !cfg.mail.secure, pool: true, maxConnections: 3,
        })
      : null;
  }

  get enabled(): boolean { return this.transport !== null; }
  get from(): string { return this.cfg.mail.from; }

  /** Says at startup whether email works, so a missing or wrong SMTP setup is visible in the logs. */
  async onApplicationBootstrap() {
    if (!this.transport) { this.log.warn('Email disabled: SMTP_HOST is not set. Privacy notices, exit badges and host arrival notices will not be sent.'); return; }
    try { await this.transport.verify(); this.log.log(`SMTP ready (${this.cfg.mail.host}:${this.cfg.mail.port}).`); }
    catch (e) { this.log.error(`SMTP check failed (${this.cfg.mail.host}:${this.cfg.mail.port}): ${(e as Error).message}`); }
  }

  /** Test message for the console: returns the SMTP error so the administrator can fix the setup. */
  async sendTest(to: string, fromName: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.transport) return { ok: false, error: 'SMTP_HOST not set' };
    const text = 'Email is configured correctly: visitors and hosts will receive their messages.\nL’invio email è configurato correttamente.';
    try {
      await this.transport.sendMail({ from: { name: fromName, address: this.cfg.mail.from }, to, subject: `${fromName} - test email`, text });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message.slice(0, 300) };
    }
  }

  async sendNotice(to: string, fromName: string, title: string, body: string, siteName: string): Promise<boolean> {
    return this.send(to, fromName, `${title} - ${siteName}`, body,
      `<div style="font-family:Arial,sans-serif;max-width:640px;line-height:1.5"><h2>${esc(title)}</h2>${esc(body).split('\n').map((l) => `<p>${l}</p>`).join('')}</div>`);
  }

  /** Exit badge: the visit code the visitor types on the tablet when leaving. */
  async sendBadge(to: string, fromName: string, b: BadgeMail): Promise<boolean> {
    const s = BADGE_STRINGS[b.locale as keyof typeof BADGE_STRINGS] ?? BADGE_STRINGS.en;
    const when = new Intl.DateTimeFormat(b.locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: b.timezone }).format(b.checkInAt);
    const text = [`${s.title} - ${b.siteName}`, '', `${s.visitor}: ${b.visitorLabel}`, `${s.host}: ${b.hostName}`, `${s.checkIn}: ${when}`, '', `${s.code}: ${b.code}`, '', s.hint].join('\n');
    const primary = b.primaryColor ?? DEFAULT_PRIMARY;
    const secondary = b.secondaryColor ?? DEFAULT_SECONDARY;
    const onPrimary = readableOn(primary);
    const onSecondary = readableOn(secondary);
    const html = `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;line-height:1.5;color:#1A1A1A">
<div style="border:1px solid ${secondary};border-radius:14px;overflow:hidden;text-align:center;background:${primary};color:${onPrimary}">
<div style="background:${secondary};color:${onSecondary};padding:14px 18px;font-weight:700">${esc(fromName)}<br><span style="font-weight:400;opacity:.8">${esc(b.siteName)}</span></div>
<div style="padding:22px 18px">
<div style="font-size:22px;font-weight:700">${esc(b.visitorLabel)}</div>
<div style="margin-top:4px;opacity:.8">${esc(s.host)}: ${esc(b.hostName)}</div>
<div style="margin-top:20px;font-size:13px;text-transform:uppercase;letter-spacing:.08em;opacity:.8">${esc(s.code)}</div>
<div style="font-size:44px;font-weight:700;letter-spacing:.2em;font-family:'Courier New',monospace">${esc(b.code)}</div>
<div style="display:inline-block;margin-top:14px;background:#FFFFFF;border-radius:10px;padding:8px;line-height:0"><img src="cid:exit-qr" width="180" height="180" alt="QR ${esc(b.code)}" style="display:block"></div>
<div style="margin-top:14px;opacity:.8">${esc(s.checkIn)}: ${esc(when)}</div>
</div></div>
<p style="margin-top:16px">${esc(s.hint)}</p></div>`;
    const qr = await exitQrPng(b.code);
    return this.send(to, fromName, `${s.title} - ${b.siteName}`, text, html, [{ filename: `badge-${b.code}.png`, content: qr, cid: 'exit-qr', contentType: 'image/png' }]);
  }

  /** Tells the host that their visitor has checked in. Only what the host needs: name, company, time, reason. */
  async sendHostArrival(to: string, fromName: string, a: HostArrivalMail): Promise<boolean> {
    const s = ARRIVAL_STRINGS[a.locale as keyof typeof ARRIVAL_STRINGS] ?? ARRIVAL_STRINGS.en;
    const when = new Intl.DateTimeFormat(a.locale, { timeStyle: 'short', timeZone: a.timezone }).format(a.checkInAt);
    const who = a.company ? `${a.visitorName} (${a.company})` : a.visitorName;
    const purpose = s.purposes[a.purpose as keyof typeof s.purposes] ?? a.purpose;
    const subject = `${s.subject}: ${who}`;
    const text = [`${s.title}`, '', `${s.visitor}: ${who}`, `${s.purpose}: ${purpose}`, `${s.site}: ${a.siteName}`, `${s.time}: ${when}`, '', s.footer].join('\n');
    const primary = a.primaryColor ?? DEFAULT_PRIMARY;
    const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;line-height:1.5;color:#1A1A1A">
<div style="border-left:4px solid ${primary};padding:4px 0 4px 16px;margin-bottom:16px"><div style="font-size:13px;color:#5C5C58">${esc(fromName)} · ${esc(a.siteName)}</div>
<div style="font-size:20px;font-weight:700">${esc(s.title)}</div></div>
<table style="border-collapse:collapse;font-size:15px">
<tr><td style="padding:4px 16px 4px 0;color:#5C5C58">${esc(s.visitor)}</td><td style="padding:4px 0;font-weight:700">${esc(who)}</td></tr>
<tr><td style="padding:4px 16px 4px 0;color:#5C5C58">${esc(s.purpose)}</td><td style="padding:4px 0">${esc(purpose)}</td></tr>
<tr><td style="padding:4px 16px 4px 0;color:#5C5C58">${esc(s.time)}</td><td style="padding:4px 0">${esc(when)}</td></tr>
</table>
<p style="margin-top:16px;font-size:13px;color:#5C5C58">${esc(s.footer)}</p></div>`;
    return this.send(to, fromName, subject, text, html);
  }

  /** Invitation: when and where the guest is expected, with the QR that fills the tablet form. */
  async sendInvitation(to: string, fromName: string, m: InvitationMail): Promise<boolean> {
    const s = INVITE_STRINGS[m.locale as keyof typeof INVITE_STRINGS] ?? INVITE_STRINGS.en;
    const when = new Intl.DateTimeFormat(m.locale, { dateStyle: 'full', timeStyle: 'short', timeZone: m.timezone }).format(m.expectedAt);
    const primary = m.primaryColor ?? DEFAULT_PRIMARY;
    const secondary = m.secondaryColor ?? DEFAULT_SECONDARY;
    const subject = `${s.subject} - ${fromName}`;
    const text = [s.hello.replace('{name}', m.visitorName), '', `${s.host}: ${m.hostName}`, `${s.when}: ${when}`, `${s.site}: ${m.siteName}`, `${s.code}: ${m.code}`, '', s.how, '', s.privacy.replace('{org}', fromName)].join('\n');
    const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;line-height:1.5;color:#1A1A1A">
<div style="background:${secondary};color:${readableOn(secondary)};padding:14px 18px;border-radius:14px 14px 0 0;font-weight:700">${esc(fromName)}<br><span style="font-weight:400;opacity:.8">${esc(m.siteName)}</span></div>
<div style="border:1px solid ${secondary};border-top:0;border-radius:0 0 14px 14px;padding:20px 18px">
<p style="margin:0 0 14px;font-size:17px">${esc(s.hello.replace('{name}', m.visitorName))}</p>
<table style="border-collapse:collapse;font-size:15px">
<tr><td style="padding:4px 16px 4px 0;color:#5C5C58">${esc(s.host)}</td><td style="padding:4px 0;font-weight:700">${esc(m.hostName)}</td></tr>
<tr><td style="padding:4px 16px 4px 0;color:#5C5C58">${esc(s.when)}</td><td style="padding:4px 0;font-weight:700">${esc(when)}</td></tr>
<tr><td style="padding:4px 16px 4px 0;color:#5C5C58">${esc(s.site)}</td><td style="padding:4px 0">${esc(m.siteName)}</td></tr>
</table>
<div style="text-align:center;margin:20px 0 8px"><div style="display:inline-block;background:#FFFFFF;border:4px solid ${primary};border-radius:12px;padding:8px;line-height:0"><img src="cid:invite-qr" width="200" height="200" alt="QR ${esc(m.code)}" style="display:block"></div>
<div style="margin-top:8px;font-size:13px;color:#5C5C58">${esc(s.code)}: <strong style="font-family:'Courier New',monospace;letter-spacing:.12em;color:#1A1A1A">${esc(m.code)}</strong></div></div>
<p style="margin:14px 0 0">${esc(s.how)}</p>
</div>
<p style="margin-top:16px;font-size:12px;color:#5C5C58">${esc(s.privacy.replace('{org}', fromName))}</p></div>`;
    const qr = await qrPng(inviteQrPayload(m.code));
    return this.send(to, fromName, subject, text, html, [{ filename: `invito-${m.code}.png`, content: qr, cid: 'invite-qr', contentType: 'image/png' }]);
  }

  /** One-time code that activates the phone badge. */
  async sendBadgeCode(to: string, fromName: string, m: { locale: string; code: string; firstName: string; minutes: number; primaryColor?: string | null }): Promise<boolean> {
    const s = BADGE_CODE_STRINGS[m.locale as keyof typeof BADGE_CODE_STRINGS] ?? BADGE_CODE_STRINGS.en;
    const hello = s.hello.replace('{name}', m.firstName);
    const valid = s.valid.replace('{n}', String(m.minutes));
    const text = [hello, '', `${s.code}: ${m.code}`, '', valid, s.ignore].join('\n');
    const html = `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;line-height:1.5;color:#1A1A1A">
<div style="border-left:4px solid ${m.primaryColor ?? DEFAULT_PRIMARY};padding:4px 0 4px 16px;margin-bottom:16px"><div style="font-size:13px;color:#5C5C58">${esc(fromName)}</div><div style="font-size:20px;font-weight:700">${esc(s.title)}</div></div>
<p>${esc(hello)}</p>
<p style="font-size:34px;font-weight:700;letter-spacing:.3em;font-family:'Courier New',monospace;margin:18px 0">${esc(m.code)}</p>
<p>${esc(valid)}</p><p style="font-size:13px;color:#5C5C58">${esc(s.ignore)}</p></div>`;
    return this.send(to, fromName, `${s.title}: ${m.code}`, text, html);
  }

  private async send(to: string, fromName: string, subject: string, text: string, html: string, attachments?: Attachment[]): Promise<boolean> {
    if (!this.transport) return false;
    try {
      await this.transport.sendMail({ from: { name: fromName, address: this.cfg.mail.from }, to, subject, text, html, attachments });
      return true;
    } catch (e) {
      this.log.warn(`Email failed: ${(e as Error).message}`); // recipient never logged
      return false;
    }
  }
}

export interface BadgeMail { locale: string; timezone: string; siteName: string; visitorLabel: string; hostName: string; code: string; checkInAt: Date; primaryColor?: string | null; secondaryColor?: string | null }

export interface InvitationMail { locale: string; timezone: string; siteName: string; visitorName: string; hostName: string; expectedAt: Date; code: string; primaryColor?: string | null; secondaryColor?: string | null }

export interface HostArrivalMail { locale: string; timezone: string; siteName: string; visitorName: string; company: string | null; purpose: string; checkInAt: Date; primaryColor?: string | null }

const BADGE_CODE_STRINGS = {
  it: { title: 'Codice per il badge sul telefono', hello: 'Ciao {name}, ecco il codice per attivare il badge sul telefono.', code: 'Codice', valid: 'Vale {n} minuti e si può usare una volta sola.', ignore: 'Se non l’hai chiesto tu, ignora questa email: senza il codice nessuno può attivare il tuo badge.' },
  es: { title: 'Código para la credencial en el teléfono', hello: 'Hola {name}, este es el código para activar la credencial en el teléfono.', code: 'Código', valid: 'Vale {n} minutos y se puede usar una sola vez.', ignore: 'Si no lo ha pedido usted, ignore este correo: sin el código nadie puede activar su credencial.' },
  en: { title: 'Code for your phone badge', hello: 'Hi {name}, here is the code to activate the badge on your phone.', code: 'Code', valid: 'It is valid for {n} minutes and can be used once.', ignore: 'If you did not ask for it, ignore this email: without the code nobody can activate your badge.' },
};

const INVITE_STRINGS = {
  it: { subject: 'Il tuo invito', hello: 'Gentile {name}, sei atteso/a per una visita.', host: 'Ti aspetta', when: 'Quando', site: 'Sede', code: 'Codice invito',
    how: 'All’arrivo tocca “Ho un invito” sul tablet della reception e mostra questo QR alla fotocamera: i tuoi dati saranno già compilati, dovrai solo leggere l’informativa privacy e firmare.',
    privacy: '{org} ha registrato nome, azienda ed email solo per preparare questa visita. I dati dell’invito vengono cancellati pochi giorni dopo la data prevista.' },
  es: { subject: 'Su invitación', hello: 'Estimado/a {name}, le esperamos para una visita.', host: 'Le espera', when: 'Cuándo', site: 'Sede', code: 'Código de invitación',
    how: 'Al llegar, pulse «Tengo una invitación» en la tableta de recepción y muestre este QR a la cámara: sus datos ya estarán completos, solo tendrá que leer la información de privacidad y firmar.',
    privacy: '{org} ha registrado su nombre, empresa y correo solo para preparar esta visita. Los datos de la invitación se eliminan pocos días después de la fecha prevista.' },
  en: { subject: 'Your invitation', hello: 'Dear {name}, you are expected for a visit.', host: 'Meeting', when: 'When', site: 'Site', code: 'Invitation code',
    how: 'When you arrive, tap “I have an invitation” on the reception tablet and show this QR to the camera: your details will already be filled in, you will only need to read the privacy notice and sign.',
    privacy: '{org} recorded your name, company and email only to prepare this visit. The invitation data is deleted a few days after the expected date.' },
};

const ARRIVAL_STRINGS = {
  it: { subject: 'Il tuo ospite è arrivato', title: 'Il tuo ospite è arrivato in reception', visitor: 'Ospite', purpose: 'Motivo', site: 'Sede', time: 'Arrivato alle', footer: 'Ricevi questo messaggio perché il visitatore ti ha indicato come persona da incontrare.',
    purposes: { MEETING: 'Riunione', INTERVIEW: 'Colloquio', SUPPLIER: 'Fornitore', MAINTENANCE: 'Manutenzione', DELIVERY: 'Consegna', OTHER: 'Altro' } },
  es: { subject: 'Su visita ha llegado', title: 'Su visita ha llegado a recepción', visitor: 'Visitante', purpose: 'Motivo', site: 'Sede', time: 'Llegó a las', footer: 'Recibe este mensaje porque le han indicado como la persona a visitar.',
    purposes: { MEETING: 'Reunión', INTERVIEW: 'Entrevista', SUPPLIER: 'Proveedor', MAINTENANCE: 'Mantenimiento', DELIVERY: 'Entrega', OTHER: 'Otro' } },
  en: { subject: 'Your visitor has arrived', title: 'Your visitor has arrived at reception', visitor: 'Visitor', purpose: 'Reason', site: 'Site', time: 'Arrived at', footer: 'You receive this message because you were named as the person to meet.',
    purposes: { MEETING: 'Meeting', INTERVIEW: 'Interview', SUPPLIER: 'Supplier', MAINTENANCE: 'Maintenance', DELIVERY: 'Delivery', OTHER: 'Other' } },
};

const DEFAULT_PRIMARY = '#FFD100';
const DEFAULT_SECONDARY = '#111111';

/** Near-black or white, whichever reads better on the given #RRGGBB background (WCAG relative luminance). */
function readableOn(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return (l + 0.05) / 0.0603 >= 1.05 / (l + 0.05) ? '#1A1A1A' : '#FFFFFF';
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const BADGE_STRINGS = {
  it: { title: 'Il tuo badge di uscita', visitor: 'Visitatore', host: 'Referente', checkIn: 'Ingresso', code: 'Codice di uscita', hint: 'All’uscita tocca “Sto uscendo” sul tablet della reception e mostra questo QR alla fotocamera, oppure digita il codice.' },
  es: { title: 'Su credencial de salida', visitor: 'Visitante', host: 'Contacto', checkIn: 'Entrada', code: 'Código de salida', hint: 'Al salir, pulse «Estoy saliendo» en la tableta de recepción y muestre este QR a la cámara, o introduzca el código.' },
  en: { title: 'Your exit badge', visitor: 'Visitor', host: 'Host', checkIn: 'Check-in', code: 'Exit code', hint: 'When leaving, tap “I’m leaving” on the reception tablet and show this QR to the camera, or type the code.' },
};
