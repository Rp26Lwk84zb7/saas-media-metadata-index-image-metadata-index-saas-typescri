import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { ZodError, z } from "zod";
import { InfraiError, InfraiMediaClient } from "./infrai_media_client.ts";
import {
  accountActionBody,
  DomainError,
  onboardingBody,
  TenantMediaIndex,
  uploadRequestBody,
} from "./tenant_media_index.ts";

const apiKey = process.env.INFRAI_API_KEY;
if (!apiKey) throw new Error("Set INFRAI_API_KEY before starting the service");

const media = new TenantMediaIndex(new InfraiMediaClient(apiKey));

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (request.method === "POST" && url.pathname === "/tenants/onboard") {
    send(response, 201, await media.onboard(onboardingBody.parse(await readJson(request))));
    return;
  }
  if (request.method === "POST" && url.pathname === "/accounts/suspend") {
    send(response, 200, media.suspend(accountActionBody.parse(await readJson(request))));
    return;
  }
  if (request.method === "POST" && url.pathname === "/accounts/reactivate") {
    send(response, 200, media.reactivate(accountActionBody.parse(await readJson(request))));
    return;
  }
  if (request.method === "POST" && url.pathname === "/admin/media/upload-url") {
    send(response, 200, await media.createUpload(uploadRequestBody.parse(await readJson(request))));
    return;
  }
  if (request.method === "POST" && url.pathname === "/admin/media/reindex") {
    const body = accountActionBody.parse(await readJson(request));
    send(response, 200, await media.rebuild(body.tenantId));
    return;
  }
  const indexMatch = url.pathname.match(/^\/tenants\/([^/]+)\/media-index$/);
  if (request.method === "GET" && indexMatch) {
    send(response, 200, { items: media.getIndex(decodeURIComponent(indexMatch[1])) });
    return;
  }
  send(response, 404, { error: "Route not found" });
}

export function toHttpError(error: unknown): { status: number; body: unknown } {
  if (error instanceof ZodError) return { status: 400, body: { error: "Invalid request", issues: error.issues } };
  if (error instanceof DomainError) return { status: error.status, body: { error: error.message } };
  if (error instanceof InfraiError) {
    const status = error.status >= 400 && error.status < 500 ? error.status : 502;
    return { status, body: { error: error.message, code: error.code } };
  }
  return { status: 500, body: { error: "Unexpected service error" } };
}

const port = z.coerce.number().int().positive().parse(process.env.PORT ?? "3000");
const server = createServer((request, response) => {
  route(request, response).catch((error: unknown) => {
    const mapped = toHttpError(error);
    send(response, mapped.status, mapped.body);
  });
});

server.listen(port, () => console.log(`Media admin service listening on http://localhost:${port}`));
