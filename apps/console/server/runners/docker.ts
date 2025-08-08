export async function buildImage(contextPath: string, tag: string, log: (line: string) => void) {
  log(`docker build -t ${tag} ${contextPath}`);
  await new Promise((r) => setTimeout(r, 500));
  log('Build complete (simulated).');
}

