import qz from 'qz-tray';
import { call } from '../frappe/client';

// QZ Tray trust is handled server-side: the site serves the public certificate
// and signs each QZ request with a private key that never reaches the browser
// (ury.ury.api.ury_print.qz_certificate_pem / signature_promise). Without a
// configured certificate QZ runs in anonymous mode and asks the user to Allow.

let connectedHost: string | null = null;
let certificatePromise: Promise<string | null> | null = null;
let securityConfigured = false;

/** Kept for backwards compatibility; signing no longer needs a browser key. */
export function initPrinting(_opts?: { signKey?: string }) {}

function getCertificate(): Promise<string | null> {
  if (!certificatePromise) {
    certificatePromise = call
      .post('ury.ury.api.ury_print.qz_certificate_pem')
      .then((res: any) => res?.message || null)
      .catch((err: unknown) => {
        console.error('[QZ] Could not load certificate, using anonymous mode:', err);
        return null;
      });
  }
  return certificatePromise;
}

function configureSecurity() {
  if (securityConfigured) return;
  securityConfigured = true;

  qz.security.setCertificatePromise((resolve: (cert?: string) => void) => {
    getCertificate().then((cert) => resolve(cert || undefined));
  });

  qz.security.setSignatureAlgorithm('SHA512');
  qz.security.setSignaturePromise((toSign: string) => (resolve: (sig?: string) => void, reject: (err?: string) => void) => {
    getCertificate().then((cert) => {
      // Anonymous mode: nothing to sign with.
      if (!cert) return resolve();
      call
        .post('ury.ury.api.ury_print.signature_promise', { toSign })
        .then((res: any) => (res?.message ? resolve(res.message) : reject('No signature returned by the server')))
        .catch((err: unknown) => reject(String(err)));
    });
  });
}

export async function loadQzPrinter(host: string): Promise<void> {
  configureSecurity();
  const targetHost = host || 'localhost';

  if (qz.websocket.isActive()) {
    if (connectedHost === targetHost) return;
    await qz.websocket.disconnect();
  }

  // Browsers block ws:// to non-localhost hosts from https pages, so match the page.
  await qz.websocket.connect({ host: targetHost, usingSecure: window.location.protocol === 'https:' });
  connectedHost = targetHost;
}

export function disconnectQzPrinter(): void {
  if (qz.websocket.isActive()) qz.websocket.disconnect();
  connectedHost = null;
}

/** All printer names QZ Tray sees on `host`. */
export async function listQzPrinters(host: string): Promise<string[]> {
  await loadQzPrinter(host);
  const printers = await qz.printers.find();
  return Array.isArray(printers) ? printers : [printers];
}

async function resolvePrinter(host: string, printerName?: string | null): Promise<string> {
  if (!printerName) return qz.printers.getDefault();

  const printers = await listQzPrinters(host);
  const match =
    printers.find((p) => p === printerName) ||
    printers.find((p) => p.toLowerCase() === printerName.toLowerCase());
  if (!match) {
    throw new Error(
      `Printer "${printerName}" not found on ${host || 'localhost'}. Available: ${printers.join(', ') || 'none'}`
    );
  }
  return match;
}

/** Rendered print output: `raw` = printer commands (ESC/POS), `html` = rendered by QZ. */
export interface QzPrintData {
  type: 'raw' | 'html';
  data: string;
}

/**
 * Print through QZ Tray. `content` is HTML (string) or server-rendered
 * `QzPrintData` (raw commands from a "Raw Printing" print format are sent to
 * the printer as-is). `printerName` is the POS Profile's POS Printer; blank
 * means the printing PC's default printer.
 */
export async function printWithQz(host: string, content: string | QzPrintData, printerName?: string | null): Promise<void> {
  const payload: QzPrintData = typeof content === 'string' ? { type: 'html', data: content } : content;
  if (!payload.data) throw new Error('Nothing to print.');

  await loadQzPrinter(host);
  const printer = await resolvePrinter(host, printerName);

  if (payload.type === 'raw') {
    const config = qz.configs.create(printer, { forceRaw: true } as any);
    await qz.print(config, [{ type: 'raw', format: 'command', flavor: 'plain', data: payload.data }] as any);
    return;
  }

  const config = qz.configs.create(printer);
  await qz.print(config, [{ type: 'html', format: 'plain', data: payload.data }] as any);
}
