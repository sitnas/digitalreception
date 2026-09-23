import { Inject, Injectable, Logger } from '@nestjs/common';
import nodemailer, { Transporter } from 'nodemailer';
import { APP_CONFIG, AppConfig } from './app-config';

/** Sends only the privacy notice, through the configured SMTP relay (STARTTLS mandatory). */
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
    if (!this.transport) return false;
    try {
      const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
      await this.transport.sendMail({
        from: { name: fromName, address: this.cfg.mail.from }, to, subject: `${title} - ${siteName}`,
        text: body,
        html: `<div style="font-family:Arial,sans-serif;max-width:640px;line-height:1.5"><h2>${esc(title)}</h2>${esc(body).split('\n').map((l) => `<p>${l}</p>`).join('')}</div>`,
      });
      return true;
    } catch (e) {
      this.log.warn(`Privacy notice email failed: ${(e as Error).message}`); // recipient never logged
      return false;
    }
  }
}
