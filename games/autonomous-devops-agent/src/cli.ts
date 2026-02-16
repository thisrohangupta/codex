import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { readRuntimeConfig, type AgentRuntimeConfig } from './config.js';
import { helpText, parseChatCommand } from './chat.js';
import {
  beginOAuthAuthorization,
  completeOAuthAuthorization,
  hasValidToken,
  maskToken,
  readOAuthTokenStore,
  resolveTokenStorePath,
  saveOAuthToken,
} from './oauth.js';
import { createAgentRuntime, type AgentRuntime } from './runtime.js';
import type { AgentContext, AgentEvent, TargetProbeResult } from './types.js';

async function main(): Promise<void> {
  let runtimeState = initializeRuntime(readRuntimeConfig());
  let runtime = runtimeState.runtime;
  const rl = createInterface({ input, output, terminal: true });

  let defaultServiceNowRecordId: string | undefined = runtime.config.serviceNow.defaultRecordId;

  output.write('Autonomous DevOps Agent Chat\n');
  output.write('Type help for commands.\n\n');
  output.write(`${runtime.describe().join('\n')}\n`);
  if (runtimeState.warning) {
    output.write(`warning=${runtimeState.warning}\n`);
  }
  if (defaultServiceNowRecordId) {
    output.write(`activeServiceNowRecord=${defaultServiceNowRecordId}\n`);
  }

  while (true) {
    const line = await rl.question('\nagent> ');
    const command = parseChatCommand(line);

    try {
      if (command.type === 'exit') {
        break;
      }

      if (command.type === 'help') {
        output.write(`${helpText()}\n`);
        continue;
      }

      if (command.type === 'status') {
        output.write(`${runtime.describe().join('\n')}\n`);
        if (runtimeState.warning) {
          output.write(`warning=${runtimeState.warning}\n`);
        }
        output.write(`activeServiceNowRecord=${defaultServiceNowRecordId ?? 'none'}\n`);
        continue;
      }

      if (command.type === 'auth-status') {
        output.write(`${formatOAuthStatus(runtime.config)}\n`);
        continue;
      }

      if (command.type === 'auth') {
        await runOAuthFlow(command.provider, runtime.config, rl);
        runtimeState = initializeRuntime(readRuntimeConfig());
        runtime = runtimeState.runtime;
        output.write(
          runtimeState.warning
            ? `Runtime fallback active: ${runtimeState.warning}\n`
            : 'Runtime credentials reloaded from environment + OAuth token store.\n',
        );
        continue;
      }

      if (command.type === 'events') {
        const history = runtime.eventBus.list();
        if (history.length === 0) {
          output.write('No events captured yet.\n');
          continue;
        }

        for (const event of history) {
          output.write(`${formatEvent(event)}\n`);
        }
        continue;
      }

      if (command.type === 'set-snow') {
        defaultServiceNowRecordId = command.recordId;
        output.write(`Updated ServiceNow record for future runs: ${command.recordId}\n`);
        continue;
      }

      if (command.type === 'run-jira') {
        const context = await executeWithEventStreaming(() =>
          runtime.runFromJira(command.issueId, {
            serviceNowRecordId: defaultServiceNowRecordId,
          }),
          runtime,
        );
        output.write(`${summarizeRun(context)}\n`);
        continue;
      }

      if (command.type === 'run-pr') {
        const context = await executeWithEventStreaming(() =>
          runtime.runFromPullRequest(command.repo, command.prNumber, {
            serviceNowRecordId: defaultServiceNowRecordId,
          }),
          runtime,
        );
        output.write(`${summarizeRun(context)}\n`);
        continue;
      }

      if (command.type === 'probe-targets-jira') {
        const probe = await runtime.probeTargetsFromJira(command.issueId, {
          serviceNowRecordId: defaultServiceNowRecordId,
        });
        output.write(`${formatTargetProbe(probe)}\n`);
        continue;
      }

      if (command.type === 'probe-targets-pr') {
        const probe = await runtime.probeTargetsFromPullRequest(command.repo, command.prNumber, {
          serviceNowRecordId: defaultServiceNowRecordId,
        });
        output.write(`${formatTargetProbe(probe)}\n`);
        continue;
      }

      output.write('Unknown command. Type help to see supported commands.\n');
    } catch (error) {
      output.write(`${formatError(error)}\n`);
    }
  }

  rl.close();
  output.write('Session ended.\n');
}

