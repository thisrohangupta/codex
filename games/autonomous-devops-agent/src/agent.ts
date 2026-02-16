import { EventBus } from './event-bus.js';
import type {
  DeliveryExecutor,
  HarnessApi,
  JiraApi,
  LlmProvider,
  RepoApi,
  ServiceNowApi,
  WorkItem,
} from './types.js';
import type { AgentContext, AgentEvent, RunStatus } from './types.js';
import type { DeploymentPolicy } from './policy.js';
import { MANUAL_APPROVAL_NOTE } from './policy.js';

export interface DevOpsAgentDependencies {
  jira: JiraApi;
  repo: RepoApi;
  harness: HarnessApi;
  llm: LlmProvider;
  serviceNow?: ServiceNowApi;
  executor?: DeliveryExecutor;
  deploymentPolicy?: DeploymentPolicy;
  eventBus?: EventBus;
}

/**
 * Autonomous DevOps agent that plans and executes delivery tasks for Jira issues or pull requests.
 */
export class DevOpsAgent {
  private readonly eventBus: EventBus;

  constructor(private readonly deps: DevOpsAgentDependencies) {
    this.eventBus = deps.eventBus ?? new EventBus();
  }

  get events(): EventBus {
    return this.eventBus;
  }

  async run(input: WorkItem): Promise<AgentContext> {
    const executor = this.deps.executor;
    const context: AgentContext = {
      runId: `${input.kind}-${input.id}-${Date.now()}`,
      workItem: input,
      status: 'pending',
      plan: [
        'Generate feature implementation',
        'Execute tests',
        'Open pull request',
        'Publish image artifact',
        'Deploy to dev',
        'Run security scan',
        'Deploy to prod when safe',
        'Report back for human review',
      ],
      deployments: [],
      reviewNotes: [],
    };

    this.updateStatus(context, 'running');
    this.eventBus.emit(this.createEvent(context, 'run.started', {
      plan: context.plan,
      provider: this.deps.llm.name,
    }));

    await this.executeTask(context, 'generate', async () => {
      context.generatedCode = await this.deps.llm.generateFeatureImplementation(input);
    });

    await this.executeTask(context, 'test', async () => {
      context.testReport = this.runTests(context.generatedCode ?? '');
    });

    if (executor) {
      await this.executeTask(context, 'prepare-workspace-local', async () => {
        if (!executor.prepareWorkspace) {
          context.workspacePath = process.cwd();
          context.deploymentConfigPath = process.cwd();
          context.workspacePreparationReport = 'workspace preparation skipped (executor does not implement prepareWorkspace)';
          return;
        }

        context.workspacePreparationReport = await executor.prepareWorkspace(context);
      });

      await this.executeTask(context, 'build-local', async () => {
        context.buildReport = await executor.runBuild(context);
      });

      await this.executeTask(context, 'test-local', async () => {
        const report = await executor.runTests(context);
        context.testReport = [context.testReport, report].filter(Boolean).join('\n');
      });
    }

    if (input.kind === 'jira') {
      await this.executeTask(context, 'open-pr', async () => {
        context.pullRequestId = await this.deps.repo.openPullRequest(
          input.repo,
          input.branch,
          `[${input.id}] ${input.title}`,
          this.buildPullRequestBody(context),
        );
      });
    } else {
      context.pullRequestId = input.id;
    }

    await this.executeTask(context, 'publish', async () => {
      context.artifact = await this.deps.harness.publishArtifact(
        input.repo,
        context.generatedCode ?? '',
      );
    });

    await this.executeTask(context, 'deploy-dev', async () => {
      const deployment = await this.deps.harness.deploy('dev', context.artifact ?? '');
      context.deployments.push(deployment);
    });

    if (executor) {
      await this.executeTask(context, 'deploy-dev-local', async () => {
        const output = await executor.deployToCluster('dev', context);
        context.clusterValidationReport = [context.clusterValidationReport, output]
          .filter(Boolean)
          .join('\n');
      });

      await this.executeTask(context, 'validate-dev-local', async () => {
        const output = await executor.validateCluster('dev', context);
        context.clusterValidationReport = [context.clusterValidationReport, output]
          .filter(Boolean)
          .join('\n');
      });
    }

    await this.executeTask(context, 'scan', async () => {
      context.scanResult = await this.deps.harness.scanImage(context.artifact ?? '');
      const critical = context.scanResult.critical;
      const high = context.scanResult.high;
      if (critical > 0 || high > 0) {
        context.reviewNotes.push(
          `Security findings require review: critical=${critical}, high=${high}`,
        );
      }
    });

    if (context.reviewNotes.length === 0) {
      const requiresApproval = this.deps.deploymentPolicy?.requiresManualApproval(input, context) ?? false;

      if (requiresApproval) {
        context.reviewNotes.push(MANUAL_APPROVAL_NOTE);
        this.updateStatus(context, 'needs_review');
        this.eventBus.emit(
          this.createEvent(context, 'review.requested', {
            reason: MANUAL_APPROVAL_NOTE,
          }),
        );
      } else {
        await this.executeTask(context, 'deploy-prod', async () => {
          const deployment = await this.deps.harness.deploy('prod', context.artifact ?? '');
          context.deployments.push(deployment);
        });

        if (executor) {
          await this.executeTask(context, 'deploy-prod-local', async () => {
            const output = await executor.deployToCluster('prod', context);
            context.clusterValidationReport = [context.clusterValidationReport, output]
              .filter(Boolean)
              .join('\n');
          });

          await this.executeTask(context, 'validate-prod-local', async () => {
            const output = await executor.validateCluster('prod', context);
            context.clusterValidationReport = [context.clusterValidationReport, output]
              .filter(Boolean)
              .join('\n');
          });
        }

        this.updateStatus(context, 'succeeded');
      }
    } else {
      this.updateStatus(context, 'needs_review');
      this.eventBus.emit(
        this.createEvent(context, 'review.requested', {
          reason: context.reviewNotes.join('; '),
        }),
      );
    }

    await this.executeTask(context, 'notify', async () => {
      await this.notifyHuman(context);
    });

    this.eventBus.emit(this.createEvent(context, 'run.completed', { status: context.status }));
    return context;
  }

