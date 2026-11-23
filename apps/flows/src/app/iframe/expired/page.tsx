import { embedAllowedOrigins } from '@/lib/embed';

import { SessionEnded } from './session-ended';

export default function ExpiredPage() {
  return <SessionEnded origins={embedAllowedOrigins()} />;
}
