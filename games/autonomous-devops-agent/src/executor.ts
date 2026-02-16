import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  createTargetCommands,
  inferDeploymentTargets,
  selectTargetsForEnvironment,
  type DeploymentEnvironment,
  type DeploymentTarget,
} from './deployment-targets.js';
import type {
  AgentContext,
  DeliveryExecutor,
  ProbeSource,
  TargetProbeEntry,
  TargetProbeEnvironment,
  TargetProbeResult,
} from './types.js';

const execFileAsync = promisify(execFile);

export interface ShellDeliveryExecutorConfig {
  workdir: string;
  buildCommand: string;
  testCommand: string;
  deployDevCommand: string;
  deployProdCommand: string;
  validateDevCommand: string;
  validateProdCommand: string;
  cloneSourceEnabled: boolean;
  sourceRoot: string;
  sourceRepoUrl?: string;
  sourceRepoRef?: string;
  sourceRepoToken?: string;
  cloneDeploymentConfigEnabled: boolean;
  deploymentConfigRepoUrl?: string;
  deploymentConfigRepoRef?: string;
  deploymentConfigPath: string;
  binaryDownloadUrl?: string;
  binaryDownloadCommand?: string;
  binarySha256?: string;
  deploymentTargets: DeploymentTarget[];
  autoDetectTargets: boolean;
  preflightEnabled: boolean;
  preflightAuthChecks: boolean;
  shell?: string;
}

interface ResolvedTargetsForEnvironment {
  source: ProbeSource;
  targets: DeploymentTarget[];
}

interface PreflightCheck {
  id: string;
  description: string;
  command: string;
  hint: string;
}

/**
 * Executes real build/test/deploy/validate commands in a local repository.
 */
export class ShellDeliveryExecutor implements DeliveryExecutor {
  private readonly shell: string;

  constructor(private readonly config: ShellDeliveryExecutorConfig) {
    this.shell = config.shell ?? process.env.SHELL ?? '/bin/zsh';
  }

