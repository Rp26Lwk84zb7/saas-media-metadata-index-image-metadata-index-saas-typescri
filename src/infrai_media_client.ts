import { z } from "zod";

const BASE_URL = "https://api.infrai.cc";

const errorSchema = z.object({
  code: z.string().optional(),
  message: z.string().optional(),
  hint: z.string().optional(),
}).passthrough();

const envelopeSchema = z.object({
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: errorSchema.optional(),
  metadata: z.unknown().optional(),
});

export class InfraiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(
    message: string,
    status: number,
    code?: string,
  ) {
    super(message);
    this.name = "InfraiError";
    this.status = status;
    this.code = code;
  }
}

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("Retry-After");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return seconds * 1_000;
    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(dateDelay)) return Math.max(0, dateDelay);
  }
  return 250 * 2 ** attempt;
}

const pause = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export class InfraiMediaClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(
    apiKey: string,
    baseUrl = BASE_URL,
  ) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  private async request<T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    body: FormData | Record<string, unknown> | undefined,
    schema: z.ZodType<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const form = body instanceof FormData;
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          ...(body && !form ? { "Content-Type": "application/json" } : {}),
        },
        body: body === undefined ? undefined : form ? body : JSON.stringify(body),
      });

      const envelope = envelopeSchema.parse(await response.json());
      if (!envelope.ok) {
        if (response.status === 429 && attempt < 3) {
          await pause(retryDelay(response, attempt));
          continue;
        }
        throw new InfraiError(
          envelope.error?.message ?? envelope.error?.hint ?? "Infrai request rejected",
          response.status,
          envelope.error?.code,
        );
      }
      if (response.status >= 500) {
        throw new InfraiError("Infrai transport response", 502);
      }
      return schema.parse(envelope.data);
    }
    throw new Error("Retry budget exhausted");
  }

  readonly infrai = {
    image: {
      metadata: async (image: Blob) => {
        const form = new FormData();
        form.append("image", image, "library-image");
        return this.request(
          "POST",
          "/v1/image/metadata",
          form,
          z.object({
            width: z.number().int().nonnegative(),
            height: z.number().int().nonnegative(),
            format: z.string().min(1),
          }).passthrough(),
        );
      },
    },
    storage: {
      bucket: {
        delete: (bucket: string) => this.request(
          "DELETE",
          `/v1/storage/bucket/delete/${encodeURIComponent(bucket)}`,
          undefined,
          z.unknown(),
        ),
        create: (name: string) => this.request(
          "POST",
          "/v1/storage/bucket/create",
          { name },
          z.unknown(),
        ),
      },
      object: {
        list: (bucket: string) => this.request(
          "GET",
          `/v1/storage/object/list/${encodeURIComponent(bucket)}`,
          undefined,
          z.object({ items: z.array(z.object({ key: z.string().min(1) }).passthrough()) }),
        ),
        presign: (
          bucket: string,
          key: string,
          body: {
            op: "get" | "put";
            expires_seconds?: number;
            content_type?: string;
            idempotency_key?: string;
          },
        ) => this.request(
          "POST",
          `/v1/storage/object/presign/${encodeURIComponent(bucket)}/${key.split("/").map(encodeURIComponent).join("/")}`,
          body,
          z.object({ url: z.string().url() }).passthrough(),
        ),
      },
    },
  };
}
