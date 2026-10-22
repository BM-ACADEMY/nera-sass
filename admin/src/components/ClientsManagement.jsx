import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { FiAlertTriangle, FiRefreshCw } from 'react-icons/fi';
import axiosClient from '../api/axiosClient';
import { useLiveRefresh } from '../api/realtime';
import MetaInventoryCard from './clients/MetaInventoryCard';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

const EMPTY_INVENTORY = { wabas: [], phone_numbers: [], template_summary: [], workspaces: [], last_sync: null };

// Last loaded inventory, kept while the admin panel is open.
let cachedInventory = null;

// Shape of the page while the first load is in flight.
const InventorySkeleton = () => (
  <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading WhatsApp numbers">
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {[0, 1, 2, 3].map((i) => (
        <Card key={i} className="gap-3 px-5 py-4">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-7 w-12" />
        </Card>
      ))}
    </div>
    <Card className="gap-5 p-5 sm:p-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-56" />
          <Skeleton className="h-3 w-72 max-w-full" />
        </div>
        <Skeleton className="h-8 w-36" />
      </div>
      <div className="flex flex-col justify-between gap-3 sm:flex-row">
        <Skeleton className="h-9 w-full sm:w-80" />
        <Skeleton className="h-9 w-full sm:w-72" />
      </div>
      <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-4 py-2">
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-3.5 w-40" />
              <Skeleton className="h-3 w-28" />
            </div>
            <Skeleton className="hidden h-3.5 w-28 md:block" />
            <Skeleton className="h-5 w-16" />
            <Skeleton className="hidden h-5 w-14 md:block" />
          </div>
        ))}
      </div>
    </Card>
  </div>
);

// Platform WhatsApp numbers: add a number to a WABA in Meta, sync, then
// assign it to one workspace. Workspaces themselves are created by
// Provision Workspace and are never created or changed here.
const ClientsManagement = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const focusTenantId = Number(searchParams.get('workspace')) || null;
  const [inventory, setInventory] = useState(cachedInventory || EMPTY_INVENTORY);
  const [status, setStatus] = useState(cachedInventory ? 'ready' : 'loading'); // loading | ready | error
  const [error, setError] = useState('');

  const fetchInventory = async ({ quiet = false } = {}) => {
    if (!quiet) setStatus((s) => (s === 'ready' ? s : 'loading'));
    try {
      const { data } = await axiosClient.get('/admin/meta/whatsapp/inventory');
      cachedInventory = { ...EMPTY_INVENTORY, ...data };
      setInventory(cachedInventory);
      setStatus('ready');
    } catch (err) {
      const message = err.response?.data?.error || 'Failed to load the Meta WhatsApp inventory';
      setError(message);
      setStatus((s) => (s === 'ready' ? s : 'error'));
      toast.error(message);
    }
  };

  useEffect(() => {
    fetchInventory();
  }, []);

  // A number assigned or a workspace created elsewhere shows up here at once.
  useLiveRefresh(() => fetchInventory({ quiet: true }));

  const clearFocus = () => {
    searchParams.delete('workspace');
    setSearchParams(searchParams, { replace: true });
  };

  return (
    <div>
      <div className="mb-5">
        <div className="text-base font-extrabold">WhatsApp Numbers</div>
        <div className="text-xs text-slate-400">
          Add a number under a WABA, sync, then assign it to a workspace. A workspace uses one number, and a number belongs to one workspace.
        </div>
      </div>

      {status === 'loading' && <InventorySkeleton />}

      {status === 'error' && (
        <Card className="items-center gap-3 px-6 py-12 text-center">
          <span className="flex size-11 items-center justify-center rounded-full bg-amber-50 text-amber-600"><FiAlertTriangle size={20} /></span>
          <div className="text-sm font-semibold">Could not load the WhatsApp numbers</div>
          <p className="max-w-md text-xs text-muted-foreground">{error}</p>
          <Button variant="outline" onClick={() => fetchInventory()}>
            <FiRefreshCw /> Try again
          </Button>
        </Card>
      )}

      {status === 'ready' && (
        <MetaInventoryCard
          inventory={inventory}
          onRefresh={() => fetchInventory({ quiet: true })}
          focusTenantId={focusTenantId}
          onClearFocus={clearFocus}
        />
      )}
    </div>
  );
};

export default ClientsManagement;
