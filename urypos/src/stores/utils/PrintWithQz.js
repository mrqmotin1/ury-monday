import qz from "qz-tray";
import frappe from "../frappeSdk.js";

// QZ Tray transport for the legacy POS. Mirrors @ury/core print/qz.ts used by
// the React POS: the certificate and every signature come from the server
// (ury.ury.api.ury_print.qz_certificate_pem / signature_promise), so no private
// key lives in this bundle. No certificate configured -> QZ anonymous mode
// (QZ asks the user to Allow).
//
// Every failure rejects with { custom: true, title, message } so callers can
// show it and clear their "Printing Invoice" state.

const call = frappe.call();

let connectedHost = null;
let connecting = null;
let certificatePromise = null;
let securityConfigured = false;

function qzError(title, err) {
  return {
    custom: true,
    title,
    message: err?.message || (typeof err === "string" ? err : String(err)),
  };
}

function getCertificate() {
  if (!certificatePromise) {
    certificatePromise = call
      .post("ury.ury.api.ury_print.qz_certificate_pem")
      .then((res) => res?.message || null)
      .catch((err) => {
        console.error("[QZ] Could not load certificate, using anonymous mode:", err);
        return null;
      });
  }
  return certificatePromise;
}

function configureSecurity() {
  if (securityConfigured) return;
  securityConfigured = true;

  qz.security.setCertificatePromise((resolve) => {
    getCertificate().then((cert) => resolve(cert || undefined));
  });

  qz.security.setSignatureAlgorithm("SHA512");
  qz.security.setSignaturePromise((toSign) => (resolve, reject) => {
    getCertificate().then((cert) => {
      // Anonymous mode: nothing to sign with.
      if (!cert) return resolve();
      call
        .post("ury.ury.api.ury_print.signature_promise", { toSign })
        .then((res) => (res?.message ? resolve(res.message) : reject("No signature returned by the server")))
        .catch((err) => reject(String(err?.message || err)));
    });
  });
}

export async function loadQzPrinter(host) {
  configureSecurity();
  const targetHost = host || "localhost";

  // Join an attempt already in flight instead of opening a second socket.
  if (connecting) return connecting;

  if (qz.websocket.isActive()) {
    if (connectedHost === targetHost) return "success";
    await qz.websocket.disconnect();
  }

  connecting = qz.websocket
    .connect({ host: targetHost, usingSecure: window.location.protocol === "https:" })
    .then(() => {
      connectedHost = targetHost;
      return "success";
    })
    .catch((err) => {
      throw qzError(`Could not connect to QZ Tray on ${targetHost}. Is QZ Tray running?`, err);
    })
    .finally(() => {
      connecting = null;
    });
  return connecting;
}

export function disconnectQzPrinter() {
  if (qz.websocket.isActive()) qz.websocket.disconnect();
  connectedHost = null;
}

async function resolvePrinter(host, printerName) {
  if (!printerName) return qz.printers.getDefault();

  const found = await qz.printers.find();
  const printers = Array.isArray(found) ? found : [found].filter(Boolean);
  const match =
    printers.find((p) => p === printerName) ||
    printers.find((p) => p.toLowerCase() === printerName.toLowerCase());
  if (!match) {
    throw qzError(
      `Printer "${printerName}" not found on ${host || "localhost"}. Available: ${printers.join(", ") || "none"}`
    );
  }
  return match;
}

/**
 * Print through QZ Tray. `content` is HTML (string) or `{ type: 'raw' | 'html', data }`
 * from ury.ury.api.ury_print.get_qz_print_data (raw = ESC/POS commands sent as-is).
 * `printerName` is the POS Profile's POS Printer; blank = the PC's default printer.
 * Resolves "printed".
 */
export async function printWithQz(host, content, printerName) {
  const payload = typeof content === "string" ? { type: "html", data: content } : content || {};
  if (!payload.data) throw qzError("Nothing to print", "The print format returned no content.");

  await loadQzPrinter(host);

  let printer;
  try {
    printer = await resolvePrinter(host, printerName);
  } catch (err) {
    if (err?.custom) throw err;
    throw qzError("Error looking up the printer", err);
  }

  try {
    if (payload.type === "raw") {
      const config = qz.configs.create(printer, { forceRaw: true });
      await qz.print(config, [{ type: "raw", format: "command", flavor: "plain", data: payload.data }]);
    } else {
      const config = qz.configs.create(printer);
      await qz.print(config, [{ type: "html", format: "plain", data: payload.data }]);
    }
  } catch (err) {
    throw qzError("Print failed", err);
  }
  return "printed";
}
