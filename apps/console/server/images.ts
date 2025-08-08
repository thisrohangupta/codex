// Best-effort helper to resolve latest image tag for GHCR.
// Returns 'latest' if network or auth unavailable.
export async function getLatestTag(imageRepo: string): Promise<string> {
  try {
    // Placeholder: in a real deployment, query GHCR API with a PAT.
    // e.g., GET https://ghcr.io/v2/<owner>/<name>/tags/list
    // Here we fallback to 'latest'.
    return 'latest';
  } catch {
    return 'latest';
  }
}