  async prepareWorkspace(context: AgentContext): Promise<string> {
    let workspacePath = resolve(this.config.workdir);
    let deploymentConfigPath = resolve(workspacePath, this.config.deploymentConfigPath);
    let runRoot = resolve(this.config.sourceRoot, sanitizePathSegment(context.runId));
    let binaryPath: string | undefined;

    if (!this.config.cloneSourceEnabled) {
      runRoot = workspacePath;
    } else {
      const sourceRepoUrl = this.resolveSourceRepoUrl(context);
      const sourcePath = join(runRoot, 'source');
      await rm(sourcePath, { recursive: true, force: true });
      await mkdir(runRoot, { recursive: true });
      await this.cloneRepository(
        sourceRepoUrl,
        sourcePath,
        this.config.sourceRepoRef ?? context.workItem.branch,
        this.config.sourceRepoToken,
      );
      workspacePath = sourcePath;
      deploymentConfigPath = resolve(workspacePath, this.config.deploymentConfigPath);
    }

    if (this.config.cloneDeploymentConfigEnabled) {
      const configRepoUrl = this.config.deploymentConfigRepoUrl;
      if (!configRepoUrl) {
        throw new Error(
          'cloneDeploymentConfigEnabled=true requires EXECUTOR_DEPLOY_CONFIG_REPO_URL',
        );
      }

      const configPath = join(runRoot, 'deploy-config');
      await rm(configPath, { recursive: true, force: true });
      await mkdir(runRoot, { recursive: true });
      await this.cloneRepository(
        configRepoUrl,
        configPath,
        this.config.deploymentConfigRepoRef,
        this.config.sourceRepoToken,
      );
      deploymentConfigPath = resolve(configPath, this.config.deploymentConfigPath);
    }

    if (this.config.binaryDownloadCommand || this.config.binaryDownloadUrl) {
      const binaryRoot = join(runRoot, 'binaries');
      await mkdir(binaryRoot, { recursive: true });

      const binaryName = this.resolveBinaryName();
      binaryPath = join(binaryRoot, binaryName);

      if (this.config.binaryDownloadCommand) {
        await this.runShell(
          this.config.binaryDownloadCommand,
          workspacePath,
          {
            BINARY_OUTPUT_PATH: binaryPath,
          },
        );
      } else if (this.config.binaryDownloadUrl) {
        const resolvedUrl = interpolateTemplate(this.config.binaryDownloadUrl, context);
        const response = await fetch(resolvedUrl);
        if (!response.ok) {
          throw new Error(`Binary download failed (${response.status} ${response.statusText})`);
        }

        const bytes = Buffer.from(await response.arrayBuffer());
        await writeFile(binaryPath, bytes);
      }

      if (this.config.binarySha256) {
        const digest = await sha256File(binaryPath);
        if (digest !== this.config.binarySha256.toLowerCase()) {
          throw new Error(
            `Binary SHA mismatch. expected=${this.config.binarySha256.toLowerCase()} actual=${digest}`,
          );
        }
      }
    }

    context.workspacePath = workspacePath;
    context.deploymentConfigPath = deploymentConfigPath;
    context.binaryPath = binaryPath;

    const devTargets = this.resolveTargetsWithSource('dev', context);
    const prodTargets = this.resolveTargetsWithSource('prod', context);

    if (this.config.preflightEnabled) {
      const allTargets = [...devTargets.targets, ...prodTargets.targets];
      context.preflightReport = await this.runPreflightChecks(allTargets);
    }

    context.deploymentTargetReport =
      `dev=[${summarizeTargetNames(devTargets.targets).join(', ') || 'legacy-command'}:${devTargets.source}] ` +
      `prod=[${summarizeTargetNames(prodTargets.targets).join(', ') || 'legacy-command'}:${prodTargets.source}]`;

    return [
      `workspace=${workspacePath}`,
      `deployConfig=${deploymentConfigPath}`,
      `binary=${binaryPath ?? 'none'}`,
      `targets.dev=${summarizeTargetNames(devTargets.targets).join(', ') || 'legacy-command'} (${devTargets.source})`,
      `targets.prod=${summarizeTargetNames(prodTargets.targets).join(', ') || 'legacy-command'} (${prodTargets.source})`,
      `preflight=${context.preflightReport ?? 'skipped'}`,
    ].join('\n');
  }

  async probeTargets(context: AgentContext): Promise<TargetProbeResult> {
    if (!context.workspacePath || !context.deploymentConfigPath) {
      context.workspacePreparationReport = await this.prepareWorkspace(context);
    }

    const devResolved = this.resolveTargetsWithSource('dev', context);
    const prodResolved = this.resolveTargetsWithSource('prod', context);

    const environments: TargetProbeEnvironment[] = [
      this.toProbeEnvironment('dev', devResolved, context),
      this.toProbeEnvironment('prod', prodResolved, context),
    ];

    return {
      runId: context.runId,
      workItem: context.workItem,
      workspacePath: context.workspacePath,
      deploymentConfigPath: context.deploymentConfigPath,
      binaryPath: context.binaryPath,
      workspacePreparationReport: context.workspacePreparationReport,
      preflightReport: context.preflightReport,
      environments,
    };
  }

  async runBuild(context: AgentContext): Promise<string> {
    return this.runCommand(this.config.buildCommand, context, 'build');
  }

  async runTests(context: AgentContext): Promise<string> {
    return this.runCommand(this.config.testCommand, context, 'test');
  }

