import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

export type DeploymentEnvironment = 'dev' | 'prod';

export type DeploymentTargetType =
  | 'kubernetes'
  | 'helm'
  | 'aws-ecs'
  | 'aws-asg'
  | 'aws-lambda'
  | 'aws-cloudformation'
  | 'aws-codedeploy'
  | 'aws-ami'
  | 'aws-spot'
  | 'aks'
  | 'azure-web-app'
  | 'gke'
  | 'gcp-cloud-run'
  | 'ssh'
  | 'winrm'
  | 'serverless'
  | 'custom';

export interface DeploymentTarget {
  name: string;
  type: DeploymentTargetType;
  environments?: DeploymentEnvironment[];
  namespace?: string;
  manifestPath?: string;
  chartPath?: string;
  valuesFile?: string;
  releaseName?: string;
  cluster?: string;
  service?: string;
  region?: string;
  functionName?: string;
  stackName?: string;
  applicationName?: string;
  deploymentGroup?: string;
  autoScalingGroup?: string;
  launchTemplate?: string;
  resourceGroup?: string;
  appName?: string;
  project?: string;
  serviceName?: string;
  stage?: string;
  configPath?: string;
  host?: string;
  user?: string;
  destinationPath?: string;
  command?: string;
  validateCommand?: string;
  binaryPath?: string;
}

export interface TargetCommandInput {
  environment: DeploymentEnvironment;
  workspacePath: string;
  deploymentConfigPath?: string;
  binaryPath?: string;
  fallbackNamespace?: string;
  fallbackReleaseName?: string;
}

export interface TargetCommandSet {
  deployCommand: string;
  validateCommand?: string;
}

const TARGET_TYPES = new Set<DeploymentTargetType>([
  'kubernetes',
  'helm',
  'aws-ecs',
  'aws-asg',
  'aws-lambda',
  'aws-cloudformation',
  'aws-codedeploy',
  'aws-ami',
  'aws-spot',
  'aks',
  'azure-web-app',
  'gke',
  'gcp-cloud-run',
  'ssh',
  'winrm',
  'serverless',
  'custom',
]);