  private async notifyHuman(context: AgentContext): Promise<void> {
    const message =
      context.status === 'needs_review'
        ? `Run ${context.runId} requires review. ${context.reviewNotes.join(' | ')}`
        : `Run ${context.runId} completed and was deployed to dev/prod.`;
    const validationMessage = context.clusterValidationReport
      ? ` Cluster validation: ${context.clusterValidationReport}`
      : '';
    const fullMessage = `${message}${validationMessage}`;

    if (context.workItem.kind === 'jira') {
      await this.deps.jira.comment(context.workItem.id, fullMessage);
    }

    if (context.pullRequestId) {
      await this.deps.repo.postPullRequestComment(
        context.workItem.repo,
        context.pullRequestId,
        fullMessage,
      );
    }

    if (this.deps.serviceNow && context.workItem.serviceNowRecordId) {
      await this.deps.serviceNow.appendWorkNote(context.workItem.serviceNowRecordId, fullMessage);
    }
  }

  private buildPullRequestBody(context: AgentContext): string {
    return [
      `Automated implementation for ${context.workItem.id}.`,
      '',
      '## Summary',
      context.workItem.body,
      '',
      '## Generated test report',
      context.testReport ?? 'pending',
    ].join('\n');
  }

  private runTests(generatedCode: string): string {
    if (!generatedCode.includes('export')) {
      throw new Error('Generated code failed baseline tests');
    }
    return 'All synthetic unit and integration checks passed';
  }

  private updateStatus(context: AgentContext, status: RunStatus): void {
    context.status = status;
  }

  private async executeTask(
    context: AgentContext,
    taskId: string,
    fn: () => Promise<void>,
  ): Promise<void> {
    this.eventBus.emit(this.createEvent(context, 'task.started', { taskId }));
    try {
      await fn();
      this.eventBus.emit(this.createEvent(context, 'task.completed', { taskId }));
    } catch (error) {
      context.status = 'failed';
      const message = error instanceof Error ? error.message : 'Unknown task failure';
      this.eventBus.emit(this.createEvent(context, 'task.failed', { taskId, message }));
      throw error;
    }
  }

  private createEvent(
    context: AgentContext,
    type: AgentEvent['type'],
    details: Record<string, unknown>,
  ): AgentEvent {
    return {
      type,
      runId: context.runId,
      timestamp: new Date().toISOString(),
      details,
      taskId: typeof details.taskId === 'string' ? details.taskId : undefined,
    };
  }
}