  async deployToCluster(environment: 'dev' | 'prod', context: AgentContext): Promise<string> {
    const targets = this.resolveTargetsWithSource(environment, context).targets;
    if (targets.length === 0) {
      const command = environment === 'dev'
        ? this.config.deployDevCommand
        : this.config.deployProdCommand;
      return this.runCommand(command, context, `deploy-${environment}`);
    }

    const outputs: string[] = [];
    for (const target of targets) {
      const commands = createTargetCommands(target, this.createTargetCommandInput(environment, context));
      const output = await this.runCommand(
        commands.deployCommand,
        context,
        `deploy-${environment}:${target.name}`,
      );
      outputs.push(`[${target.name}] ${output}`);
    }

    return truncateOutput(outputs.join('\n'));
  }

  async validateCluster(environment: 'dev' | 'prod', context: AgentContext): Promise<string> {
    const targets = this.resolveTargetsWithSource(environment, context).targets;
    if (targets.length === 0) {
      const command = environment === 'dev'
        ? this.config.validateDevCommand
        : this.config.validateProdCommand;
      return this.runCommand(command, context, `validate-${environment}`);
    }

    const outputs: string[] = [];
    for (const target of targets) {
      const commands = createTargetCommands(target, this.createTargetCommandInput(environment, context));
      const validateCommand = commands.validateCommand ??
        (environment === 'dev' ? this.config.validateDevCommand : this.config.validateProdCommand);
      const output = await this.runCommand(
        validateCommand,
        context,
        `validate-${environment}:${target.name}`,
      );
      outputs.push(`[${target.name}] ${output}`);
    }

    return truncateOutput(outputs.join('\n'));
  }

  private createTargetCommandInput(
    environment: DeploymentEnvironment,
    context: AgentContext,
  ): Parameters<typeof createTargetCommands>[1] {
    return {
      environment,
      workspacePath: context.workspacePath ?? resolve(this.config.workdir),
      deploymentConfigPath: context.deploymentConfigPath,
      binaryPath: context.binaryPath,
      fallbackNamespace:
        environment === 'dev'
          ? process.env.K8S_DEV_NAMESPACE ?? 'dev'
          : process.env.K8S_PROD_NAMESPACE ?? 'prod',
      fallbackReleaseName: context.workItem.repo.split('/').pop() ?? 'app',
    };
  }

  private resolveTargetsWithSource(
    environment: DeploymentEnvironment,
    context: AgentContext,
  ): ResolvedTargetsForEnvironment {
    const configured = selectTargetsForEnvironment(this.config.deploymentTargets, environment);
    if (configured.length > 0) {
      return { source: 'configured', targets: configured };
    }

    if (!this.config.autoDetectTargets) {
      return { source: 'legacy', targets: [] };
    }

    const discoveryRoot = context.deploymentConfigPath ?? context.workspacePath ?? this.config.workdir;
    const inferred = inferDeploymentTargets(discoveryRoot, environment);
    if (inferred.length > 0) {
      return { source: 'inferred', targets: inferred };
    }

    return { source: 'legacy', targets: [] };
  }

  private toProbeEnvironment(
    environment: DeploymentEnvironment,
    resolved: ResolvedTargetsForEnvironment,
    context: AgentContext,
  ): TargetProbeEnvironment {
    if (resolved.targets.length === 0) {
      return {
        environment,
        source: resolved.source,
        targets: [
          {
            name: `legacy-${environment}`,
            type: 'legacy',
            source: 'legacy',
            deployCommand: environment === 'dev'
              ? this.config.deployDevCommand
              : this.config.deployProdCommand,
            validateCommand: environment === 'dev'
              ? this.config.validateDevCommand
              : this.config.validateProdCommand,
          },
        ],
      };
    }

    const targets: TargetProbeEntry[] = resolved.targets.map((target) => {
      const commands = createTargetCommands(target, this.createTargetCommandInput(environment, context));
      return {
        name: target.name,
        type: target.type,
        source: resolved.source,
        deployCommand: commands.deployCommand,
        validateCommand: commands.validateCommand,
      };
    });

    return {
      environment,
      source: resolved.source,
      targets,
    };
  }

