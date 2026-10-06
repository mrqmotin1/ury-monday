import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useBranchContext } from '../../context/BranchContext';
import KPIGrid from './KPIGrid';
import AnalyticsCharts from './AnalyticsCharts';
import ReportWidgets from './ReportWidgets';
import {
  dashboardService,
  DashboardSummary,
  DashboardChartsData,
  TransactionRecord,
} from '../../services/dashboard';
import { subscribeDoctypeUpdates } from '../../lib/realtimeClient';

// One order can be saved several times in a row (items, KOT, payment), so
// realtime events are batched into a single refetch.
const REALTIME_DEBOUNCE_MS = 1500;
// Backup refresh in case the socket is down or an update skipped notify.
const FALLBACK_POLL_MS = 60_000;

export const DashboardPage: React.FC = () => {
  const { activeBranchId } = useBranchContext();

  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [chartsData, setChartsData] = useState<DashboardChartsData | null>(null);
  const [recentTransactions, setRecentTransactions] = useState<TransactionRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  // Drops responses from an older request (e.g. after a branch switch).
  const requestIdRef = useRef(0);

  // `silent` refreshes keep the current data on screen instead of a spinner.
  const fetchDashboardData = useCallback(async (silent = false) => {
    const requestId = ++requestIdRef.current;
    if (!silent) setLoading(true);
    try {
      const [sumRes, chartRes, txRes] = await Promise.all([
        dashboardService.getSummary(activeBranchId),
        dashboardService.getCharts(activeBranchId),
        dashboardService.getRecentTransactions(activeBranchId, 10),
      ]);
      if (requestId !== requestIdRef.current) return;
      setSummary(sumRes);
      setChartsData(chartRes);
      setRecentTransactions(txRes);
    } catch (err) {
      console.error('Failed to load dashboard data:', err);
    } finally {
      if (!silent && requestId === requestIdRef.current) setLoading(false);
    }
  }, [activeBranchId]);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  // Live updates: refetch when any POS Invoice is created/updated/paid.
  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = subscribeDoctypeUpdates('POS Invoice', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => fetchDashboardData(true), REALTIME_DEBOUNCE_MS);
    });
    return () => {
      clearTimeout(debounceTimer);
      unsubscribe();
    };
  }, [fetchDashboardData]);

  // Fallback: slow poll while the tab is visible, and refresh on tab return.
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') fetchDashboardData(true);
    }, FALLBACK_POLL_MS);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') fetchDashboardData(true);
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [fetchDashboardData]);

  return (
    <div className="space-y-6">
      {/* 1. KPI Stat Cards Grid */}
      <KPIGrid summary={summary} loading={loading} />

      {/* 2. Analytics & Distribution Charts (Commented out for now) */}
      {/* <AnalyticsCharts chartsData={chartsData} loading={loading} /> */}

      {/* 3. Live Recent Transactions */}
      <ReportWidgets recentTransactions={recentTransactions} loading={loading} />
    </div>
  );
};

export default DashboardPage;
