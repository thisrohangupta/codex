import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { FileApprovalStore } from './approvals.js';
import { readRuntimeConfig, type AgentRuntimeConfig } from './config.js';
import { FileRunQueue } from './queue.js';
import { FileScheduleStore, type RunSchedule, validateCron } from './schedule.js';
import { createAgentRuntime, type AgentRuntime } from './runtime.js';
import type { AgentContext } from './types.js';

interface RuntimeState {
  runtime: AgentRuntime;
  warning?: string;
}

interface AdapterState {
  runtimeState: RuntimeState;
  queue: FileRunQueue;
  approvals: FileApprovalStore;
  schedules: FileScheduleStore;
  asyncMode: boolean;
  maxAttempts: number;
}

async function main(): Promise<void> {
  let state = initializeState(readRuntimeConfig());

  const host = process.env.ADAPTER_HOST ?? '127.0.0.1';
  const port = Number(process.env.ADAPTER_PORT ?? '8790');

  const server = createServer(async (req, res) => {
    try {
      await handleRequest(req, res, {
        getState: () => state,
        reload: () => {
          state = initializeState(readRuntimeConfig());
          return state;
        },
      });
    } catch (error) {
      writeJson(res, 500, { error: formatError(error) });
    }
  });

  server.listen(port, host, () => {
    process.stdout.write(
      `OpenClaw adapter listening on http://${host}:${port} (mode=${state.runtimeState.runtime.config.mode} asyncMode=${state.asyncMode})\n`,
    );
    if (state.runtimeState.warning) {
      process.stdout.write(`warning=${state.runtimeState.warning}\n`);
    }
    process.stdout.write(`queue=${state.runtimeState.runtime.config.queue.storePath}\n`);
    process.stdout.write(`approvals=${state.runtimeState.runtime.config.policy.approvalStorePath}\n`);
    process.stdout.write(`schedules=${state.runtimeState.runtime.config.schedule.storePath}\n`);
  });
}