  private async runPreflightChecks(targets: DeploymentTarget[]): Promise<string> {
    const checks = this.collectPreflightChecks(targets);
    if (checks.length === 0) {
      return 'skipped (no target-specific checks required)';
    }

    const passed: string[] = [];
    for (const check of checks) {
      try {
        await this.runShell(check.command, this.config.workdir);
        passed.push(check.id);
      } catch (error) {
        throw new Error(
          `Preflight check failed [${check.id}] ${check.description}. ${check.hint}. ` +
          `Command="${check.command}". Details=${formatCommandError(error)}`,
        );
      }
    }

    return `passed (${passed.length}): ${passed.join(', ')}`;
  }

  private collectPreflightChecks(targets: DeploymentTarget[]): PreflightCheck[] {
    const checks = new Map<string, PreflightCheck>();

    const add = (check: PreflightCheck): void => {
      if (!checks.has(check.id)) {
        checks.set(check.id, check);
      }
    };

    if (this.config.cloneSourceEnabled || this.config.cloneDeploymentConfigEnabled) {
      add({
        id: 'git-cli',
        description: 'git CLI availability',
        command: 'command -v git >/dev/null 2>&1',
        hint: 'Install git and ensure it is on PATH.',
      });
    }

    const hasAws = targets.some((target) =>
      target.type.startsWith('aws-'),
    );
    const hasAzure = targets.some((target) =>
      target.type === 'aks' || target.type === 'azure-web-app',
    );
    const hasGcp = targets.some((target) =>
      target.type === 'gke' || target.type === 'gcp-cloud-run',
    );
    const hasKubectl = targets.some((target) =>
      target.type === 'kubernetes' || target.type === 'helm' || target.type === 'aks' || target.type === 'gke',
    );
    const hasHelm = targets.some((target) => target.type === 'helm');
    const hasServerless = targets.some((target) => target.type === 'serverless');
    const hasSsh = targets.some((target) => target.type === 'ssh');
    const hasWinrm = targets.some((target) => target.type === 'winrm');

    if (hasAws) {
      add({
        id: 'aws-cli',
        description: 'AWS CLI availability',
        command: 'command -v aws >/dev/null 2>&1',
        hint: 'Install AWS CLI v2 and ensure it is on PATH.',
      });
    }

    if (hasAzure) {
      add({
        id: 'az-cli',
        description: 'Azure CLI availability',
        command: 'command -v az >/dev/null 2>&1',
        hint: 'Install Azure CLI and ensure it is on PATH.',
      });
    }

    if (hasGcp) {
      add({
        id: 'gcloud-cli',
        description: 'gcloud CLI availability',
        command: 'command -v gcloud >/dev/null 2>&1',
        hint: 'Install gcloud SDK and ensure it is on PATH.',
      });
    }

    if (hasKubectl) {
      add({
        id: 'kubectl-cli',
        description: 'kubectl CLI availability',
        command: 'command -v kubectl >/dev/null 2>&1',
        hint: 'Install kubectl and ensure it is on PATH.',
      });
    }

    if (hasHelm) {
      add({
        id: 'helm-cli',
        description: 'helm CLI availability',
        command: 'command -v helm >/dev/null 2>&1',
        hint: 'Install Helm and ensure it is on PATH.',
      });
    }

    if (hasServerless) {
      add({
        id: 'serverless-cli',
        description: 'serverless CLI availability',
        command: 'command -v serverless >/dev/null 2>&1',
        hint: 'Install Serverless Framework CLI and ensure it is on PATH.',
      });
    }

    if (hasSsh) {
      add({
        id: 'ssh-cli',
        description: 'ssh CLI availability',
        command: 'command -v ssh >/dev/null 2>&1',
        hint: 'Install OpenSSH client and ensure it is on PATH.',
      });
    }

    if (hasWinrm) {
      add({
        id: 'pwsh-cli',
        description: 'PowerShell availability for WinRM deployment',
        command: 'command -v pwsh >/dev/null 2>&1',
        hint: 'Install PowerShell (pwsh) and ensure it is on PATH.',
      });
    }

    if (!this.config.preflightAuthChecks) {
      return [...checks.values()];
    }

    if (hasAws) {
      add({
        id: 'aws-auth',
        description: 'AWS credential/auth validation',
        command: 'aws sts get-caller-identity --output json >/dev/null',
        hint: 'Configure AWS credentials (env vars, profile, or assumed role).',
      });
    }

    if (hasAzure) {
      add({
        id: 'az-auth',
        description: 'Azure credential/auth validation',
        command: 'az account show -o none',
        hint: 'Login with Azure CLI (az login) or configure workload identity.',
      });
    }

    if (hasGcp) {
      add({
        id: 'gcloud-auth',
        description: 'GCP credential/auth validation',
        command: "gcloud auth list --filter=status:ACTIVE --format='value(account)' | grep -q .",
        hint: 'Authenticate with gcloud (gcloud auth login / service account).',
      });
    }

    if (hasKubectl) {
      add({
        id: 'kubectl-context',
        description: 'Kubernetes context validation',
        command: 'kubectl config current-context >/dev/null',
        hint: 'Configure kubeconfig and set an active context for deployment.',
      });
    }

    return [...checks.values()];
  }