export function parseDeploymentTargets(raw: string | undefined): DeploymentTarget[] {
  if (!raw?.trim()) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`EXECUTOR_DEPLOYMENT_TARGETS_JSON is not valid JSON: ${formatError(error)}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error('EXECUTOR_DEPLOYMENT_TARGETS_JSON must be a JSON array');
  }

  return parsed.map((entry, index) => normalizeTarget(entry, index));
}

export function selectTargetsForEnvironment(
  targets: DeploymentTarget[],
  environment: DeploymentEnvironment,
): DeploymentTarget[] {
  return targets.filter((target) => {
    if (!target.environments || target.environments.length === 0) {
      return true;
    }
    return target.environments.includes(environment);
  });
}

export function inferDeploymentTargets(
  workspacePath: string,
  environment: DeploymentEnvironment,
): DeploymentTarget[] {
  const inferred: DeploymentTarget[] = [];
  const root = resolve(workspacePath);

  const hasRootChart = existsSync(join(root, 'Chart.yaml'));
  const hasHelmChart = existsSync(join(root, 'helm', 'Chart.yaml'));
  if (hasRootChart || hasHelmChart) {
    inferred.push({
      name: 'auto-helm',
      type: 'helm',
      chartPath: hasRootChart ? '.' : 'helm',
      valuesFile: hasHelmChart ? `helm/values.${environment}.yaml` : `values.${environment}.yaml`,
      releaseName: '${AGENT_REPO##*/}',
      environments: [environment],
    });
  }

  if (existsSync(join(root, 'k8s')) || existsSync(join(root, 'manifests'))) {
    inferred.push({
      name: 'auto-kubernetes',
      type: 'kubernetes',
      manifestPath: existsSync(join(root, 'k8s', 'overlays', environment))
        ? `k8s/overlays/${environment}`
        : existsSync(join(root, 'k8s'))
          ? 'k8s'
          : 'manifests',
      environments: [environment],
    });
  }

  if (existsSync(join(root, 'serverless.yml')) || existsSync(join(root, 'serverless.yaml'))) {
    inferred.push({
      name: 'auto-serverless',
      type: 'serverless',
      stage: environment,
      environments: [environment],
    });
  }

  if (existsSync(join(root, 'ecs-task-definition.json')) || existsSync(join(root, 'taskdef.json'))) {
    inferred.push({
      name: 'auto-aws-ecs',
      type: 'aws-ecs',
      cluster: '${ECS_CLUSTER}',
      service: '${ECS_SERVICE}',
      region: '${AWS_REGION:-us-east-1}',
      environments: [environment],
    });
  }

  if (
    existsSync(join(root, 'cloudformation.yml')) ||
    existsSync(join(root, 'cloudformation.yaml')) ||
    existsSync(join(root, 'template.yaml')) ||
    existsSync(join(root, 'template.yml'))
  ) {
    inferred.push({
      name: 'auto-aws-cloudformation',
      type: 'aws-cloudformation',
      stackName: '${CFN_STACK_NAME}',
      region: '${AWS_REGION:-us-east-1}',
      manifestPath: existsSync(join(root, 'cloudformation.yaml'))
        ? 'cloudformation.yaml'
        : existsSync(join(root, 'cloudformation.yml'))
          ? 'cloudformation.yml'
          : existsSync(join(root, 'template.yaml'))
            ? 'template.yaml'
            : 'template.yml',
      environments: [environment],
    });
  }

  return inferred;
}

export function createTargetCommands(
  target: DeploymentTarget,
  input: TargetCommandInput,
): TargetCommandSet {
  if (target.command) {
    return {
      deployCommand: target.command,
      validateCommand: target.validateCommand,
    };
  }

  const configRoot = resolve(input.deploymentConfigPath ?? input.workspacePath);
  const defaultNamespace =
    target.namespace ?? input.fallbackNamespace ?? (input.environment === 'prod' ? 'prod' : 'dev');
  const defaultRelease = target.releaseName ?? input.fallbackReleaseName ?? 'app';

  switch (target.type) {
    case 'kubernetes': {
      const manifestPath = resolveRelative(configRoot, target.manifestPath ?? `k8s/overlays/${input.environment}`);
      return {
        deployCommand: `kubectl apply -f ${q(manifestPath)} -n ${q(defaultNamespace)}`,
        validateCommand:
          target.validateCommand ??
          `kubectl rollout status deployment/\${K8S_DEPLOYMENT:-app} -n ${q(defaultNamespace)} --timeout=180s`,
      };
    }
    case 'helm': {
      const chartPath = resolveRelative(configRoot, target.chartPath ?? '.');
      const valuesPath = target.valuesFile ? resolveRelative(configRoot, target.valuesFile) : undefined;
      const valuesArg = valuesPath ? ` -f ${q(valuesPath)}` : '';
      return {
        deployCommand:
          `helm upgrade --install ${q(defaultRelease)} ${q(chartPath)} -n ${q(defaultNamespace)} --create-namespace` +
          valuesArg,
        validateCommand: target.validateCommand ?? `helm status ${q(defaultRelease)} -n ${q(defaultNamespace)}`,
      };
    }
    case 'aws-ecs': {
      const cluster = requireField(target.cluster, target.name, 'cluster');
      const service = requireField(target.service, target.name, 'service');
      const region = target.region ?? '${AWS_REGION:-us-east-1}';
      return {
        deployCommand:
          `aws ecs update-service --cluster ${q(cluster)} --service ${q(service)} --force-new-deployment --region ${q(region)}`,
        validateCommand:
          target.validateCommand ??
          `aws ecs describe-services --cluster ${q(cluster)} --services ${q(service)} --region ${q(region)}`,
      };
    }
    case 'aws-asg': {
      const group = requireField(target.autoScalingGroup, target.name, 'autoScalingGroup');
      const region = target.region ?? '${AWS_REGION:-us-east-1}';
      return {
        deployCommand:
          `aws autoscaling start-instance-refresh --auto-scaling-group-name ${q(group)} --region ${q(region)}`,
        validateCommand:
          target.validateCommand ??
          `aws autoscaling describe-instance-refreshes --auto-scaling-group-name ${q(group)} --region ${q(region)}`,
      };
    }
    case 'aws-lambda': {
      const functionName = requireField(target.functionName, target.name, 'functionName');
      const region = target.region ?? '${AWS_REGION:-us-east-1}';
      const binaryPath = resolveRelative(
        input.workspacePath,
        target.binaryPath ?? input.binaryPath ?? '${BINARY_PATH}',
      );
      return {
        deployCommand:
          `aws lambda update-function-code --function-name ${q(functionName)} --zip-file fileb://${q(binaryPath)} --region ${q(region)}`,
        validateCommand:
          target.validateCommand ??
          `aws lambda get-function --function-name ${q(functionName)} --region ${q(region)}`,
      };
    }
    case 'aws-cloudformation': {
      const stackName = requireField(target.stackName, target.name, 'stackName');
      const region = target.region ?? '${AWS_REGION:-us-east-1}';
      const templatePath = resolveRelative(
        configRoot,
        target.manifestPath ?? target.configPath ?? 'cloudformation.yaml',
      );
      return {
        deployCommand:
          `aws cloudformation deploy --stack-name ${q(stackName)} --template-file ${q(templatePath)} --capabilities CAPABILITY_NAMED_IAM --region ${q(region)}`,
        validateCommand:
          target.validateCommand ??
          `aws cloudformation describe-stacks --stack-name ${q(stackName)} --region ${q(region)}`,
      };
    }
    case 'aws-codedeploy': {
      const app = requireField(target.applicationName, target.name, 'applicationName');
      const group = requireField(target.deploymentGroup, target.name, 'deploymentGroup');
      const region = target.region ?? '${AWS_REGION:-us-east-1}';
      return {
        deployCommand:
          `aws deploy create-deployment --application-name ${q(app)} --deployment-group-name ${q(group)} --region ${q(region)}`,
        validateCommand:
          target.validateCommand ??
          `aws deploy list-deployments --application-name ${q(app)} --deployment-group-name ${q(group)} --region ${q(region)}`,
      };
    }
    case 'aws-ami': {
      const launchTemplate = requireField(target.launchTemplate, target.name, 'launchTemplate');
      const region = target.region ?? '${AWS_REGION:-us-east-1}';
      return {
        deployCommand:
          `aws ec2 create-launch-template-version --launch-template-name ${q(launchTemplate)} --source-version '$Latest' --version-description ${q('agent-${AGENT_RUN_ID}')} --region ${q(region)}`,
        validateCommand:
          target.validateCommand ??
          `aws ec2 describe-launch-template-versions --launch-template-name ${q(launchTemplate)} --region ${q(region)}`,
      };
    }
    case 'aws-spot': {
      const group = requireField(target.autoScalingGroup, target.name, 'autoScalingGroup');
      const region = target.region ?? '${AWS_REGION:-us-east-1}';
      return {
        deployCommand:
          `aws autoscaling update-auto-scaling-group --auto-scaling-group-name ${q(group)} --mixed-instances-policy file://${q(resolveRelative(configRoot, target.configPath ?? 'spot-policy.json'))} --region ${q(region)}`,
        validateCommand:
          target.validateCommand ??
          `aws autoscaling describe-auto-scaling-groups --auto-scaling-group-names ${q(group)} --region ${q(region)}`,
      };
    }
    case 'aks': {
      const cluster = requireField(target.cluster, target.name, 'cluster');
      const resourceGroup = requireField(target.resourceGroup, target.name, 'resourceGroup');
      const manifestPath = resolveRelative(configRoot, target.manifestPath ?? `k8s/overlays/${input.environment}`);
      return {
        deployCommand:
          `az aks get-credentials --resource-group ${q(resourceGroup)} --name ${q(cluster)} --overwrite-existing && kubectl apply -f ${q(manifestPath)} -n ${q(defaultNamespace)}`,
        validateCommand:
          target.validateCommand ??
          `kubectl rollout status deployment/\${K8S_DEPLOYMENT:-app} -n ${q(defaultNamespace)} --timeout=180s`,
      };
    }
    case 'azure-web-app': {
      const resourceGroup = requireField(target.resourceGroup, target.name, 'resourceGroup');
      const appName = requireField(target.appName, target.name, 'appName');
      const binaryPath = resolveRelative(
        input.workspacePath,
        target.binaryPath ?? input.binaryPath ?? '${BINARY_PATH}',
      );
      return {
        deployCommand:
          `az webapp deploy --resource-group ${q(resourceGroup)} --name ${q(appName)} --src-path ${q(binaryPath)}`,
        validateCommand:
          target.validateCommand ??
          `az webapp show --resource-group ${q(resourceGroup)} --name ${q(appName)} --query state -o tsv`,
      };
    }
    case 'gke': {
      const cluster = requireField(target.cluster, target.name, 'cluster');
      const region = target.region ?? '${GCP_REGION:-us-central1}';
      const project = requireField(target.project, target.name, 'project');
      const manifestPath = resolveRelative(configRoot, target.manifestPath ?? `k8s/overlays/${input.environment}`);
      return {
        deployCommand:
          `gcloud container clusters get-credentials ${q(cluster)} --region ${q(region)} --project ${q(project)} && kubectl apply -f ${q(manifestPath)} -n ${q(defaultNamespace)}`,
        validateCommand:
          target.validateCommand ??
          `kubectl rollout status deployment/\${K8S_DEPLOYMENT:-app} -n ${q(defaultNamespace)} --timeout=180s`,
      };
    }
    case 'gcp-cloud-run': {
      const service = requireField(target.serviceName, target.name, 'serviceName');
      const region = target.region ?? '${GCP_REGION:-us-central1}';
      const project = requireField(target.project, target.name, 'project');
      const sourcePath = resolveRelative(input.workspacePath, target.configPath ?? '.');
      return {
        deployCommand:
          `gcloud run deploy ${q(service)} --source ${q(sourcePath)} --region ${q(region)} --project ${q(project)} --quiet`,
        validateCommand:
          target.validateCommand ??
          `gcloud run services describe ${q(service)} --region ${q(region)} --project ${q(project)}`,
      };
    }
    case 'serverless': {
      const stage = target.stage ?? input.environment;
      const region = target.region ?? '${AWS_REGION:-us-east-1}';
      const configPath = target.configPath
        ? resolveRelative(configRoot, target.configPath)
        : existsSync(join(configRoot, 'serverless.yml'))
          ? join(configRoot, 'serverless.yml')
          : join(configRoot, 'serverless.yaml');
      return {
        deployCommand:
          `serverless deploy --stage ${q(stage)} --region ${q(region)} --config ${q(configPath)}`,
        validateCommand: target.validateCommand ?? `serverless info --stage ${q(stage)} --region ${q(region)}`,
      };
    }
    case 'ssh': {
      const host = requireField(target.host, target.name, 'host');
      const user = requireField(target.user, target.name, 'user');
      const scriptPath = resolveRelative(
        configRoot,
        target.configPath ?? target.manifestPath ?? 'scripts/deploy.sh',
      );
      return {
        deployCommand: `ssh ${q(`${user}@${host}`)} 'bash -s' < ${q(scriptPath)}`,
        validateCommand: target.validateCommand,
      };
    }
    case 'winrm': {
      const host = requireField(target.host, target.name, 'host');
      const scriptPath = resolveRelative(
        configRoot,
        target.configPath ?? target.manifestPath ?? 'scripts/deploy.ps1',
      );
      return {
        deployCommand:
          `pwsh -NoProfile -Command \"Invoke-Command -ComputerName ${escapePwsh(host)} -FilePath ${escapePwsh(scriptPath)}\"`,
        validateCommand: target.validateCommand,
      };
    }
    case 'custom': {
      throw new Error(`Deployment target "${target.name}" (custom) requires command`);
    }
    default: {
      return assertNever(target.type);
    }
  }
}

