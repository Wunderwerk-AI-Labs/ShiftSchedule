import type { APIRequestContext } from "@playwright/test";

/** Deliberately replace fixture state using the server's current revision. */
export async function saveTestState(
  request: APIRequestContext,
  url: string,
  options: { headers: Record<string, string>; data: object },
) {
  const current = await request.get(url, { headers: options.headers });
  if (!current.ok()) throw new Error(`Cannot load fixture revision: ${current.status()}`);
  const { revision } = await current.json();
  const response = await request.post(url, {
    ...options,
    data: { ...options.data, revision },
  });
  if (!response.ok()) throw new Error(`Cannot save fixture state: ${await response.text()}`);
  return response;
}
