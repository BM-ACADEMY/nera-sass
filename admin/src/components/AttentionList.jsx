import React, { useEffect, useState } from 'react';
import { FiAlertTriangle, FiCheckCircle } from 'react-icons/fi';
import axiosClient from '../api/axiosClient';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const SEVERITY_CLASS = { critical: 'border-l-red-500', warning: 'border-l-amber-500', info: 'border-l-sky-500' };

/**
 * "Needs your attention": every open customer notice across workspaces
 * (template rejected, wallet low, number quality drop, setup unfinished,
 * payment failed), worst first. The same problems the customer sees in their
 * Notices box, plus staff-only ones such as a live number that has received
 * no inbound message or status receipt for 24 hours.
 */
const AttentionList = ({ onOpenWorkspace }) => {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () => axiosClient.get('/admin/attention')
      .then((res) => { if (alive) { setData(res.data); setFailed(false); } })
      .catch(() => { if (alive) setFailed(true); });
    load();
    const timer = setInterval(load, 60000);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  if (failed && !data) return null;
  const items = data?.items || [];
  return (
    <Card className="mb-6 gap-3">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><FiAlertTriangle /> Needs your attention {items.length > 0 && <Badge variant="danger">{items.length}</Badge>}</CardTitle>
        <CardDescription className="text-xs">Open problems in customer workspaces. They close by themselves when fixed.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {!data && <div className="text-sm text-muted-foreground">Loading…</div>}
        {data && !items.length && <div className="flex items-center gap-2 text-sm text-muted-foreground"><FiCheckCircle className="text-green-600" /> Nothing needs attention.</div>}
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onOpenWorkspace?.(item.tenant_id)}
            className={`cursor-pointer rounded-lg border border-border border-l-4 px-3 py-2 text-left hover:bg-muted ${SEVERITY_CLASS[item.severity] || ''}`}
          >
            <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
              {item.workspace} <Badge variant="muted">{item.label}</Badge>
              {item.email_problem && <Badge variant="warning">Email not delivered</Badge>}
              {item.staff_only && <Badge variant="outline">Staff only</Badge>}
            </div>
            <div className="text-[12.5px] text-muted-foreground">{item.title}. {item.message}</div>
            {item.staff_only && item.advice && <div className="text-[12px] text-muted-foreground">{item.advice}</div>}
          </button>
        ))}
      </CardContent>
    </Card>
  );
};

export default AttentionList;
