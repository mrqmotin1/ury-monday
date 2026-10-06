import { storage } from './storage';

type FrappeBoot = {
  sysdefaults?: { currency?: string; number_format?: string };
  docs?: Array<{ doctype?: string; name?: string; symbol?: string }>;
};

function getBoot(): FrappeBoot {
  return (typeof window !== 'undefined' && (window as any).frappe?.boot) || {};
}

// Frappe number formats (System Settings) -> a locale whose grouping matches.
const NUMBER_FORMAT_LOCALES: Record<string, string> = {
  '#,##,###.##': 'en-IN',
  '#,###.##': 'en-US',
  '#,###.###': 'en-US',
  '#,###': 'en-US',
  '#.###,##': 'de-DE',
  '#.###': 'de-DE',
  '# ###.##': 'fr-FR',
  '# ###,##': 'fr-FR',
  "#'###.##": 'de-CH',
  '#, ###.##': 'en-US',
  '#,###.##########': 'en-US',
};

/** Site currency code: POS profile currency if loaded, else the site default. */
export function getCurrencyCode(): string {
  return storage.getItem('currency') || getBoot().sysdefaults?.currency || '';
}

/** Symbol for the active currency, resolved without any hardcoded fallback. */
export function getCurrencySymbol(): string {
  const cached = storage.getItem('currencySymbol');
  if (cached) return cached;

  const code = getCurrencyCode();
  if (!code) return '';

  const bootDoc = getBoot().docs?.find((d) => d.doctype === 'Currency' && d.name === code);
  if (bootDoc?.symbol) return bootDoc.symbol;

  try {
    const part = new Intl.NumberFormat(undefined, { style: 'currency', currency: code })
      .formatToParts(0)
      .find((p) => p.type === 'currency');
    if (part?.value) return part.value;
  } catch {
    // Unknown ISO code for Intl -- fall through to the code itself.
  }
  return code;
}

/** Locale matching the site's number format; undefined = browser locale. */
export function getNumberLocale(): string | undefined {
  const numberFormat = getBoot().sysdefaults?.number_format;
  return (numberFormat && NUMBER_FORMAT_LOCALES[numberFormat]) || undefined;
}

function withSymbol(value: string | number): string {
  const symbol = getCurrencySymbol();
  return symbol ? `${symbol} ${value}` : `${value}`;
}

export function formatCurrency(amount: number): string {
  const roundedAmount = flt(amount, 2);
  const formattedVal = typeof roundedAmount === 'number' && !isNaN(roundedAmount) ? roundedAmount.toLocaleString(getNumberLocale()) : roundedAmount;
  return withSymbol(formattedVal);
}

export function flt(v: number | string | null | undefined, decimals: number = 2): number {
  if (v == null || v === '') return 0;
  const num = typeof v === 'number' ? v : parseFloat(v as string);
  if (isNaN(num)) return 0;
  if (decimals != null) {
    const mult = Math.pow(10, decimals);
    const isNegative = num < 0;
    const absNum = Math.abs(num);
    const n = +(absNum * mult).toFixed(8);
    const rounded = Math.round(n) / mult;
    return isNegative ? -rounded : rounded;
  }
  return num;
}

/**
 * Formats a number as compact currency for chart axes/labels, following the
 * site's number format: e.g. 600000 -> "6L" (en-IN) or "600K" (en-US).
 */
export function formatCompactCurrency(amount: number): string {
  const symbol = getCurrencySymbol();
  if (typeof amount !== 'number' || isNaN(amount)) return withSymbol(amount);

  const sign = amount < 0 ? '-' : '';
  const compact = new Intl.NumberFormat(getNumberLocale(), {
    notation: 'compact',
    maximumFractionDigits: 2,
  }).format(Math.abs(amount));
  return `${sign}${symbol}${compact}`;
}

export const formatInvoiceTime = (timestamp: string | null) => {
    if (!timestamp) return 'No bill activity yet';

    const parsedDate = new Date(timestamp);
    if (!Number.isNaN(parsedDate.getTime())) {
      return parsedDate.toLocaleTimeString(undefined, { hour: 'numeric', minute: 'numeric' });
    }

    const timeOnlyMatch = timestamp.match(/^(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d+))?$/);
    if (timeOnlyMatch) {
      const [, hours, minutes, seconds] = timeOnlyMatch;
      const date = new Date();
      date.setHours(Number(hours), Number(minutes), Number(seconds), 0);
      const formatted = date.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      if (/^\d{1,2}:\d{2}$/.test(formatted)) {
        return formatted;
      }
      return `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}`;
    }

    return timestamp;
  };