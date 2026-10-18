import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { FiRefreshCw, FiDollarSign, FiShoppingBag, FiUserPlus, FiUsers, FiAlertTriangle } from 'react-icons/fi';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import axiosClient from '../api/axiosClient';
import DataTable from './DataTable';
import StatTile from './StatTile';
import ConfirmDeleteButton from './ConfirmDeleteButton';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const inr = (val) => `₹${Number(val || 0).toLocaleString('en-IN')}`;

// Shown as-is from the API: a missing value is a dash, never a made-up 0.
const shown = (value) => (value === null || value === undefined ? '—' : value);
const money = (val) => (val === '—' ? val : Number(val).toLocaleString('en-IN', { maximumFractionDigits: 2 }));

const amounts = (byCurrency) => Object.entries(byCurrency || {})
  .map(([c, v]) => `${c} ${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`).join(', ');

// Everything reported beside the headline MRR, with the reason it is not in it
// (rules in server/services/platformMetrics.js). Nothing here is added to MRR.
function breakdownNotes(snapshot) {
  if (!snapshot) return [];
  const notes = [];
  const manual = snapshot.manual_grant_unverified;
  if (manual?.workspaces) notes.push(`Manual grants (payment not verified, so not counted as revenue): ${manual.workspaces} workspace(s), ${amounts(manual.mrr_by_currency)}/month`);
  const grace = snapshot.at_risk_grace;
  if (grace?.count) notes.push(`At risk: ${grace.count} subscription(s) in the 7-day grace period after expiry, ${amounts(grace.mrr_by_currency)}/month`);
  const suspended = snapshot.staff_suspended;
  if (suspended?.count) notes.push(`Included above but suspended by staff: ${suspended.count} workspace(s) (IDs ${suspended.tenant_ids.join(', ')}), ${amounts(suspended.mrr_by_currency)}/month`);
  const otherPaid = Object.entries(snapshot.paid?.mrr_by_currency || {}).filter(([c]) => c !== snapshot.currency);
  if (otherPaid.length) notes.push(`Paid MRR in other currencies, not added: ${amounts(Object.fromEntries(otherPaid))}`);
  const ex = snapshot.excluded || {};
  if (ex.orphan?.count) notes.push(`Excluded: ${ex.orphan.count} subscription(s) without a valid workspace (IDs ${ex.orphan.subscription_ids.join(', ')})`);
  if (ex.lapsed?.count) notes.push(`Excluded: ${ex.lapsed.count} expired subscription(s) past grace`);
  if (ex.contract_unverified?.count) notes.push(`Excluded: ${ex.contract_unverified.count} contract(s) that do not match an authorised term discount (${ex.contract_unverified.items.map((i) => `#${i.subscription_id} ${i.reason}`).join(', ')})`);
  if (ex.legacy_unconfirmed?.count) notes.push(`Excluded: ${ex.legacy_unconfirmed.count} legacy subscription(s) whose units/currency are unconfirmed (IDs ${ex.legacy_unconfirmed.items.map((i) => i.subscription_id).join(', ')})`);
  if (ex.undated?.count) notes.push(`Excluded: ${ex.undated.count} subscription(s) with no valid billing period (IDs ${ex.undated.subscription_ids.join(', ')})`);
  if (ex.duplicate_rows?.count) notes.push(`Duplicate rows counted once: ${ex.duplicate_rows.count}`);
  if (ex.superseded_overlap?.count) notes.push(`Overlapping subscriptions for a workspace already counted: ${ex.superseded_overlap.count}`);
  return notes;
}

const FounderReportsView = () => {
  const [snapshot, setSnapshot] = useState(null);
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchFounderData = async () => {
    setLoading(true);
    try {
      const res = await axiosClient.get('/admin/reports/founder-dashboard');
      setSnapshot(res.data?.snapshot || null);
      setReports(res.data?.reports || []);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to load founder reports');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFounderData();
  }, []);

  const handleDeleteReport = async (id) => {
    try {
      await axiosClient.delete(`/admin/workflows/logs/${id}`);
      toast.success('Report removed');
      fetchFounderData();
    } catch (err) {
      toast.error('Failed to remove report');
    }
  };

  const columns = [
    {
      key: 'created_at',
      title: 'Report Date',
      width: 180,
      render: (r) => (
        <span className="font-semibold text-slate-700">
          {r.created_at ? new Date(r.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
        </span>
      ),
    },
    {
      key: 'message',
      title: 'Daily AI Intelligence / Executive Summary',
      render: (r) => (
        <div className="rounded-lg border border-border bg-muted/50 px-4 py-3 text-[13px] leading-relaxed whitespace-pre-wrap">
          {r.message || 'Automated daily report generated without narrative.'}
        </div>
      ),
    },
    {
      key: 'action',
      title: 'Action',
      width: 80,
      render: (r) => <ConfirmDeleteButton title="Delete this report?" onConfirm={() => handleDeleteReport(r.id)} />,
    },
  ];

  return (
    <div>
      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatTile label="MRR (verified paid contracts)" value={snapshot?.mrr == null ? '—' : inr(snapshot.mrr)} valueClassName="text-green-600" />
        <StatTile label="TCV (verified paid, not yet ended)" value={snapshot?.totalContractValue == null ? '—' : inr(snapshot.totalContractValue)} valueClassName="text-blue-600" />
        <StatTile label="Paying Workspaces" value={shown(snapshot?.activeSubscriptions)} icon={<FiDollarSign />} valueClassName="text-amber-600" />
      </div>

      {breakdownNotes(snapshot).length > 0 && (
        <Alert className="mb-4 border-amber-200 bg-amber-50 text-amber-800">
          <FiAlertTriangle />
          <AlertTitle>Reported separately (not in MRR)</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">{breakdownNotes(snapshot).map((n) => <li key={n}>{n}</li>)}</ul>
          </AlertDescription>
        </Alert>
      )}

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTile label="Total Workspaces" value={shown(snapshot?.totalWorkspaces)} icon={<FiShoppingBag className="text-blue-500" />} />
        <StatTile label="Platform Users" value={shown(snapshot?.totalUsers)} icon={<FiUsers className="text-violet-500" />} />
        <StatTile label="Total Leads Managed" value={shown(snapshot?.totalLeads)} icon={<FiUserPlus className="text-emerald-500" />} />
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-base font-extrabold">Founder Daily Intelligence Reports</div>
          <div className="text-xs text-slate-400">
            Automated executive digests generated by WF06 with revenue, team SLA, and conversation velocity.
          </div>
        </div>
        <Button variant="outline" onClick={fetchFounderData} disabled={loading}>
          <FiRefreshCw className={cn(loading && 'animate-spin')} /> Refresh
        </Button>
      </div>

      <Card className="py-2">
        <DataTable columns={columns} data={reports} loading={loading} pageSize={8} emptyText="No daily founder reports recorded yet." />
      </Card>
    </div>
  );
};

export default FounderReportsView;
