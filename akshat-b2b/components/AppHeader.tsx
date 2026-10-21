'use client';
import Link from 'next/link';
import { LayoutDashboard, LogOut, Sprout, Store } from 'lucide-react';
import type { Profile } from '@/lib/types';

export function AppHeader({ profile, onSignOut }: { profile: Profile | null; onSignOut: () => void }) {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4">
        <Link href="/home" className="flex items-center gap-2 font-semibold text-emerald-800">
          <Sprout className="h-6 w-6" /> Akshat Fertilizer <span className="hidden text-slate-400 sm:inline">· B2B</span>
        </Link>
        <div className="flex-1" />
        {profile?.role === 'admin' ? (
          <Link href="/admin/dashboard" className="btn-secondary"><LayoutDashboard className="h-4 w-4" /> Admin</Link>
        ) : (
          <Link href="/home" className="hidden sm:inline-flex btn-secondary"><Store className="h-4 w-4" /> Catalog</Link>
        )}
        {profile && (
          <div className="hidden text-right text-xs leading-tight md:block">
            <p className="font-medium text-slate-800">{profile.business_name ?? profile.email}</p>
            <p className="text-slate-500">{profile.gstin ?? profile.role.toUpperCase()}</p>
          </div>
        )}
        <button onClick={onSignOut} className="btn-secondary" aria-label="Sign out"><LogOut className="h-4 w-4" /></button>
      </div>
    </header>
  );
}
