/**
 * Vercel serverless entry for web3agent API (Node runtime).
 * Custom Node -> Web bridge avoids hono/vercel header mismatch on Node 20.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { app } from "../src/server/api.js";

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    const host = (req.headers.host as string) || "localhost";
    const proto = (req.headers["x-forwarded-proto"] as string) || "https";
    const url = `${proto}://${host}${req.url}`;

    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value === undefined) continue;
      if (Array.isArray(value)) {
        for (const v of value) headers.append(key, v);
      } else {
        headers.append(key, value);
      }
    }

    let body: Buffer | undefined;
    if (req.method !== "GET" && req.method !== "HEAD") {
      const chunks: Buffer[] = [];
      for await (const chunk of req as unknown as AsyncIterable<Buffer>) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      if (chunks.length > 0) {
        const buf = Buffer.concat(chunks);
        // Only set body if not empty
        if (buf.length > 0) body = buf;
      }
    }

    const webReq = new Request(url, {
      method: req.method,
      headers,
      body,
      // @ts-ignore duplex needed for Node fetch with body
      duplex: body ? "half" : undefined,
    });

    const webRes = await app.fetch(webReq);

    res.statusCode = webRes.status;
    webRes.headers.forEach((value, key) => {
      // Vercel/Node will handle setHeader case-insensitively
      res.setHeader(key, value);
    });

    const arrayBuffer = await webRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    res.end(buffer);
  } catch (err) {
    console.error("[api] handler error", err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    } else {
      res.end();
    }
  }
}