interface RequestContext {
  getState: () => AdapterState;
  reload: () => AdapterState;
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  context: RequestContext,
): Promise<void> {
  const method = req.method ?? 'GET';
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = normalizePath(url.pathname);

  if (method === 'OPTIONS') {
    writePreflight(res);
    return;
  }

  if (method === 'GET' && path === '/health') {
    const state = context.getState();
    writeJson(res, 200, {
      ok: true,
      mode: state.runtimeState.runtime.config.mode,
      warning: state.runtimeState.warning,
      asyncMode: state.asyncMode,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  if (method === 'GET' && path === '/runtime') {
    const state = context.getState();
    writeJson(res, 200, {
      describe: state.runtimeState.runtime.describe(),
      warning: state.runtimeState.warning,
      asyncMode: state.asyncMode,
    });
    return;
  }

  if (method === 'POST' && path === '/runtime/reload') {
    const state = context.reload();
    writeJson(res, 200, {
      reloaded: true,
      describe: state.runtimeState.runtime.describe(),
      warning: state.runtimeState.warning,
      asyncMode: state.asyncMode,
    });
    return;
  }

  if (method === 'GET' && path === '/events') {
    const state = context.getState();
    writeJson(res, 200, {
      count: state.runtimeState.runtime.eventBus.list().length,
      events: state.runtimeState.runtime.eventBus.list(),
    });
    return;
  }

  if (method === 'GET' && path === '/queue') {
    const state = context.getState();
    const filter = asString(url.searchParams.get('status') ?? undefined);
    const items = state.queue.list().filter((item) => (filter ? item.status === filter : true));
    writeJson(res, 200, { count: items.length, items });
    return;
  }

  if (method === 'GET' && path.startsWith('/queue/')) {
    const state = context.getState();
    const itemId = decodeURIComponent(path.slice('/queue/'.length));
    const item = state.queue.get(itemId);
    if (!item) {
      writeJson(res, 404, { error: `queue item not found: ${itemId}` });
      return;
    }
    writeJson(res, 200, item);
    return;
  }

  if (method === 'POST' && path === '/queue/jira') {
    const state = context.getState();
    const body = await readJsonBody(req);
    const issueId = asString(body.issueId);
    if (!issueId) {
      writeJson(res, 400, { error: 'issueId is required' });
      return;
    }

    const item = state.queue.enqueueJira(issueId, {
      maxAttempts: toPositiveInteger(body.maxAttempts) ?? state.maxAttempts,
      serviceNowRecordId: asString(body.serviceNowRecordId),
      approvalOverride: asBoolean(body.approvalOverride),
      approvalRequestId: asString(body.approvalRequestId),
    });

    writeJson(res, 202, { queued: true, item });
    return;
  }

  if (method === 'POST' && path === '/queue/pr') {
    const state = context.getState();
    const body = await readJsonBody(req);
    const repo = asString(body.repo);
    const prNumber = asString(body.prNumber);

    if (!repo || !prNumber) {
      writeJson(res, 400, { error: 'repo and prNumber are required' });
      return;
    }

    const item = state.queue.enqueuePullRequest(repo, prNumber, {
      maxAttempts: toPositiveInteger(body.maxAttempts) ?? state.maxAttempts,
      serviceNowRecordId: asString(body.serviceNowRecordId),
      approvalOverride: asBoolean(body.approvalOverride),
      approvalRequestId: asString(body.approvalRequestId),
    });

    writeJson(res, 202, { queued: true, item });
    return;
  }

  if (method === 'GET' && path === '/approvals') {
    const state = context.getState();
    const status = asString(url.searchParams.get('status') ?? undefined);
    const approvals = state.approvals.list(isApprovalStatus(status) ? status : undefined);
    writeJson(res, 200, {
      count: approvals.length,
      approvals,
    });
    return;
  }

  if (method === 'GET' && path.startsWith('/approvals/')) {
    const state = context.getState();
    const approvalId = decodeURIComponent(path.slice('/approvals/'.length));

    if (!approvalId.includes('/')) {
      const approval = state.approvals.get(approvalId);
      if (!approval) {
        writeJson(res, 404, { error: `approval not found: ${approvalId}` });
        return;
      }
      writeJson(res, 200, approval);
      return;
    }
  }

  if (method === 'POST' && path.startsWith('/approvals/') && path.endsWith('/approve')) {
    const state = context.getState();
    const approvalId = decodeURIComponent(path.slice('/approvals/'.length, -'/approve'.length));
    const approval = state.approvals.get(approvalId);
    if (!approval) {
      writeJson(res, 404, { error: `approval not found: ${approvalId}` });
      return;
    }

    const body = await readJsonBody(req);
    const approvedBy = asString(body.approvedBy);
    const serviceNowRecordId = asString(body.serviceNowRecordId) ?? approval.serviceNowRecordId;
    const maxAttempts = toPositiveInteger(body.maxAttempts) ?? state.maxAttempts;

    let queuedItem;
    if (approval.type === 'jira') {
      if (!approval.issueId) {
        writeJson(res, 400, { error: `approval ${approval.id} is missing issueId` });
        return;
      }
      queuedItem = state.queue.enqueueJira(approval.issueId, {
        maxAttempts,
        serviceNowRecordId,
        approvalOverride: true,
        approvalRequestId: approval.id,
      });
    } else {
      if (!approval.repo || !approval.prNumber) {
        writeJson(res, 400, { error: `approval ${approval.id} is missing repo/prNumber` });
        return;
      }
      queuedItem = state.queue.enqueuePullRequest(approval.repo, approval.prNumber, {
        maxAttempts,
        serviceNowRecordId,
        approvalOverride: true,
        approvalRequestId: approval.id,
      });
    }

    const updated = state.approvals.markApproved(approval.id, {
      approvedBy,
      queuedRunId: queuedItem.id,
    });

    writeJson(res, 202, {
      approved: true,
      approval: updated,
      queuedItem,
    });
    return;
  }

  if (method === 'POST' && path.startsWith('/approvals/') && path.endsWith('/reject')) {
    const state = context.getState();
    const approvalId = decodeURIComponent(path.slice('/approvals/'.length, -'/reject'.length));
    const approval = state.approvals.get(approvalId);
    if (!approval) {
      writeJson(res, 404, { error: `approval not found: ${approvalId}` });
      return;
    }

    const body = await readJsonBody(req);
    const updated = state.approvals.markRejected(approval.id, {
      rejectedBy: asString(body.rejectedBy),
      reason: asString(body.reason),
    });

    writeJson(res, 200, {
      rejected: true,
      approval: updated,
    });
    return;
  }

  if (method === 'GET' && path === '/schedules') {
    const state = context.getState();
    writeJson(res, 200, {
      count: state.schedules.list().length,
      schedules: state.schedules.list(),
    });
    return;
  }

  if (method === 'GET' && path.startsWith('/schedules/')) {
    const state = context.getState();
    const scheduleId = decodeURIComponent(path.slice('/schedules/'.length));
    if (!scheduleId.includes('/')) {
      const schedule = state.schedules.get(scheduleId);
      if (!schedule) {
        writeJson(res, 404, { error: `schedule not found: ${scheduleId}` });
        return;
      }
      writeJson(res, 200, schedule);
      return;
    }
  }

  if (method === 'POST' && path === '/schedules') {
    const state = context.getState();
    const body = await readJsonBody(req);
    const name = asString(body.name) ?? 'Unnamed schedule';
    const cron = asString(body.cron);
    const type = asString(body.type);

    if (!cron || !type) {
      writeJson(res, 400, { error: 'name, cron, and type are required' });
      return;
    }

    validateCron(cron);

    const schedule =
      type === 'jira'
        ? state.schedules.create({
            name,
            cron,
            enabled: body.enabled === undefined ? true : asBoolean(body.enabled),
            target: {
              type: 'jira',
              issueId: asString(body.issueId),
              serviceNowRecordId: asString(body.serviceNowRecordId),
              maxAttempts: toPositiveInteger(body.maxAttempts),
            },
          })
        : state.schedules.create({
            name,
            cron,
            enabled: body.enabled === undefined ? true : asBoolean(body.enabled),
            target: {
              type: 'pull_request',
              repo: asString(body.repo),
              prNumber: asString(body.prNumber),
              serviceNowRecordId: asString(body.serviceNowRecordId),
              maxAttempts: toPositiveInteger(body.maxAttempts),
            },
          });

    writeJson(res, 201, schedule);
    return;
  }

  if (method === 'PATCH' && path.startsWith('/schedules/')) {
    const state = context.getState();
    const scheduleId = decodeURIComponent(path.slice('/schedules/'.length));
    if (scheduleId.includes('/')) {
      // handled by other routes
    } else {
      const body = await readJsonBody(req);

      const patch: {
        name?: string;
        cron?: string;
        enabled?: boolean;
        target?: {
          type: 'jira' | 'pull_request';
          issueId?: string;
          repo?: string;
          prNumber?: string;
          serviceNowRecordId?: string;
          maxAttempts?: number;
        };
      } = {};

      if (typeof body.name === 'string') {
        patch.name = body.name;
      }
      if (typeof body.cron === 'string') {
        validateCron(body.cron);
        patch.cron = body.cron;
      }
      if (typeof body.enabled === 'boolean') {
        patch.enabled = body.enabled;
      }
      if (typeof body.type === 'string') {
        if (body.type === 'jira') {
          patch.target = {
            type: 'jira',
            issueId: asString(body.issueId),
            serviceNowRecordId: asString(body.serviceNowRecordId),
            maxAttempts: toPositiveInteger(body.maxAttempts),
          };
        }
        if (body.type === 'pull_request') {
          patch.target = {
            type: 'pull_request',
            repo: asString(body.repo),
            prNumber: asString(body.prNumber),
            serviceNowRecordId: asString(body.serviceNowRecordId),
            maxAttempts: toPositiveInteger(body.maxAttempts),
          };
        }
      }

      const updated = state.schedules.update(scheduleId, patch);
      writeJson(res, 200, updated);
      return;
    }
  }

  if (method === 'DELETE' && path.startsWith('/schedules/')) {
    const state = context.getState();
    const scheduleId = decodeURIComponent(path.slice('/schedules/'.length));
    if (!scheduleId.includes('/')) {
      const deleted = state.schedules.delete(scheduleId);
      if (!deleted) {
        writeJson(res, 404, { error: `schedule not found: ${scheduleId}` });
        return;
      }
      writeJson(res, 200, { deleted: true, id: scheduleId });
      return;
    }
  }

  if (method === 'POST' && path.startsWith('/schedules/') && path.endsWith('/run-now')) {
    const state = context.getState();
    const scheduleId = decodeURIComponent(path.slice('/schedules/'.length, -'/run-now'.length));
    const schedule = state.schedules.get(scheduleId);
    if (!schedule) {
      writeJson(res, 404, { error: `schedule not found: ${scheduleId}` });
      return;
    }

    const queuedItem = enqueueFromSchedule(schedule, state);
    writeJson(res, 202, {
      queued: true,
      scheduleId,
      queuedItem,
    });
    return;
  }

  if (method === 'POST' && path === '/runs/jira') {
    const body = await readJsonBody(req);
    const issueId = asString(body.issueId);
    if (!issueId) {
      writeJson(res, 400, { error: 'issueId is required' });
      return;
    }

    const state = context.getState();
    if (state.asyncMode) {
      const item = state.queue.enqueueJira(issueId, {
        maxAttempts: state.maxAttempts,
        serviceNowRecordId: asString(body.serviceNowRecordId),
      });

      writeJson(res, 202, { queued: true, item });
      return;
    }

    const result = await state.runtimeState.runtime.runFromJira(issueId, {
      serviceNowRecordId: asString(body.serviceNowRecordId),
    });

    writeJson(res, 200, summarizeRun(result));
    return;
  }

  if (method === 'POST' && path === '/probe/jira') {
    const body = await readJsonBody(req);
    const issueId = asString(body.issueId);
    if (!issueId) {
      writeJson(res, 400, { error: 'issueId is required' });
      return;
    }

    const state = context.getState();
    const result = await state.runtimeState.runtime.probeTargetsFromJira(issueId, {
      serviceNowRecordId: asString(body.serviceNowRecordId),
    });

    writeJson(res, 200, result);
    return;
  }

  if (method === 'POST' && path === '/runs/pr') {
    const body = await readJsonBody(req);
    const repo = asString(body.repo);
    const prNumber = asString(body.prNumber);

    if (!repo || !prNumber) {
      writeJson(res, 400, { error: 'repo and prNumber are required' });
      return;
    }

    const state = context.getState();
    if (state.asyncMode) {
      const item = state.queue.enqueuePullRequest(repo, prNumber, {
        maxAttempts: state.maxAttempts,
        serviceNowRecordId: asString(body.serviceNowRecordId),
      });

      writeJson(res, 202, { queued: true, item });
      return;
    }

    const result = await state.runtimeState.runtime.runFromPullRequest(repo, prNumber, {
      serviceNowRecordId: asString(body.serviceNowRecordId),
    });

    writeJson(res, 200, summarizeRun(result));
    return;
  }

  if (method === 'POST' && path === '/probe/pr') {
    const body = await readJsonBody(req);
    const repo = asString(body.repo);
    const prNumber = asString(body.prNumber);
    if (!repo || !prNumber) {
      writeJson(res, 400, { error: 'repo and prNumber are required' });
      return;
    }

    const state = context.getState();
    const result = await state.runtimeState.runtime.probeTargetsFromPullRequest(repo, prNumber, {
      serviceNowRecordId: asString(body.serviceNowRecordId),
    });

    writeJson(res, 200, result);
    return;
  }

  writeJson(res, 404, {
    error: 'not_found',
    route: `${method} ${path}`,
    routes: [
      'GET /health',
      'GET /runtime',
      'POST /runtime/reload',
      'GET /events',
      'GET /queue',
      'GET /queue/{id}',
      'POST /queue/jira',
      'POST /queue/pr',
      'GET /approvals',
      'GET /approvals/{id}',
      'POST /approvals/{id}/approve',
      'POST /approvals/{id}/reject',
      'GET /schedules',
      'GET /schedules/{id}',
      'POST /schedules',
      'PATCH /schedules/{id}',
      'DELETE /schedules/{id}',
      'POST /schedules/{id}/run-now',
      'POST /runs/jira',
      'POST /runs/pr',
      'POST /probe/jira',
      'POST /probe/pr',
    ],
  });
}

function summarizeRun(context: AgentContext): Record<string, unknown> {
  return {
    runId: context.runId,
    status: context.status,
    workItem: context.workItem,
    pullRequestId: context.pullRequestId,
    deployments: context.deployments,
    reviewNotes: context.reviewNotes,
    clusterValidationReport: context.clusterValidationReport,
    testReport: context.testReport,
  };
}

function initializeState(config: AgentRuntimeConfig): AdapterState {
  return {
    runtimeState: initializeRuntime(config),
    queue: new FileRunQueue(config.queue.storePath),
    approvals: new FileApprovalStore(config.policy.approvalStorePath),
    schedules: new FileScheduleStore(config.schedule.storePath),
    asyncMode: parseBoolean(process.env.ADAPTER_ASYNC_QUEUE),
    maxAttempts: config.queue.maxAttempts,
  };
}

function initializeRuntime(config: AgentRuntimeConfig): RuntimeState {
  try {
    return { runtime: createAgentRuntime(config) };
  } catch (error) {
    const message = formatError(error);
    return {
      runtime: createAgentRuntime({ ...config, mode: 'dry-run' }),
      warning: `Live runtime unavailable: ${message}. Running in dry-run mode until configuration is complete.`,
    };
  }
}

function normalizePath(pathname: string): string {
  return pathname.replace(/\/$/, '') || '/';
}

function writeJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  const body = JSON.stringify(payload, null, 2);
  res.statusCode = statusCode;
  setCorsHeaders(res);
  res.setHeader('Content-Type', 'application/json');
  res.end(body);
}

function writePreflight(res: ServerResponse): void {
  res.statusCode = 204;
  setCorsHeaders(res);
  res.end();
}

function setCorsHeaders(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function enqueueFromSchedule(schedule: RunSchedule, state: AdapterState) {
  if (schedule.target.type === 'jira') {
    if (!schedule.target.issueId) {
      throw new Error(`Schedule ${schedule.id} missing issueId`);
    }

    return state.queue.enqueueJira(schedule.target.issueId, {
      maxAttempts: schedule.target.maxAttempts ?? state.maxAttempts,
      serviceNowRecordId: schedule.target.serviceNowRecordId,
    });
  }

  if (!schedule.target.repo || !schedule.target.prNumber) {
    throw new Error(`Schedule ${schedule.id} missing repo/prNumber`);
  }

  return state.queue.enqueuePullRequest(schedule.target.repo, schedule.target.prNumber, {
    maxAttempts: schedule.target.maxAttempts ?? state.maxAttempts,
    serviceNowRecordId: schedule.target.serviceNowRecordId,
  });
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    return parseBoolean(value);
  }

  return false;
}

function toPositiveInteger(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }

  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return undefined;
}

function parseBoolean(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function isApprovalStatus(value: string | undefined): value is 'pending' | 'approved' | 'rejected' {
  return value === 'pending' || value === 'approved' || value === 'rejected';
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return 'unknown error';
}

main().catch((error) => {
  process.stderr.write(`adapter startup error: ${formatError(error)}\n`);
  process.exitCode = 1;
});
