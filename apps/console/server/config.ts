export const config = {
  dryRun: process.env.DRY_RUN !== 'false',
  dockerBin: process.env.DOCKER_BIN || 'docker',
  helmBin: process.env.HELM_BIN || 'helm',
  registry: process.env.CONTAINER_REGISTRY || 'ghcr.io/your-org',
};

