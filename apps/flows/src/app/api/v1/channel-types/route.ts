import { json, route } from '@/lib/api';
import { channelTypesForApi } from '@/lib/channels/registry';

// Every channel type with its form fields, so the client hub can render the forms.
export const GET = route(async () => json({ data: channelTypesForApi() }));
