import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ShieldCheck, ShieldAlert, Upload, Download } from 'lucide-react';
import { Button, Badge, showToast } from '@ury/ui';
import { call } from '@ury/core';

const SETTINGS_DOCTYPE = 'URY QZ Settings';

type QzFileField = 'certificate' | 'private_key';

type QzFileSource = 'settings' | 'site_config' | 'file_list' | null;

interface QzCertificateStatus {
  certificate: boolean;
  private_key: boolean;
  certificate_source: QzFileSource;
  private_key_source: QzFileSource;
}

function serverMessage(json: any, fallback: string): string {
  try {
    const messages = JSON.parse(json?._server_messages || '[]');
    const first = messages.length ? JSON.parse(messages[0]) : null;
    if (first?.message) return String(first.message).replace(/<[^>]+>/g, '');
  } catch {
    // fall through
  }
  return json?.message || json?.exception || fallback;
}

/** Upload a file as Private, attached to the URY QZ Settings field. */
async function uploadPrivateFile(file: File, fieldname: QzFileField): Promise<string> {
  const formData = new FormData();
  formData.append('file', file, file.name);
  formData.append('is_private', '1');
  formData.append('doctype', SETTINGS_DOCTYPE);
  formData.append('docname', SETTINGS_DOCTYPE);
  formData.append('fieldname', fieldname);

  const baseUrl = import.meta.env?.VITE_FRAPPE_BASE_URL || '';
  const response = await fetch(`${baseUrl}/api/method/upload_file`, {
    method: 'POST',
    body: formData,
    headers: {
      Accept: 'application/json',
      'X-Frappe-CSRF-Token': (window as any).csrf_token || '',
    },
    credentials: 'include',
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || !json?.message?.file_url) {
    throw new Error(serverMessage(json, 'Upload failed'));
  }
  return json.message.file_url;
}

/**
 * QZ Tray signing files (URY QZ Settings). The certificate is shared with QZ
 * Tray on each printing PC; the private key stays on the server and is only
 * used to sign print requests, so printing runs without the QZ Allow prompt.
 */
export const QzCertificateCard: React.FC<{ disabled?: boolean }> = ({ disabled }) => {
  const [status, setStatus] = useState<QzCertificateStatus | null>(null);
  const [uploading, setUploading] = useState<QzFileField | null>(null);
  const certificateInput = useRef<HTMLInputElement>(null);
  const privateKeyInput = useRef<HTMLInputElement>(null);

  const loadStatus = useCallback(async () => {
    try {
      const res = await call<any>('ury.ury.api.ury_print.get_qz_certificate_status');
      setStatus(res?.message || res);
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const handleFile = async (fieldname: QzFileField, file?: File) => {
    if (!file) return;
    setUploading(fieldname);
    try {
      const fileUrl = await uploadPrivateFile(file, fieldname);
      // Saving runs URY QZ Settings validation (private file, valid PEM).
      await call('frappe.client.set_value', {
        doctype: SETTINGS_DOCTYPE,
        name: SETTINGS_DOCTYPE,
        fieldname,
        value: fileUrl,
      });
      showToast.success(fieldname === 'certificate' ? 'QZ certificate uploaded' : 'QZ private key uploaded');
      await loadStatus();
    } catch (err: any) {
      showToast.error(err?.message || 'Upload failed');
    } finally {
      setUploading(null);
    }
  };

  const handleDownload = async () => {
    try {
      const res = await call<any>('ury.ury.api.ury_print.qz_certificate_pem');
      const pem = res?.message ?? res;
      if (!pem || typeof pem !== 'string') {
        showToast.error('No QZ certificate configured yet');
        return;
      }
      const url = URL.createObjectURL(new Blob([pem], { type: 'application/x-pem-file' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'qz-certificate.crt';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      showToast.error(err?.message || 'Download failed');
    }
  };

  const ready = !!status?.certificate && !!status?.private_key;
  const sourceLabel = (source: QzFileSource) =>
    ({ settings: 'uploaded', site_config: 'site config', file_list: 'File list' } as Record<string, string>)[source ?? ''] ||
    'missing';

  return (
    <div className="p-4 rounded-lg bg-gray-50 border border-gray-200 text-xs space-y-3">
      <div className="flex items-center justify-between">
        <span className="font-bold text-gray-900 flex items-center gap-1.5">
          {ready ? <ShieldCheck className="w-4 h-4 text-green-600" /> : <ShieldAlert className="w-4 h-4 text-amber-600" />}
          QZ Certificate
        </span>
        <Badge variant={ready ? 'success' : 'warning'}>{ready ? 'Silent printing ready' : 'QZ will ask to Allow'}</Badge>
      </div>
      <p className="text-gray-600">
        Upload the QZ Tray certificate and its private key. The key stays on the server and only signs print
        requests. Import the downloaded certificate into QZ Tray (Site Manager) on every printing PC.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {([
          { field: 'certificate', label: 'Certificate', hint: 'digital-certificate.txt', ok: status?.certificate, source: status?.certificate_source, input: certificateInput, accept: '.txt,.crt,.pem,.cer' },
          { field: 'private_key', label: 'Private Key', hint: 'private-key.pem', ok: status?.private_key, source: status?.private_key_source, input: privateKeyInput, accept: '.pem,.key,.txt' },
        ] as const).map(({ field, label, hint, ok, source, input, accept }) => (
          <div key={field} className="flex items-center justify-between gap-2 p-3 rounded-lg border border-gray-200 bg-white">
            <div>
              <div className="font-semibold text-gray-800">{label}</div>
              <div className={ok ? 'text-green-700' : 'text-gray-500'}>
                {ok ? `✓ ${sourceLabel(source ?? null)}` : hint}
              </div>
            </div>
            <input
              ref={input}
              type="file"
              accept={accept}
              className="hidden"
              onChange={(e) => {
                handleFile(field, e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <Button
              type="button"
              variant="outline"
              disabled={disabled || uploading !== null}
              onClick={() => input.current?.click()}
            >
              <Upload className="w-3.5 h-3.5 mr-1" />
              {uploading === field ? 'Uploading…' : 'Upload'}
            </Button>
          </div>
        ))}
      </div>

      <Button type="button" variant="outline" disabled={!status?.certificate} onClick={handleDownload}>
        <Download className="w-3.5 h-3.5 mr-1" />
        Download certificate for QZ Tray
      </Button>
    </div>
  );
};

export default QzCertificateCard;