  private resolveSourceRepoUrl(context: AgentContext): string {
    if (this.config.sourceRepoUrl) {
      return interpolateTemplate(this.config.sourceRepoUrl, context);
    }

    if (/^https?:\/\//.test(context.workItem.repo)) {
      return context.workItem.repo;
    }

    return `https://github.com/${context.workItem.repo}.git`;
  }

  private resolveBinaryName(): string {
    if (this.config.binaryDownloadUrl) {
      const url = this.config.binaryDownloadUrl.split('?')[0];
      const candidate = basename(url);
      if (candidate && candidate !== '/' && candidate !== '.') {
        return candidate;
      }
    }
    return 'artifact.bin';
  }

  private async cloneRepository(
    sourceRepoUrl: string,
    destinationPath: string,
    ref: string | undefined,
    token: string | undefined,
  ): Promise<void> {
    const cloneUrl = injectTokenIntoHttpsUrl(sourceRepoUrl, token);
    const refArg = ref ? ` --branch ${shellQuote(ref)}` : '';
    const command = `git clone --depth 1${refArg} ${shellQuote(cloneUrl)} ${shellQuote(destinationPath)}`;
    await this.runShell(command, undefined, { GIT_TERMINAL_PROMPT: '0' });
  }

  private async runShell(
    command: string,
    cwd?: string,
    extraEnv?: Record<string, string | undefined>,
  ): Promise<string> {
    const { stdout, stderr } = await execFileAsync(this.shell, ['-lc', command], {
      cwd: cwd ? resolve(cwd) : undefined,
      env: {
        ...process.env,
        ...(extraEnv ?? {}),
      },
      maxBuffer: 1024 * 1024 * 10,
    });

    return [stdout, stderr].filter(Boolean).join('\n').trim();
  }

  private async runCommand(command: string, context: AgentContext, stage: string): Promise<string> {
    const { stdout, stderr } = await execFileAsync(this.shell, ['-lc', command], {
      cwd: context.workspacePath ?? this.config.workdir,
      env: {
        ...process.env,
        AGENT_RUN_ID: context.runId,
        AGENT_WORK_ITEM_ID: context.workItem.id,
        AGENT_WORK_ITEM_KIND: context.workItem.kind,
        AGENT_REPO: context.workItem.repo,
        AGENT_BRANCH: context.workItem.branch,
        AGENT_STAGE: stage,
        AGENT_WORKSPACE_PATH: context.workspacePath,
        AGENT_DEPLOY_CONFIG_PATH: context.deploymentConfigPath,
        BINARY_PATH: context.binaryPath,
      },
      maxBuffer: 1024 * 1024 * 10,
    });

    const combined = [stdout, stderr].filter(Boolean).join('\n').trim();
    return truncateOutput(combined || `${stage} command completed`);
  }
}

