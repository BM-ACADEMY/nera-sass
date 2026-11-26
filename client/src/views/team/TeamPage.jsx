import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { FiRefreshCw, FiAlertTriangle } from 'react-icons/fi';
import { api } from '../../services/api.js';
import { canSeeTeam } from '../settings/teamPolicy.js';
import { TeamSection } from '../settings/TeamSection.jsx';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

// /team: staff management, its own sidebar page. Shown only with the server's
// view_team permission (GET /api/tenant); the server checks every call again.
export default function TeamPage() {
  const [data, setData] = useState(null); // { tenantInfo, me }
  const [error, setError] = useState('');

  const load = useCallback(() => {
    Promise.all([api.getTenant(), api.getMe()])
      .then(([tenantInfo, me]) => { setData({ tenantInfo, me }); setError(''); })
      .catch((err) => setError(err.message || 'Please check your connection and try again.'));
  }, []);
  useEffect(() => { load(); }, [load]);

  if (data && !canSeeTeam(data.tenantInfo?.permissions)) return <Navigate to="/dashboard" replace />;

  return (
    <div className="p-4 md:p-8">
      {data ? <TeamSection {...data} /> : error ? (
        <Card className="max-w-xl items-center gap-3 px-6 py-12 text-center">
          <FiAlertTriangle className="size-7 text-amber-500" />
          <div className="font-semibold">The team could not be loaded</div>
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button variant="outline" onClick={load}><FiRefreshCw /> Try again</Button>
        </Card>
      ) : (
        <div className="flex max-w-6xl flex-col gap-4"><Skeleton className="h-24 rounded-2xl" /><Skeleton className="h-64 rounded-2xl" /></div>
      )}
    </div>
  );
}
