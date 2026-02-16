import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { helpText, parseChatCommand } from './chat.js';
import { createAgentRuntime } from './runtime.js';
import type { AgentContext, AgentEvent } from './types.js';

async function main(): Promise<void> {
  const runtime = createAgentRuntime();
  const rl = createInterface({ input, output, terminal: true });

  let defaultServiceNowRecordId: string | undefined = runtime.config.serviceNow.defaultRecordId;

  output.write('Autonomous DevOps Agent Chat\n');
  output.write('Type help for commands.\n\n');
  output.write(`${runtime.describe().join('\n')}\n`);
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
        output.write(`activeServiceNowRecord=${defaultServiceNowRecordId ?? 'none'}\n`);
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

      output.write('Unknown command. Type help to see supported commands.\n');
    } catch (error) {
      output.write(`${formatError(error)}\n`);
    }
  }

  rl.close();
  output.write('Session ended.\n');
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

  return `Run ${context.runId} status=${context.status} deployments=[${deployments || 'none'}]${notes}`;
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
