import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AgentContext, DeliveryExecutor } from './types.js';

const execFileAsync = promisify(execFile);

export interface ShellDeliveryExecutorConfig {
  workdir: string;
  buildCommand: string;
  testCommand: string;
  deployDevCommand: string;
  deployProdCommand: string;
  validateDevCommand: string;
  validateProdCommand: string;
  shell?: string;
}

/**
 * Executes real build/test/deploy/validate commands in a local repository.
 */
export class ShellDeliveryExecutor implements DeliveryExecutor {
  private readonly shell: string;

  constructor(private readonly config: ShellDeliveryExecutorConfig) {
    this.shell = config.shell ?? process.env.SHELL ?? '/bin/zsh';
  }

  async runBuild(context: AgentContext): Promise<string> {
    return this.runCommand(this.config.buildCommand, context, 'build');
  }

  async runTests(context: AgentContext): Promise<string> {
    return this.runCommand(this.config.testCommand, context, 'test');
  }

  async deployToCluster(environment: 'dev' | 'prod', context: AgentContext): Promise<string> {
    const command = environment === 'dev' ? this.config.deployDevCommand : this.config.deployProdCommand;
    return this.runCommand(command, context, `deploy-${environment}`);
  }

  async validateCluster(environment: 'dev' | 'prod', context: AgentContext): Promise<string> {
    const command = environment === 'dev'
      ? this.config.validateDevCommand
      : this.config.validateProdCommand;
    return this.runCommand(command, context, `validate-${environment}`);
  }

  private async runCommand(command: string, context: AgentContext, stage: string): Promise<string> {
    const { stdout, stderr } = await execFileAsync(this.shell, ['-lc', command], {
      cwd: this.config.workdir,
      env: {
        ...process.env,
        AGENT_RUN_ID: context.runId,
        AGENT_WORK_ITEM_ID: context.workItem.id,
        AGENT_WORK_ITEM_KIND: context.workItem.kind,
        AGENT_REPO: context.workItem.repo,
        AGENT_BRANCH: context.workItem.branch,
        AGENT_STAGE: stage,
      },
      maxBuffer: 1024 * 1024 * 10,
    });

    const combined = [stdout, stderr].filter(Boolean).join('\n').trim();
    return truncateOutput(combined || `${stage} command completed`);
  }
}

export class InMemoryDeliveryExecutor implements DeliveryExecutor {
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
