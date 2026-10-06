import { io } from "socket.io-client";
import frappe from "../frappeSdk.js";
import { loadQzPrinter, printWithQz } from "./PrintWithQz";

// Prints server-created documents (KOT, waiter slip, KOT reprint) through QZ
// Tray when the POS Profile has QZ Print on. Same protocol as the React POS
// (pos/src/components/QzPrintJobListener.tsx): the server broadcasts a job id
// on `qz_print_<branch>`, the first open POS that can reach QZ claims it and
// prints it on the profile's POS Printer; on failure it is released so another
// open POS can try.

const call = frappe.call();
let socket = null;
let listening = null;

async function getSocket() {
  if (socket) return socket;
  const res = await fetch("/api/method/ury.ury.api.ury_kot_display.get_site_name");
  const target = (await res.json())?.message || {};
  const site = target.site_name;
  if (!site) throw new Error("Site name is not set");
  const { protocol, hostname } = window.location;
  // Same rule as Frappe desk: socket.io has its own port under `bench start`,
  // and is served on the site origin in production.
  const port = target.dev_server && target.socketio_port ? String(target.socketio_port) : window.location.port;
  socket = io(`${protocol}//${hostname}${port ? `:${port}` : ""}/${site}`, { withCredentials: true });
  return socket;
}

/**
 * Start listening for QZ print jobs. `profile` = { branch, posProfile, qzHost,
 * qzPrinter }; `onError(message)` is called when a job fails on this device.
 */
export async function startQzPrintJobListener(profile, onError) {
  const channel = `qz_print_${profile.branch}`;
  if (listening === channel) return;

  const s = await getSocket();
  if (listening) s.off(listening);
  listening = channel;

  const host = profile.qzHost || "localhost";
  const failedHere = new Set();

  s.on(channel, async (event) => {
    if (!event?.job_id || event.pos_profile !== profile.posProfile || failedHere.has(event.job_id)) return;

    try {
      await loadQzPrinter(host);
    } catch {
      return; // QZ not reachable from this device: leave the job to another POS
    }

    let job = null;
    try {
      const res = await call.post("ury.ury.api.qz_print_jobs.claim_qz_print_job", { job_id: event.job_id });
      job = res?.message || null;
    } catch (err) {
      console.error("[QZ] Could not claim print job", err);
      return;
    }
    if (!job) return; // another POS already took it, or it expired

    try {
      await printWithQz(host, job, profile.qzPrinter);
    } catch (err) {
      failedHere.add(event.job_id);
      onError?.(`${job.title}: ${[err?.title, err?.message].filter(Boolean).join(" - ") || err}`);
      call.post("ury.ury.api.qz_print_jobs.release_qz_print_job", { job_id: event.job_id }).catch(() => {});
    }
  });
}