export class InMemoryDeliveryExecutor implements DeliveryExecutor {
  async prepareWorkspace(context: AgentContext): Promise<string> {
    context.workspacePath = process.cwd();
    context.deploymentConfigPath = process.cwd();
    return `workspace=${context.workspacePath}\ndeployConfig=${context.deploymentConfigPath}\n(binary skipped)`;
  }

  async probeTargets(context: AgentContext): Promise<TargetProbeResult> {
    return {
      runId: context.runId,
      workItem: context.workItem,
      workspacePath: context.workspacePath ?? process.cwd(),
      deploymentConfigPath: context.deploymentConfigPath ?? process.cwd(),
      environments: [
        {
          environment: 'dev',
          source: 'legacy',
          targets: [
            {
              name: 'in-memory-dev',
              type: 'in-memory',
              source: 'legacy',
              deployCommand: 'echo in-memory deploy dev',
              validateCommand: 'echo in-memory validate dev',
            },
          ],
        },
        {
          environment: 'prod',
          source: 'legacy',
          targets: [
            {
              name: 'in-memory-prod',
              type: 'in-memory',
              source: 'legacy',
              deployCommand: 'echo in-memory deploy prod',
              validateCommand: 'echo in-memory validate prod',
            },
          ],
        },
      ],
    };
  }

  async runBuild(context: AgentContext): Promise<string> {
    return `build skipped for ${context.workItem.id} (in-memory executor)`;
  }

  async runTests(context: AgentContext): Promise<string> {
    return `test skipped for ${context.workItem.id} (in-memory executor)`;
  }

  async deployToCluster(environment: 'dev' | 'prod', context: AgentContext): Promise<string> {
    return `deploy ${environment} skipped for ${context.workItem.id} (in-memory executor)`;
  }

  async validateCluster(environment: 'dev' | 'prod', context: AgentContext): Promise<string> {
    return `validate ${environment} skipped for ${context.workItem.id} (in-memory executor)`;
  }
}

function truncateOutput(value: string): string {
  const max = 2400;
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max)}\n...[truncated]`;
}

function summarizeTargetNames(targets: DeploymentTarget[]): string[] {
  return targets.map((target) => `${target.name}:${target.type}`);
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '-');
}

function interpolateTemplate(value: string, context: AgentContext): string {
  return value
    .replace(/\$\{AGENT_REPO\}/g, context.workItem.repo)
    .replace(/\$\{AGENT_BRANCH\}/g, context.workItem.branch)
    .replace(/\$\{AGENT_RUN_ID\}/g, context.runId)
    .replace(/\$\{AGENT_WORK_ITEM_ID\}/g, context.workItem.id)
    .replace(/\$\{AGENT_WORK_ITEM_KIND\}/g, context.workItem.kind);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function injectTokenIntoHttpsUrl(url: string, token: string | undefined): string {
  if (!token || !url.startsWith('https://')) {
    return url;
  }

  const parsed = new URL(url);
  if (parsed.username || parsed.password) {
    return url;
  }

  parsed.username = 'x-access-token';
  parsed.password = token;
  return parsed.toString();
}

async function sha256File(path: string): Promise<string> {
  const bytes = await readFile(path);
  return createHash('sha256').update(bytes).digest('hex');
}

function formatCommandError(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return 'unknown command error';
  }

  const entry = error as {
    message?: string;
    stdout?: string;
    stderr?: string;
  };

  const details = [entry.message, entry.stderr, entry.stdout]
    .filter((value): value is string => Boolean(value && value.trim()))
    .join(' | ')
    .trim();

  return details || 'unknown command error';
}
