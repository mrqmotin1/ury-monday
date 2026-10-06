import { forwardRef } from 'react';
import type { LucideIcon, LucideProps } from 'lucide-react';
import {
  Banknote,
  DollarSign,
  Euro,
  IndianRupee,
  JapaneseYen,
  PoundSterling,
  RussianRuble,
  SaudiRiyal,
  SwissFranc,
} from 'lucide-react';
import { getCurrencyCode } from '@ury/core';

const DOLLAR_CURRENCIES = ['USD', 'AUD', 'CAD', 'NZD', 'SGD', 'HKD', 'MXN', 'BRL', 'ARS', 'CLP', 'COP', 'TWD', 'FJD', 'JMD', 'TTD', 'BBD', 'BSD', 'BZD', 'XCD', 'LRD', 'NAD', 'SBD', 'GYD', 'SRD', 'KYD', 'BMD'];

const CURRENCY_ICONS: Record<string, LucideIcon> = {
  INR: IndianRupee,
  EUR: Euro,
  GBP: PoundSterling,
  JPY: JapaneseYen,
  CNY: JapaneseYen,
  RUB: RussianRuble,
  CHF: SwissFranc,
  SAR: SaudiRiyal,
};

/** Lucide icon for the site currency; a neutral banknote when none matches. */
export function getCurrencyIcon(code: string = getCurrencyCode()): LucideIcon {
  const upper = code.toUpperCase();
  if (CURRENCY_ICONS[upper]) return CURRENCY_ICONS[upper];
  if (DOLLAR_CURRENCIES.includes(upper)) return DollarSign;
  return Banknote;
}

/** Drop-in replacement for a fixed currency icon (e.g. IndianRupee). */
export const CurrencyIcon = forwardRef<SVGSVGElement, LucideProps>((props, ref) => {
  const Icon = getCurrencyIcon();
  return <Icon ref={ref} {...props} />;
}) as LucideIcon;

CurrencyIcon.displayName = 'CurrencyIcon';
