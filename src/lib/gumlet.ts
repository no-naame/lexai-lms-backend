const GUMLET_API_BASE = "https://api.gumlet.com/v1/video";

function getApiKey(): string {
  const key = process.env.GUMLET_API_KEY;
  if (!key) throw new Error("GUMLET_API_KEY is not set");
  return key;
}

function getWorkspaceId(): string {
  const id = process.env.GUMLET_WORKSPACE_ID;
  if (!id) throw new Error("GUMLET_WORKSPACE_ID is not set");
  return id;
}

async function gumletFetch(path: string, options: RequestInit = {}) {
  const res = await fetch(`${GUMLET_API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gumlet API error (${res.status}): ${body}`);
  }

  return res.json();
}

export interface CreateUploadUrlResponse {
  asset_id: string;
  upload_url: string;
}

export async function createUploadUrl(): Promise<CreateUploadUrlResponse> {
  return gumletFetch("/assets/upload", {
    method: "POST",
    body: JSON.stringify({
      source_id: getWorkspaceId(),
      format: "hls",
      resolution: ["240p", "480p", "720p", "1080p"],
    }),
  });
}

export interface GumletAssetStatus {
  asset_id: string;
  status: string;
  output?: {
    playback_url?: string;
    thumbnail?: string[];
    duration?: number;
  };
}

export async function getAssetStatus(assetId: string): Promise<GumletAssetStatus> {
  return gumletFetch(`/assets/${assetId}`);
}

export async function deleteAsset(assetId: string): Promise<void> {
  await gumletFetch(`/assets/${assetId}`, { method: "DELETE" });
}

export interface GumletListResponse {
  assets: GumletAssetStatus[];
  total: number;
}

export async function listAssets(page = 1, limit = 20): Promise<GumletListResponse> {
  return gumletFetch(`/assets?page=${page}&limit=${limit}&source_id=${getWorkspaceId()}`);
}