async function runOAuthFlow(
  provider: 'jira' | 'github',
  config: ReturnType<typeof readRuntimeConfig>,
  rl: ReturnType<typeof createInterface>,
): Promise<void> {
  const request = beginOAuthAuthorization(provider, config);

  output.write(`Open this URL in your browser to authorize ${provider}:\n${request.authorizationUrl}\n`);
  const callback = await rl.question(
    'Paste the redirected callback URL (or just the authorization code): ',
  );

  const token = await completeOAuthAuthorization(request, callback, config);
  saveOAuthToken(provider, token, config);

  output.write(
    `Saved ${provider} access token (${maskToken(token.accessToken)}) at ${resolveTokenStorePath(config.oauth.tokenStorePath)}\n`,
  );
  if (provider === 'jira') {
    output.write(`Detected Jira site URL: ${token.siteUrl ?? 'not detected'}\n`);
  }
}

function formatOAuthStatus(config: ReturnType<typeof readRuntimeConfig>): string {
  const store = readOAuthTokenStore(config);
  const lines = [`tokenStore=${resolveTokenStorePath(config.oauth.tokenStorePath)}`];

  lines.push(formatProviderStatus('github', store.github));
  lines.push(formatProviderStatus('jira', store.jira));

  if (store.jira?.siteUrl) {
    lines.push(`jira.siteUrl=${store.jira.siteUrl}`);
  }

  return lines.join('\n');
}

function formatProviderStatus(
  provider: 'github' | 'jira',
  token: ReturnType<typeof readOAuthTokenStore>['github'],
): string {
  if (!token) {
    return `${provider}=missing`;
  }

  const validity = hasValidToken(token) ? 'valid' : 'expired';
  return `${provider}=${validity} (${maskToken(token.accessToken)})`;
}

function initializeRuntime(config: AgentRuntimeConfig): { runtime: AgentRuntime; warning?: string } {
  try {
    return { runtime: createAgentRuntime(config) };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown runtime configuration failure';
    const fallback = createAgentRuntime({ ...config, mode: 'dry-run' });
    return {
      runtime: fallback,
      warning: `Live runtime unavailable: ${message}. Running in dry-run mode until configuration is complete.`,
    };
  }
}

async function executeWithEventStreaming(
  fn: () => Promise<AgentContext>,
  runtime: ReturnType<typeof createAgentRuntime>,
): Promise<AgentContext> {
  let activeRunId: string | undefined;

  const unsubscribe = runtime.eventBus.subscribe((event) => {
    if (!activeRunId && event.type === 'run.started') {
      activeRunId = event.runId;
    }

    if (activeRunId && event.runId !== activeRunId) {
      return;
    }

    output.write(`${formatEvent(event)}\n`);
  });

  try {
    return await fn();
  } finally {
    unsubscribe();
  }
}

function summarizeRun(context: AgentContext): string {
  const deployments = context.deployments
    .map((item) => `${item.environment}:${item.releaseId}`)
    .join(', ');

  const notes = context.reviewNotes.length > 0 ? ` review=${context.reviewNotes.join(' | ')}` : '';
  const validation = context.clusterValidationReport
    ? ` clusterValidation=${context.clusterValidationReport.replace(/\n/g, ' | ')}`
    : '';

  return `Run ${context.runId} status=${context.status} deployments=[${deployments || 'none'}]${notes}${validation}`;
}

function formatTargetProbe(probe: TargetProbeResult): string {
  const lines = [
    `Target probe runId=${probe.runId}`,
    `workItem=${probe.workItem.kind}:${probe.workItem.id} repo=${probe.workItem.repo} branch=${probe.workItem.branch}`,
    `workspace=${probe.workspacePath ?? 'unknown'}`,
    `deployConfig=${probe.deploymentConfigPath ?? 'unknown'}`,
    `binary=${probe.binaryPath ?? 'none'}`,
  ];

  if (probe.preflightReport) {
    lines.push(`preflight=${probe.preflightReport}`);
  }

  for (const env of probe.environments) {
    lines.push(`env=${env.environment} source=${env.source} targets=${env.targets.length}`);
    for (const target of env.targets) {
      lines.push(`  - ${target.name} (${target.type})`);
      lines.push(`    deploy: ${target.deployCommand}`);
      if (target.validateCommand) {
        lines.push(`    validate: ${target.validateCommand}`);
      }
    }
  }

  return lines.join('\n');
}

function formatEvent(event: AgentEvent): string {
  const taskPart = event.taskId ? ` task=${event.taskId}` : '';
  return `[${event.timestamp}] ${event.type}${taskPart}`;
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return `Error: ${error.message}`;
  }
  return 'Error: unknown failure';
}

main().catch((error) => {
  output.write(`${formatError(error)}\n`);
  process.exitCode = 1;
});
