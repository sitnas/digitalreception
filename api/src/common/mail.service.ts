import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import nodemailer, { Transporter } from 'nodemailer';
import { APP_CONFIG, AppConfig } from './app-config';

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
<div style="margin-top:14px;opacity:.8">${esc(s.checkIn)}: ${esc(when)}</div>
</div></div>
<p style="margin-top:16px">${esc(s.hint)}</p></div>`;
    return this.send(to, fromName, `${s.title} - ${b.siteName}`, text, html);
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

  private async send(to: string, fromName: string, subject: string, text: string, html: string): Promise<boolean> {
    if (!this.transport) return false;
    try {
      await this.transport.sendMail({ from: { name: fromName, address: this.cfg.mail.from }, to, subject, text, html });
      return true;
    } catch (e) {
      this.log.warn(`Email failed: ${(e as Error).message}`); // recipient never logged
      return false;
    }
  }
}

export interface BadgeMail { locale: string; timezone: string; siteName: string; visitorLabel: string; hostName: string; code: string; checkInAt: Date; primaryColor?: string | null; secondaryColor?: string | null }

export interface HostArrivalMail { locale: string; timezone: string; siteName: string; visitorName: string; company: string | null; purpose: string; checkInAt: Date; primaryColor?: string | null }

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
  it: { title: 'Il tuo badge di uscita', visitor: 'Visitatore', host: 'Referente', checkIn: 'Ingresso', code: 'Codice di uscita', hint: 'All’uscita tocca “Sto uscendo” sul tablet della reception e digita questo codice.' },
  es: { title: 'Su credencial de salida', visitor: 'Visitante', host: 'Contacto', checkIn: 'Entrada', code: 'Código de salida', hint: 'Al salir, pulse «Estoy saliendo» en la tableta de recepción e introduzca este código.' },
  en: { title: 'Your exit badge', visitor: 'Visitor', host: 'Host', checkIn: 'Check-in', code: 'Exit code', hint: 'When leaving, tap “I’m leaving” on the reception tablet and type this code.' },
};
