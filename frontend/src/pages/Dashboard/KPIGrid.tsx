import React from 'react';
import { formatCurrency } from '@ury/core';
import { Card, Spinner, BrandLogo } from '@ury/ui';
import { DashboardSummary } from '../../services/dashboard';

interface LinkCardProps {
  label: string;
  href: string;
}

const LinkCard: React.FC<LinkCardProps> = ({ label, href }) => {
  return (
    <a href={href} className="block outline-none h-full">
      <Card className="h-full rounded-lg border border-gray-200 bg-white p-5 shadow-xs transition-all duration-200 hover:shadow-md hover:border-primary/20">
        <div className="flex h-4 items-center mb-2 opacity-80">
          <BrandLogo size="sm" />
        </div>
        <h3 className="mt-2 text-2xl font-bold text-gray-900 tracking-tight">{label}</h3>
      </Card>
    </a>
  );
};

interface KPIGridProps {
  summary: DashboardSummary | null;
  loading: boolean;
}

interface KPICardProps {
  title: string;
  value: string;
  loading?: boolean;
}

const KPICard: React.FC<KPICardProps> = ({ title, value, loading }) => {
  return (
    <Card className="rounded-lg border border-gray-200 bg-white p-5 shadow-xs transition-all duration-200 hover:shadow-md hover:border-primary/20">
      <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">{title}</p>
      {loading ? (
        <div className="mt-2 flex items-center space-x-2">
          <Spinner className="w-4 h-4 text-primary" />
          <span className="text-sm text-gray-400">Loading...</span>
        </div>
      ) : (
        <h3 className="mt-2 text-2xl font-bold text-gray-900 tracking-tight">{value}</h3>
      )}
    </Card>
  );
};

export const KPIGrid: React.FC<KPIGridProps> = ({ summary, loading }) => {
  const todaySales = summary?.today_sales ?? 0;
  const ordersToday = summary?.today_orders ?? 0;
  const occupiedTables = summary?.occupied_tables ?? 0;
  const totalTables = summary?.total_tables ?? 0;
  const aov = summary?.avg_order_value ?? 0;
  const activeCashiers = summary?.active_cashiers ?? 0;
  const pendingOrders = summary?.pending_kitchen_orders ?? 0;
  const totalMenuItems = summary?.total_menu_items ?? 0;

  const occupancyRate = totalTables > 0 ? Math.round((occupiedTables / totalTables) * 100) : 0;

  return (
    <section className="w-full">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <LinkCard
          label="POS"
          href="/pos"
        />

        <LinkCard
          label="Kitchen Display"
          href="/mosaic"
        />

        <KPICard
          title="Today's Sales"
          value={formatCurrency(todaySales)}
          loading={loading}
        />

        <KPICard
          title="Orders Today"
          value={ordersToday.toString()}
          loading={loading}
        />

        <KPICard
          title="Table Occupancy"
          value={`${occupancyRate}%`}
          loading={loading}
        />

        <KPICard
          title="Occupied Tables"
          value={`${occupiedTables} / ${totalTables}`}
          loading={loading}
        />

        <KPICard
          title="Average Order Value"
          value={formatCurrency(aov)}
          loading={loading}
        />

        <KPICard
          title="Pending Kitchen Orders"
          value={`${pendingOrders} KOTs`}
          loading={loading}
        />
      </div>
    </section>
  );
};

export default KPIGrid;
