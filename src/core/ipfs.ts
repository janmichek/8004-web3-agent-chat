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
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export type IpfsImage = {
  /** Contents as a buffer. */
  data: Buffer;
  mimeType: string;
  fileName: string;
};

export function hasIpfsBackend(): boolean {
  return Boolean(process.env.PINATA_JWT?.trim() || process.env.IPFS_NODE_URL?.trim());
}

export function validateImage(
  fileName: string,
  mimeType: string,
  size: number,
): string | null {
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
 * @returns URI in the form `ipfs://<cid>`.
 */
export async function uploadImage(image: IpfsImage): Promise<string> {
  const pinataJwt = process.env.PINATA_JWT?.trim();
  if (pinataJwt) return uploadToPinata(image, pinataJwt);
  const ipfsNodeUrl = process.env.IPFS_NODE_URL?.trim();
  if (ipfsNodeUrl) return uploadToIpfsNode(image, ipfsNodeUrl);
  throw new Error("No IPFS backend configured (set PINATA_JWT or IPFS_NODE_URL)");
}

async function uploadToPinata(image: IpfsImage, jwt: string): Promise<string> {
  const form = new FormData();
  const bytes = new Uint8Array(image.data);
  form.append("file", new Blob([bytes], { type: image.mimeType }), image.fileName);
  const res = await fetch(PINATA_UPLOAD_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}` },
    body: form,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Pinata upload failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as { data?: { cid?: string }; cid?: string };
  const cid = json.data?.cid ?? json.cid;
  if (!cid) throw new Error("Pinata upload response did not contain a CID");
  return `ipfs://${cid}`;
}

async function uploadToIpfsNode(image: IpfsImage, nodeUrl: string): Promise<string> {
  const form = new FormData();
  const bytes = new Uint8Array(image.data);
  form.append("file", new Blob([bytes], { type: image.mimeType }), image.fileName);
  const url = `${nodeUrl.replace(/\/$/, "")}/api/v0/add?pin=true`;
  const res = await fetch(url, { method: "POST", body: form });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`IPFS node upload failed (${res.status}): ${text.slice(0, 200)}`);
  }
  // Kubo returns a single JSON object (Last-Chunk mode off) or NDJSON lines.
  const text = await res.text();
  const firstLine = text.split("\n")[0];
  const json = JSON.parse(firstLine) as { Hash?: string };
  if (!json.Hash) throw new Error("IPFS node upload response did not contain a Hash");
  return `ipfs://${json.Hash}`;
}
