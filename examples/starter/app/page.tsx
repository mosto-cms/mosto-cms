import { HomePage } from './components/home';

// Static page, regenerated on demand: /api/mosto-cms expires it right after a publish.
export const revalidate = 3600;

export default function Page() {
  return <HomePage locale="en" />;
}
