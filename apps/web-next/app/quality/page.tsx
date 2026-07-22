import { redirect } from 'next/navigation';

export default function QualityPage() {
  redirect('/dashboard?view=quality');
}
