import { createHash } from "node:crypto";
import { z } from "zod";
import { InfraiError, InfraiMediaClient } from "./infrai_media_client.ts";

export const onboardingBody = z.object({
  tenantId: z.string().regex(/^[a-z0-9-]{3,40}$/),
  displayName: z.string().min(1).max(80),
});

export const accountActionBody = z.object({
  tenantId: z.string().regex(/^[a-z0-9-]{3,40}$/),
});

export const uploadRequestBody = accountActionBody.extend({
  objectKey: z.string().min(1).max(240).refine((key) => !key.startsWith("/") && !key.includes("..")),
  contentType: z.string().regex(/^image\/[a-z0-9.+-]+$/i),
});

export type ImageFacts = {
  width: number;
  height: number;
  format: string;
};

export type IndexEntry = ImageFacts & {
  key: string;
  indexedAt: string;
};

export function needsReindex(previous: IndexEntry | undefined, next: ImageFacts): boolean {
  return previous === undefined
    || previous.width !== next.width
    || previous.height !== next.height
    || previous.format.toLowerCase() !== next.format.toLowerCase();
}

type Account = {
  tenantId: string;
  displayName: string;
  status: "active" | "suspended";
  bucket: string;
};

export class TenantMediaIndex {
  private readonly accounts = new Map<string, Account>();
  private readonly entries = new Map<string, Map<string, IndexEntry>>();
  private readonly client: InfraiMediaClient;

  constructor(client: InfraiMediaClient) {
    this.client = client;
  }

  async onboard(input: z.infer<typeof onboardingBody>): Promise<Account> {
    const body = onboardingBody.parse(input);
    const bucket = `media-${body.tenantId}`;
    try {
      await this.client.infrai.storage.bucket.create(bucket);
    } catch (error) {
      if (!(error instanceof InfraiError) || error.status !== 409) throw error;
    }
    const account: Account = { tenantId: body.tenantId, displayName: body.displayName, status: "active", bucket };
    this.accounts.set(body.tenantId, account);
    this.entries.set(body.tenantId, new Map());
    return account;
  }

  suspend(input: z.infer<typeof accountActionBody>): Account {
    return this.changeStatus(input, "suspended");
  }

  reactivate(input: z.infer<typeof accountActionBody>): Account {
    return this.changeStatus(input, "active");
  }

  async createUpload(input: z.infer<typeof uploadRequestBody>): Promise<{ method: "PUT"; url: string }> {
    const body = uploadRequestBody.parse(input);
    const account = this.activeAccount(body.tenantId);
    const requestId = createHash("sha256")
      .update(`${body.tenantId}:${body.objectKey}`)
      .digest("hex");
    const signed = await this.client.infrai.storage.object.presign(account.bucket, body.objectKey, {
      op: "put",
      expires_seconds: 600,
      content_type: body.contentType,
      idempotency_key: requestId,
    });
    return { method: "PUT", url: signed.url };
  }

  async rebuild(tenantId: string): Promise<{ tenantId: string; scanned: number; updated: number; entries: IndexEntry[] }> {
    const { tenantId: validTenantId } = accountActionBody.parse({ tenantId });
    const account = this.activeAccount(validTenantId);
    const listing = await this.client.infrai.storage.object.list(account.bucket);
    const tenantEntries = this.entries.get(validTenantId) ?? new Map<string, IndexEntry>();
    let updated = 0;

    for (const item of listing.items) {
      const signed = await this.client.infrai.storage.object.presign(account.bucket, item.key, {
        op: "get",
        expires_seconds: 300,
      });
      const imageResponse = await fetch(signed.url, { method: "GET" });
      if (!imageResponse.ok) throw new Error(`Could not read media object ${item.key}`);
      const metadata = await this.client.infrai.image.metadata(await imageResponse.blob());
      const facts = { ...metadata, width: metadata.width, height: metadata.height, format: metadata.format };
      if (needsReindex(tenantEntries.get(item.key), facts)) {
        tenantEntries.set(item.key, { key: item.key, ...facts, indexedAt: new Date().toISOString() });
        updated += 1;
      }
    }

    this.entries.set(validTenantId, tenantEntries);
    return { tenantId: validTenantId, scanned: listing.items.length, updated, entries: [...tenantEntries.values()] };
  }

  getIndex(tenantId: string): IndexEntry[] {
    accountActionBody.parse({ tenantId });
    this.account(tenantId);
    return [...(this.entries.get(tenantId)?.values() ?? [])];
  }

  private changeStatus(input: z.infer<typeof accountActionBody>, status: Account["status"]): Account {
    const body = accountActionBody.parse(input);
    const account = this.account(body.tenantId);
    const changed = { ...account, status };
    this.accounts.set(body.tenantId, changed);
    return changed;
  }

  private account(tenantId: string): Account {
    const account = this.accounts.get(tenantId);
    if (!account) throw new DomainError(404, "Tenant is not onboarded");
    return account;
  }

  private activeAccount(tenantId: string): Account {
    const account = this.account(tenantId);
    if (account.status !== "active") throw new DomainError(409, "Tenant account is suspended");
    return account;
  }
}

export class DomainError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "DomainError";
    this.status = status;
  }
}
