'use client';
import { useEffect, useState } from 'react';
import { AlertCircle, Building2, Clock, IndianRupee, ShoppingBag, Sprout, Wallet } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase';
import type { Order, Profile } from '@/lib/types';
import { formatDate, formatINR } from '@/lib/utils';
import { Badge, Empty, Metric, STATUS_TONE, prettyStatus } from '@/components/ui';

export function OverviewTab() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);

  useEffect(() => {
    (async () => {
      const sb = supabaseBrowser();
      const [p, o] = await Promise.all([
        sb.from('profiles').select('*'),
        sb.from('orders').select('*, buyer:profiles!orders_user_id_fkey(full_name, entity_name)').order('created_at', { ascending: false }),
      ]);
      setProfiles((p.data as Profile[]) ?? []);
      setOrders((o.data as Order[]) ?? []);
    })();
  }, []);

  const dealers = profiles.filter((p) => p.role === 'DEALER').length;
  const farmers = profiles.filter((p) => p.role === 'FARMER').length;
  const pending = profiles.filter((p) => p.status === 'PENDING' && p.role !== 'ADMIN').length;
  const outstanding = orders.filter((o) => o.payment_status !== 'PAID' && o.order_status !== 'CANCELLED').reduce((s, o) => s + (Number(o.final_amount) + Number(o.overdue_interest) - Number(o.amount_paid)), 0);
  const overdue = orders.filter((o) => o.payment_status === 'OVERDUE');

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-3xl font-black tracking-tight text-gray-900">Platform Dashboard</h1>
        <p className="mt-1 font-medium text-gray-500">Customers, orders and receivables at a glance.</p>
      </div>
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Registered Customers" value={dealers + farmers} icon={Building2} accent="blue" hint={<><Building2 className="inline h-3 w-3" /> {dealers} dealers · <Sprout className="inline h-3 w-3" /> {farmers} farmers</>} />
        <Metric label="Pending Registrations" value={pending} icon={Clock} accent="amber" pulse={pending > 0} hint="Awaiting KYC approval" />
        <Metric label="Total Orders" value={orders.length} icon={ShoppingBag} accent="slate" hint="All time" />
        <Metric label="Outstanding Payments" value={formatINR(outstanding)} icon={Wallet} accent="green" hint={`${overdue.length} overdue`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card overflow-hidden">
          <h2 className="flex items-center gap-2 border-b border-gray-100 px-5 py-3 font-black"><IndianRupee className="h-4 w-4 text-brand-600" /> Recent Orders</h2>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-gray-100">
              {orders.slice(0, 8).map((o) => (
                <tr key={o.id}>
                  <td className="td font-bold">{o.order_number}</td>
                  <td className="td">{o.buyer?.entity_name ?? o.buyer?.full_name}</td>
                  <td className="td">{formatDate(o.created_at)}</td>
                  <td className="td text-right font-black">{formatINR(o.final_amount)}</td>
                  <td className="td"><Badge tone={STATUS_TONE[o.order_status]}>{prettyStatus(o.order_status)}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!orders.length && <Empty>No orders yet.</Empty>}
        </div>
        <div className="card overflow-hidden">
          <h2 className="flex items-center gap-2 border-b border-gray-100 bg-red-50/30 px-5 py-3 font-black"><AlertCircle className="h-4 w-4 text-red-500" /> Overdue Payments</h2>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-gray-100">
              {overdue.map((o) => (
                <tr key={o.id}>
                  <td className="td font-bold">{o.order_number}</td>
                  <td className="td">{formatDate(o.due_date)}</td>
                  <td className="td text-right font-black text-red-600">{formatINR(Number(o.final_amount) + Number(o.overdue_interest) - Number(o.amount_paid))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!overdue.length && <Empty>No overdue payments.</Empty>}
        </div>
      </div>
    </div>
  );
}