function normalizeTarget(value: unknown, index: number): DeploymentTarget {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Target at index ${index} must be an object`);
  }

  const entry = value as Record<string, unknown>;
  const type = asString(entry.type);
  if (!type || !TARGET_TYPES.has(type as DeploymentTargetType)) {
    throw new Error(`Target at index ${index} has unsupported type: ${String(entry.type)}`);
  }

  const environments = toEnvironments(entry.environments, index);

  return {
    name: asString(entry.name) ?? `target-${index + 1}`,
    type: type as DeploymentTargetType,
    environments,
    namespace: asString(entry.namespace),
    manifestPath: asString(entry.manifestPath),
    chartPath: asString(entry.chartPath),
    valuesFile: asString(entry.valuesFile),
    releaseName: asString(entry.releaseName),
    cluster: asString(entry.cluster),
    service: asString(entry.service),
    region: asString(entry.region),
    functionName: asString(entry.functionName),
    stackName: asString(entry.stackName),
    applicationName: asString(entry.applicationName),
    deploymentGroup: asString(entry.deploymentGroup),
    autoScalingGroup: asString(entry.autoScalingGroup),
    launchTemplate: asString(entry.launchTemplate),
    resourceGroup: asString(entry.resourceGroup),
    appName: asString(entry.appName),
    project: asString(entry.project),
    serviceName: asString(entry.serviceName),
    stage: asString(entry.stage),
    configPath: asString(entry.configPath),
    host: asString(entry.host),
    user: asString(entry.user),
    destinationPath: asString(entry.destinationPath),
    command: asString(entry.command),
    validateCommand: asString(entry.validateCommand),
    binaryPath: asString(entry.binaryPath),
  };
}

function toEnvironments(value: unknown, index: number): DeploymentEnvironment[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new Error(`Target at index ${index} has invalid environments (expected array)`);
  }

  const envs = value
    .map((entry) => asString(entry))
    .filter((entry): entry is string => Boolean(entry))
    .map((entry) => entry.toLowerCase());

  for (const env of envs) {
    if (env !== 'dev' && env !== 'prod') {
      throw new Error(`Target at index ${index} has unsupported environment: ${env}`);
    }
  }

  return envs as DeploymentEnvironment[];
}

function asString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function requireField(value: string | undefined, targetName: string, field: string): string {
  if (!value) {
    throw new Error(`Deployment target "${targetName}" is missing required field: ${field}`);
  }
  return value;
}

function resolveRelative(basePath: string, candidate: string): string {
  if (candidate.startsWith('/')) {
    return candidate;
  }
  if (candidate.startsWith('${')) {
    return candidate;
  }
  return resolve(basePath, candidate);
}

function q(value: string): string {
  if (/\$\{[^}]+\}/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function escapePwsh(value: string): string {
  return value.replace(/'/g, "''");
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

function assertNever(value: never): never {
  throw new Error(`Unsupported deployment target type: ${String(value)}`);
}
