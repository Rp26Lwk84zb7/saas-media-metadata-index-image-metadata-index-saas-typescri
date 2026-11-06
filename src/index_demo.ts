import { randomUUID } from "node:crypto";
import { InfraiError, InfraiMediaClient } from "./infrai_media_client.ts";
import { onboardingBody, TenantMediaIndex } from "./tenant_media_index.ts";

const apiKey = process.env.INFRAI_API_KEY;
if (!apiKey) throw new Error("Set INFRAI_API_KEY before running the demo");

const tenantId = process.env.TENANT_ID ?? `demo-${randomUUID().slice(0, 12)}`;
const client = new InfraiMediaClient(apiKey);
const media = new TenantMediaIndex(client);
const bucket = `media-${tenantId}`;
const onboarding = onboardingBody.parse({ tenantId, displayName: "Acme Demo" });

// Claim ownership first: a conflict must never lead to deleting an existing bucket.
await client.infrai.storage.bucket.create(bucket);
try {
  const account = await media.onboard(onboarding);
  const result = await media.rebuild(tenantId);

  console.log(JSON.stringify({ account, result }, null, 2));
} finally {
  await client.infrai.storage.bucket.delete(bucket);
  try {
    await client.infrai.storage.object.list(bucket);
    throw new Error(`Bucket deletion could not be verified: ${bucket}`);
  } catch (error) {
    if (!(error instanceof InfraiError) || error.status !== 404) throw error;
  }
  console.log(`Deleted and verified demo bucket: ${bucket}`);
}
