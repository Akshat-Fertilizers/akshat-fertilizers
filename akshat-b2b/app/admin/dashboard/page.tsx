'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { IndianRupee, LayoutDashboard, LogOut, PackageSearch, Shield, Sprout, Truck, Users } from 'lucide-react';
import { useProfile } from '@/lib/hooks/useProfile';
import { cn } from '@/lib/utils';
import { STAFF_TIER_LABEL, effectiveStaffTier, staffCan } from '@/lib/business';
import type { StaffArea } from '@/lib/types';
import { FullPageLoader } from '@/components/ui';
import { OverviewTab } from '@/components/admin/OverviewTab';
import { CustomersTab } from '@/components/admin/CustomersTab';
import { CatalogueTab } from '@/components/admin/CatalogueTab';
import { OrdersTab } from '@/components/admin/OrdersTab';
import { FinanceTab } from '@/components/admin/FinanceTab';
import { TeamTab } from '@/components/admin/TeamTab';

const TABS = [
  { id: 'overview', area: null, label: 'Overview', icon: LayoutDashboard },
  { id: 'customers', area: 'customers', label: 'Customers & KYC', icon: Users },
  { id: 'catalogue', area: 'catalog', label: 'Products & Pricing', icon: PackageSearch },
  { id: 'orders', area: 'operations', label: 'Orders', icon: Truck },
  { id: 'finance', area: 'finance', label: 'Payments & Credit', icon: IndianRupee },
  { id: 'team', area: 'team', label: 'Staff & Roles', icon: Shield },
] as const;
type TabId = (typeof TABS)[number]['id'];

export default function AdminDashboardPage() {
  const router = useRouter();
  const { session, profile, loading, signOut } = useProfile();
  const [tab, setTab] = useState<TabId | null>(null);

  const tabs = useMemo(() => TABS.filter((t) => t.area === null || staffCan(profile, t.area as StaffArea)), [profile]);

  useEffect(() => {
    if (loading) return;
    if (!session) router.replace('/login');
    else if (profile && profile.role !== 'ADMIN') router.replace('/portal');
  }, [loading, session, profile, router]);

  useEffect(() => {
    if (!tabs.length) return;
    const h = window.location.hash.slice(1) as TabId;
    setTab(tabs.some((t) => t.id === h) ? h : tabs[0].id);
  }, [tabs]);

  if (loading || !profile || profile.role !== 'ADMIN' || !tab) return <FullPageLoader />;
  const roleLabel = STAFF_TIER_LABEL[effectiveStaffTier(profile) ?? ''] ?? 'Staff';

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-gray-200 bg-gray-900 text-gray-200 md:flex">
        <div className="flex items-center gap-2 px-5 py-5 font-black text-white"><Sprout className="h-6 w-6 text-brand-400" /> Akshat Admin</div>
        <nav className="flex-1 space-y-1 px-3">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => { setTab(id); history.replaceState(null, '', `#${id}`); }}
              className={cn('flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-semibold transition', tab === id ? 'bg-brand-600 text-white' : 'hover:bg-gray-800')}>
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
        </nav>
        <div className="border-t border-gray-800 p-4 text-xs">
          <p className="truncate text-gray-200">{profile.email}</p>
          <p className="text-brand-400">{roleLabel}</p>
          <button onClick={signOut} className="mt-2 flex items-center gap-2 text-gray-300 hover:text-white"><LogOut className="h-3.5 w-3.5" /> Sign out</button>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <div className="sticky top-0 z-20 flex gap-1 overflow-x-auto border-b border-gray-200 bg-white p-2 md:hidden">
          {tabs.map(({ id, label }) => (
            <button key={id} onClick={() => setTab(id)} className={cn('whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-bold', tab === id ? 'bg-brand-600 text-white' : 'text-gray-600')}>{label}</button>
          ))}
        </div>
        <main className="mx-auto max-w-7xl p-4 md:p-8">
          {tab === 'overview' && <OverviewTab />}
          {tab === 'customers' && <CustomersTab />}
          {tab === 'catalogue' && <CatalogueTab />}
          {tab === 'orders' && <OrdersTab />}
          {tab === 'finance' && <FinanceTab />}
          {tab === 'team' && <TeamTab meId={profile.id} />}
        </main>
      </div>
    </div>
  );
}
