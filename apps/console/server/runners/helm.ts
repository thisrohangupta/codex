export async function deployRelease(release: string, chartPath: string, values: Record<string, any>, log: (line: string) => void) {
  log(`helm upgrade --install ${release} ${chartPath} with values ${JSON.stringify(values)}`);
  await new Promise((r) => setTimeout(r, 500));
  log('Deployment complete (simulated).');
}

