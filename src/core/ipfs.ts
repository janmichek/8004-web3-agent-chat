/**
 * Binary file uploads to IPFS (agent avatars/images).
 *
 * Mirrors the backend selection used in registry.ts / reputation.ts:
 * PINATA_JWT → Pinata, else IPFS_NODE_URL → local IPFS node.
 * The agent0-sdk IPFSClient only accepts string payloads, so binary
 * uploads (images) are handled directly here.
 *
 * @module ipfs
 */

const PINATA_UPLOAD_URL = "https://uploads.pinata.cloud/v3/files";
const DEFAULT_GATEWAY = "https://beige-added-mole-82.mypinata.cloud/ipfs";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Gateway base URL, overridable via PINATA_GATEWAY_URL. */
function getGatewayBase(): string {
  return (process.env.PINATA_GATEWAY_URL?.trim() || DEFAULT_GATEWAY).replace(/\/$/, "");
}

/** Convert `ipfs://<cid>` (or bare CID) to `https://<gateway>/ipfs/<cid>`. */
export function toGatewayUrl(uri: string): string {
  const t = uri.trim();
  if (/^ipfs:\/\//i.test(t)) return `${getGatewayBase()}/${t.replace(/^ipfs:\/\//i, "")}`;
  return t;
}

export type IpfsImage = {
  /** Contents as a buffer. */
  data: Buffer;
  mimeType: string;
  fileName: string;
};

export function hasIpfsBackend(): boolean {
  return Boolean(process.env.PINATA_JWT?.trim() || process.env.IPFS_NODE_URL?.trim());
}

export function validateImage(fileName: string, mimeType: string, size: number): string | null {
  const allowed = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"];
  if (!allowed.includes(mimeType)) {
    return `Unsupported image type "${mimeType}" (allowed: ${allowed.join(", ")})`;
  }
  if (size > MAX_IMAGE_BYTES) {
    return "Image is too large (max 5 MB)";
  }
  if (!fileName.trim()) {
    return "Image file name is required";
  }
  return null;
}

/**
 * Upload binary data to the configured IPFS backend.
 * @returns Gateway URL in the form `https://<gateway>/ipfs/<cid>`.
 */
export async function uploadImage(image: IpfsImage): Promise<string> {
  const form = imageForm(image);
  const backend = resolveBackend();
  const cid =
    backend.kind === "pinata"
      ? await uploadToPinata(form, backend.jwt, "Pinata upload")
      : await uploadToIpfsNode(form, backend.nodeUrl, "IPFS node upload");
  return `${getGatewayBase()}/${cid}`;
}

/**
 * Upload a JSON document to the configured IPFS backend.
 * @returns The CID (without gateway prefix).
 */
export async function uploadJson(
  data: unknown,
  fileName = "agent-registration.json",
): Promise<string> {
  const form = jsonForm(data, fileName);
  const backend = resolveBackend();
  return backend.kind === "pinata"
    ? uploadToPinata(form, backend.jwt, "Pinata JSON upload")
    : uploadToIpfsNode(form, backend.nodeUrl, "IPFS node JSON upload");
}

type IpfsBackend = { kind: "pinata"; jwt: string } | { kind: "node"; nodeUrl: string };

function resolveBackend(): IpfsBackend {
  const pinataJwt = process.env.PINATA_JWT?.trim();
  if (pinataJwt) return { kind: "pinata", jwt: pinataJwt };
  const ipfsNodeUrl = process.env.IPFS_NODE_URL?.trim();
  if (ipfsNodeUrl) return { kind: "node", nodeUrl: ipfsNodeUrl };
  throw new Error("No IPFS backend configured (set PINATA_JWT or IPFS_NODE_URL)");
}

function jsonForm(data: unknown, fileName: string): FormData {
  const bytes = new TextEncoder().encode(JSON.stringify(data, null, 2));
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "application/json" }), fileName);
  return form;
}

function imageForm(image: IpfsImage): FormData {
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(image.data)], { type: image.mimeType }),
    image.fileName,
  );
  return form;
}

async function uploadToPinata(form: FormData, jwt: string, label: string): Promise<string> {
  // Pinata v3 defaults to `private` — private CIDs are NOT servable via
  // public/dedicated gateways (ERR_ID:00006). Agent assets must be public.
  form.append("network", "public");
  const res = await fetch(PINATA_UPLOAD_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}` },
    body: form,
  });
  await assertOk(res, label);
  const json = (await res.json()) as { data?: { cid?: string }; cid?: string };
  const cid = json.data?.cid ?? json.cid;
  if (!cid) throw new Error("Pinata upload response did not contain a CID");
  return cid;
}

async function uploadToIpfsNode(form: FormData, nodeUrl: string, label: string): Promise<string> {
  const url = `${nodeUrl.replace(/\/$/, "")}/api/v0/add?pin=true`;
  const res = await fetch(url, { method: "POST", body: form });
  await assertOk(res, label);
  // Kubo returns a single JSON object (Last-Chunk mode off) or NDJSON lines.
  const text = await res.text();
  const json = JSON.parse(text.split("\n")[0]) as { Hash?: string };
  if (!json.Hash) throw new Error("IPFS node upload response did not contain a Hash");
  return json.Hash;
}

/** Throws the backend-specific upload error for a non-2xx response. */
async function assertOk(res: Response, label: string): Promise<void> {
  if (res.ok) return;
  const text = await res.text().catch(() => "");
  throw new Error(`${label} failed (${res.status}): ${text.slice(0, 200)}`);
}
