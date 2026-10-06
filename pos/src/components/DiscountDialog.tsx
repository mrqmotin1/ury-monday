import React, { useEffect, useState } from 'react';
import { Lock, Percent } from 'lucide-react';
import { Button, Input, Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, showToast } from '@ury/ui';
import { formatCurrency, parseFrappeError } from '@ury/core';
import { applyOrderDiscount, type OrderDiscountResult } from '../lib/invoice-api';
import { t } from '../i18n';

interface DiscountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: string;
  /** Bill total before any discount. */
  baseTotal: number;
  discountPercentage?: number;
  discountAmount?: number;
  /** POS Profile "Max Discount (%)"; 0 = up to 100%. */
  maxDiscount?: number;
  /** Bill already printed: only a manager may change it, then it must be reprinted. */
  printed: boolean;
  onApplied: (result: OrderDiscountResult) => void;
}

/**
 * Bill discount set on the order BEFORE printing, so the printed bill shows it
 * and payment just uses the discounted total.
 */
const DiscountDialog: React.FC<DiscountDialogProps> = ({
  open,
  onOpenChange,
  invoice,
  baseTotal,
  discountPercentage,
  discountAmount,
  maxDiscount,
  printed,
  onApplied,
}) => {
  const initialType: 'percentage' | 'amount' = !discountPercentage && discountAmount ? 'amount' : 'percentage';
  const [discountType, setDiscountType] = useState<'percentage' | 'amount'>(initialType);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const maxPercent = maxDiscount ? Number(maxDiscount) : 100;
  const hasDiscount = !!(discountPercentage || discountAmount);

  useEffect(() => {
    if (!open) return;
    setDiscountType(initialType);
    setValue(discountPercentage ? String(discountPercentage) : discountAmount ? String(discountAmount) : '');
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const parsed = parseFloat(value);
  const previewAmount =
    !isNaN(parsed) && parsed > 0 ? (discountType === 'percentage' ? (baseTotal * parsed) / 100 : parsed) : 0;

  const submit = async (remove = false) => {
    if (!remove) {
      if (isNaN(parsed) || parsed <= 0) {
        setError(t('errors.invalid_discount'));
        return;
      }
      if (discountType === 'amount' && previewAmount > baseTotal) {
        setError(t('errors.discount_exceeds_total'));
        return;
      }
      if (baseTotal > 0 && (previewAmount / baseTotal) * 100 > maxPercent + 0.01) {
        setError(t('errors.discount_exceeds_limit', { max: maxPercent }));
        return;
      }
    }
    setSaving(true);
    setError(null);
    try {
      const result = await applyOrderDiscount(
        invoice,
        remove ? 0 : parsed,
        discountType === 'amount' ? 'Amount' : 'Percentage'
      );
      showToast.success(remove ? t('discount.removed') : t('discount.applied'));
      onApplied(result);
      onOpenChange(false);
    } catch (err) {
      setError(parseFrappeError(err, t('discount.failed')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="max-w-md" onClose={() => onOpenChange(false)}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Percent className="w-5 h-5" />
            {t('discount.title')}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 px-6">
          {printed && (
            <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <Lock className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{t('discount.printed_note')}</span>
            </div>
          )}

          <div className="flex gap-2">
            <div className="inline-flex h-10 rounded-md border border-input overflow-hidden shrink-0" role="group">
              {(['percentage', 'amount'] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => {
                    setDiscountType(type);
                    setValue('');
                    setError(null);
                  }}
                  className={`px-3 text-sm font-semibold ${discountType === type ? 'bg-primary text-primary-foreground' : 'bg-background text-foreground hover:bg-muted'}`}
                  aria-pressed={discountType === type}
                >
                  {type === 'percentage' ? t('payment.discount_type_percent') : t('payment.discount_type_amount')}
                </button>
              ))}
            </div>
            <Input
              type="number"
              value={value}
              autoFocus
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              placeholder={discountType === 'percentage' ? t('payment.discount_placeholder') : t('payment.discount_amount_placeholder')}
              className="flex-1"
            />
          </div>

          <div className="space-y-1 text-sm">
            <div className="flex justify-between text-gray-600">
              <span>{t('discount.bill_total')}</span>
              <span>{formatCurrency(baseTotal)}</span>
            </div>
            <div className="flex justify-between text-red-600">
              <span>{t('payment.discount')}</span>
              <span>-{formatCurrency(previewAmount)}</span>
            </div>
            <div className="flex justify-between font-semibold text-gray-900">
              <span>{t('discount.new_total')}</span>
              <span>{formatCurrency(Math.max(0, baseTotal - previewAmount))}</span>
            </div>
            {maxDiscount ? <p className="text-xs text-gray-500">{t('discount.max_note', { max: maxPercent })}</p> : null}
          </div>

          {error && <div className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-600">{error}</div>}
        </div>

        <DialogFooter className="gap-2 pt-6">
          {hasDiscount && (
            <Button variant="outline" onClick={() => submit(true)} disabled={saving}>
              {t('discount.remove')}
            </Button>
          )}
          <Button onClick={() => submit()} disabled={saving}>
            {saving ? t('common.loading') : t('common.apply')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default DiscountDialog;
