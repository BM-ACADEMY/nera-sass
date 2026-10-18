import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import axiosClient from '../api/axiosClient';
import MetaInventoryCard from './clients/MetaInventoryCard';

const EMPTY_INVENTORY = { wabas: [], phone_numbers: [], templates: [], template_summary: [], workspaces: [], last_sync: null };

// Platform WhatsApp numbers: add a number to a WABA in Meta, sync, then
// assign it to one workspace. Workspaces themselves are created by
// Provision Workspace and are never created or changed here.
const ClientsManagement = () => {
  const [inventory, setInventory] = useState(EMPTY_INVENTORY);
  const [loading, setLoading] = useState(false);

  const fetchInventory = async () => {
    setLoading(true);
    try {
      const { data } = await axiosClient.get('/admin/meta/whatsapp/inventory');
      setInventory({ ...EMPTY_INVENTORY, ...data });
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to load the Meta WhatsApp inventory');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInventory();
  }, []);

  return (
    <div>
      <div className="mb-5">
        <div className="text-base font-extrabold">WhatsApp Numbers</div>
        <div className="text-xs text-slate-400">
          Add a number under a WABA, sync, then assign it to a workspace. An assigned number is linked to that workspace only. {loading && '(loading...)'}
        </div>
      </div>

      <MetaInventoryCard inventory={inventory} onRefresh={fetchInventory} />
    </div>
  );
};

export default ClientsManagement;
