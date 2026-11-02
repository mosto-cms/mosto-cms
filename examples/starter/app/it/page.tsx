import { HomePage } from '../components/home';

export const revalidate = 3600;

export default function Page() {
  return <HomePage locale="it" />;
}
