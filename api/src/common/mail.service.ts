import { Inject, Injectable, Logger } from '@nestjs/common';
import nodemailer, { Transporter } from 'nodemailer';
import { APP_CONFIG, AppConfig } from './app-config';

/** Sends the privacy notice and the exit badge, through the configured SMTP relay (STARTTLS mandatory). */
@Injectable()
export class MailService {
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

  async sendNotice(to: string, fromName: string, title: string, body: string, siteName: string): Promise<boolean> {
    return this.send(to, fromName, `${title} - ${siteName}`, body,
      `<div style="font-family:Arial,sans-serif;max-width:640px;line-height:1.5"><h2>${esc(title)}</h2>${esc(body).split('\n').map((l) => `<p>${l}</p>`).join('')}</div>`);
  }

  /** Exit badge: the visit code the visitor types on the tablet when leaving. */
  async sendBadge(to: string, fromName: string, b: BadgeMail): Promise<boolean> {
    const s = BADGE_STRINGS[b.locale as keyof typeof BADGE_STRINGS] ?? BADGE_STRINGS.en;
    const when = new Intl.DateTimeFormat(b.locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: b.timezone }).format(b.checkInAt);
    const text = [`${s.title} - ${b.siteName}`, '', `${s.visitor}: ${b.visitorLabel}`, `${s.host}: ${b.hostName}`, `${s.checkIn}: ${when}`, '', `${s.code}: ${b.code}`, '', s.hint].join('\n');
    const html = `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;line-height:1.5;color:#111111">
<div style="border:3px solid #111111;border-radius:16px;overflow:hidden;text-align:center;background:#FFD100">
<div style="background:#111111;color:#FFD100;padding:14px 18px;font-weight:700">${esc(fromName)}<br><span style="font-weight:400;color:#FFFFFF">${esc(b.siteName)}</span></div>
<div style="padding:22px 18px">
<div style="font-size:22px;font-weight:700">${esc(b.visitorLabel)}</div>
<div style="color:#333333;margin-top:4px">${esc(s.host)}: ${esc(b.hostName)}</div>
<div style="margin-top:20px;font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:#333333">${esc(s.code)}</div>
<div style="font-size:44px;font-weight:700;letter-spacing:.2em;font-family:'Courier New',monospace">${esc(b.code)}</div>
<div style="margin-top:14px;color:#333333">${esc(s.checkIn)}: ${esc(when)}</div>
</div></div>
<p style="margin-top:16px">${esc(s.hint)}</p></div>`;
    return this.send(to, fromName, `${s.title} - ${b.siteName}`, text, html);
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

export interface BadgeMail { locale: string; timezone: string; siteName: string; visitorLabel: string; hostName: string; code: string; checkInAt: Date }

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const BADGE_STRINGS = {
  it: { title: 'Il tuo badge di uscita', visitor: 'Visitatore', host: 'Referente', checkIn: 'Ingresso', code: 'Codice di uscita', hint: 'All’uscita tocca “Sto uscendo” sul tablet della reception e digita questo codice.' },
  es: { title: 'Su credencial de salida', visitor: 'Visitante', host: 'Contacto', checkIn: 'Entrada', code: 'Código de salida', hint: 'Al salir, pulse «Estoy saliendo» en la tableta de recepción e introduzca este código.' },
  en: { title: 'Your exit badge', visitor: 'Visitor', host: 'Host', checkIn: 'Check-in', code: 'Exit code', hint: 'When leaving, tap “I’m leaving” on the reception tablet and type this code.' },
};
