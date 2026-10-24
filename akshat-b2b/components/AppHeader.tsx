'use client';
import Link from 'next/link';
import { LayoutDashboard, LogOut } from 'lucide-react';
import type { Profile } from '@/lib/types';

export function AppHeader({ profile, onSignOut }: { profile: Profile | null; onSignOut: () => void }) {
  return (
    <header className="sticky top-0 z-30 border-b border-gray-200 bg-white/90 shadow-sm backdrop-blur">
      <div className="mx-auto flex h-20 max-w-7xl items-center gap-4 px-4 md:px-6">
        <Link href="/home"><img src="/brand/logo.png" alt="Akshat Fertilizers" className="h-10 w-auto md:h-11" /></Link>
        <div className="flex-1" />
        {profile?.role === 'admin' && (
          <Link href="/admin/dashboard" className="btn-secondary"><LayoutDashboard className="h-4 w-4" /> Admin</Link>
        )}
        {profile && (
          <div className="hidden text-right text-xs leading-tight md:block">
            <p className="font-bold text-gray-800">{profile.business_name ?? profile.email}</p>
            <p className="font-medium text-gray-400">{profile.gstin ?? profile.role.toUpperCase()}</p>
          </div>
        )}
        <button onClick={onSignOut} className="btn-secondary" aria-label="Sign out"><LogOut className="h-4 w-4" /></button>
      </div>
    </header>
  );
}
