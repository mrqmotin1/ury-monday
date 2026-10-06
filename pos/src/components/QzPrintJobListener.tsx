import { useEffect } from 'react';
import type { Socket } from 'socket.io-client';
import { call, loadQzPrinter, printWithQz, type QzPrintData } from '@ury/core';
import { showToast } from '@ury/ui';
import { usePOSStore } from '../store/pos-store';
import { getRealtimeSocket } from '../lib/realtime';

interface QzPrintJobEvent {
  job_id: string;
  kind: string;
  title: string;
  pos_profile: string;
}

interface QzPrintJob extends QzPrintData {
  kind: string;
  title: string;
}

/**
 * Prints server-created documents (KOT, waiter slip, KOT reprint) through QZ
 * Tray when the POS Profile has QZ Print on.
 *
 * The server broadcasts each job on `qz_print_<branch>`; every open POS of the
 * branch receives it. A device that cannot reach QZ (e.g. a captain's phone)
 * ignores it; otherwise the first device to claim the job prints it on the
 * profile's POS Printer. If printing fails here the job is released so another
 * open POS can try.
 */
const QzPrintJobListener: React.FC = () => {
  const { posProfile } = usePOSStore();
  const enabled = posProfile?.print_type === 'qz';
  const branch = posProfile?.branch || '';
  const profileName = posProfile?.name || '';
  const host = posProfile?.qz_host || 'localhost';
  const printer = posProfile?.qz_printer || null;

  useEffect(() => {
    if (!enabled || !branch || !profileName) return;

    const channel = `qz_print_${branch}`;
    const failedHere = new Set<string>();
    let activeSocket: Socket | null = null;
    let cancelled = false;

    const handler = async (event: QzPrintJobEvent) => {
      if (!event?.job_id || event.pos_profile !== profileName || failedHere.has(event.job_id)) return;

      try {
        await loadQzPrinter(host);
      } catch {
        return; // QZ not reachable from this device: leave the job to another POS
      }

      let job: QzPrintJob | null = null;
      try {
        const res = await call.post('ury.ury.api.qz_print_jobs.claim_qz_print_job', { job_id: event.job_id });
        job = res?.message || null;
      } catch (err) {
        console.error('[QZ] Could not claim print job', err);
        return;
      }
      if (!job) return; // another POS already took it, or it expired

      try {
        await printWithQz(host, job, printer);
      } catch (err) {
        failedHere.add(event.job_id);
        const reason = err instanceof Error ? err.message : String(err);
        showToast.error(`${job.title}: ${reason}`);
        call.post('ury.ury.api.qz_print_jobs.release_qz_print_job', { job_id: event.job_id }).catch(() => {});
      }
    };

    getRealtimeSocket()
      .then((s) => {
        if (cancelled) return;
        activeSocket = s;
        s.on(channel, handler);
      })
      .catch((err) => console.error('[QZ] Could not subscribe to print jobs', err));

    return () => {
      cancelled = true;
      activeSocket?.off(channel, handler);
    };
  }, [enabled, branch, profileName, host, printer]);

  return null;
};

export default QzPrintJobListener;
