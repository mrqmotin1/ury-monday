export { formatCurrency } from '@ury/core';

export function formatInvoiceTime(timestamp: string | null): string {
  if (!timestamp) return 'No bill activity yet';
  const parsedDate = new Date(timestamp);
  if (!Number.isNaN(parsedDate.getTime())) {
    return parsedDate.toLocaleTimeString(undefined, { hour: 'numeric', minute: 'numeric' });
  }
  return timestamp;
}
