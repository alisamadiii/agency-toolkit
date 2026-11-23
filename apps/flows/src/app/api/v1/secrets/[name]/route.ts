import { ApiError, body, json, route, workspaceOf } from '@/lib/api';
import { secretNameSchema, secretPutSchema } from '@/lib/schemas';
import { deleteSecret, putSecret } from '@/lib/service';

type P = { name: string };

function name(raw: string) {
  const parsed = secretNameSchema.safeParse(raw);
  if (!parsed.success) throw new ApiError(400, 'Secret names are UPPER_SNAKE_CASE');
  return parsed.data;
}

export const PUT = route<P>(async (req, auth, params) => {
  const { value } = await body(req, secretPutSchema);
  return json(await putSecret(workspaceOf(req, auth), name(params.name), value));
});

export const DELETE = route<P>(async (req, auth, params) => {
  await deleteSecret(workspaceOf(req, auth), name(params.name));
  return new Response(null, { status: 204 });
});
