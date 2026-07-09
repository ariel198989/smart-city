import type { Metadata } from 'next';
import AdminView from '@/components/AdminView';

export const metadata: Metadata = { title: 'ניהול סדנאות — Smart City', robots: { index: false } };

export default function AdminPage() {
  return <AdminView />;
}
