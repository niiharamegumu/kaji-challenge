// Verify the Worker that will serve requests after retired tables are dropped.
export async function verifyCutoverRelease(env, request = fetch) {
  const hostname = new URL(env.APP_ORIGIN).hostname;
  const response = await request(new URL("/health", env.APP_ORIGIN), {
    redirect: "error",
    signal: AbortSignal.timeout(5000),
  });
  if (response.ok) {
    const health = await response.json();
    return health.status === "ok" && health.release === env.APP_RELEASE;
  }
  if (response.status !== 403) return false;

  // The public domain can deny the hosted runner. Check the domain's live
  // deployment using the authenticated Cloudflare API before allowing cleanup.
  async function readCloudflare(path) {
    const response = await request(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/workers/${path}`,
      {
        headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` },
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!response.ok) throw new Error(`Cloudflare release check returned HTTP ${response.status}`);
    const { success, result } = await response.json();
    if (!success) throw new Error("Cloudflare release check failed");
    return result;
  }
  const domains = await readCloudflare(`domains?hostname=${encodeURIComponent(hostname)}`);
  const domain = domains.find((item) => item.hostname === hostname && item.enabled && item.service);
  if (!domain) return false;
  const script = `scripts/${encodeURIComponent(domain.service)}`;
  const { deployments } = await readCloudflare(`${script}/deployments`);
  const versions = deployments[0]?.versions;
  if (versions?.length !== 1 || versions[0].percentage !== 100 || !versions[0].version_id)
    return false;
  const version = await readCloudflare(
    `${script}/versions/${encodeURIComponent(versions[0].version_id)}`,
  );
  return version.resources.bindings.some(
    (binding) =>
      binding.name === "APP_RELEASE" &&
      binding.type === "plain_text" &&
      binding.text === env.APP_RELEASE,
  );
}

if (import.meta.main && !(await verifyCutoverRelease(process.env))) process.exitCode = 1;
