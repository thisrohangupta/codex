import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type {
  AdapterAuthRuntimeConfig,
  AdapterRole,
  AgentRuntimeConfig,
} from './config.js';
import { readRuntimeConfig } from './config.js';
import type { QueueBackoffConfig, QueueItemStatus, RunQueueApi } from './queue.js';
import type { RunSchedule, ScheduleStoreApi } from './schedule.js';
import { validateCron } from './schedule.js';
import { createAgentRuntime, type AgentRuntime } from './runtime.js';
import { createRuntimeStores } from './stores.js';
import type { AgentContext } from './types.js';
import type { ApprovalStatus, ApprovalStoreApi } from './approvals.js';

interface RuntimeState {
  runtime: AgentRuntime;
  warning?: string;
}

interface AdapterState {
  runtimeState: RuntimeState;
  queue: RunQueueApi;
  approvals: ApprovalStoreApi;
  schedules: ScheduleStoreApi;
  asyncMode: boolean;
  maxAttempts: number;
  queueBackoff: QueueBackoffConfig;
  auth: AdapterAuthRuntimeConfig;
}

interface AuthPrincipal {
  id: string;
  roles: AdapterRole[];
}

class HttpError extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message);
  }
}

async function main(): Promise<void> {
  let config = readRuntimeConfig();
  let state = initializeState(config);

  const server = createServer(async (req, res) => {
    try {
      await handleRequest(req, res, {
        getState: () => state,
        reload: () => {
          config = readRuntimeConfig();
          state = initializeState(config);
          return state;
        },
      });
    } catch (error) {
      if (error instanceof HttpError) {
        writeJson(res, error.statusCode, { error: error.message });
        return;
      }
      writeJson(res, 500, { error: formatError(error) });
    }
  });

  server.listen(config.adapter.port, config.adapter.host, () => {
    process.stdout.write(
      `OpenClaw adapter listening on http://${config.adapter.host}:${config.adapter.port} (mode=${state.runtimeState.runtime.config.mode} asyncMode=${state.asyncMode})\n`,
    );
    if (state.runtimeState.warning) {
      process.stdout.write(`warning=${state.runtimeState.warning}\n`);
    }
    process.stdout.write(`storage=${state.runtimeState.runtime.config.storage.driver}\n`);
    process.stdout.write(`queue=${state.runtimeState.runtime.config.queue.storePath}\n`);
    process.stdout.write(`approvals=${state.runtimeState.runtime.config.policy.approvalStorePath}\n`);
    process.stdout.write(`schedules=${state.runtimeState.runtime.config.schedule.storePath}\n`);
    process.stdout.write(
      `auth=${state.auth.mode}${state.auth.mode === 'api-key' ? ` keys=${state.auth.keys.length}` : ''}\n`,
    );
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
  const state = context.getState();

  if (method === 'OPTIONS') {
    writePreflight(res);
    return;
  }

  if (method === 'GET' && path === '/health') {
    if (!state.auth.allowPublicHealth) {
      authorizeRequest(req, state.auth, 'viewer', method, path);
    }

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
    authorizeRequest(req, state.auth, 'viewer', method, path);
    writeJson(res, 200, {
      describe: state.runtimeState.runtime.describe(),
      warning: state.runtimeState.warning,
      asyncMode: state.asyncMode,
    });
    return;
  }

  if (method === 'POST' && path === '/runtime/reload') {
    authorizeRequest(req, state.auth, 'admin', method, path);
    const nextState = context.reload();
    writeJson(res, 200, {
      reloaded: true,
      describe: nextState.runtimeState.runtime.describe(),
      warning: nextState.runtimeState.warning,
      asyncMode: nextState.asyncMode,
    });
    return;
  }

  if (method === 'GET' && path === '/events') {
    authorizeRequest(req, state.auth, 'viewer', method, path);
    writeJson(res, 200, {
      count: state.runtimeState.runtime.eventBus.list().length,
      events: state.runtimeState.runtime.eventBus.list(),
    });
    return;
  }

  if (method === 'GET' && path === '/queue') {
    authorizeRequest(req, state.auth, 'viewer', method, path);
    const filterValue = asString(url.searchParams.get('status') ?? undefined);
    const filter = isQueueStatus(filterValue) ? filterValue : undefined;
    const items = (await state.queue.list()).filter((item) => (filter ? item.status === filter : true));
    writeJson(res, 200, { count: items.length, items });
    return;
  }

  if (method === 'POST' && path === '/queue/jira') {
    authorizeRequest(req, state.auth, 'operator', method, path);
    const body = await readJsonBody(req);
    const issueId = asString(body.issueId);
    if (!issueId) {
      writeJson(res, 400, { error: 'issueId is required' });
      return;
    }

    const item = await state.queue.enqueueJira(issueId, {
      maxAttempts: toPositiveInteger(body.maxAttempts) ?? state.maxAttempts,
      serviceNowRecordId: asString(body.serviceNowRecordId),
      approvalOverride: asBoolean(body.approvalOverride),
      approvalRequestId: asString(body.approvalRequestId),
    });

    writeJson(res, 202, { queued: true, item });
    return;
  }

  if (method === 'POST' && path === '/queue/pr') {
    authorizeRequest(req, state.auth, 'operator', method, path);
    const body = await readJsonBody(req);
    const repo = asString(body.repo);
    const prNumber = asString(body.prNumber);

    if (!repo || !prNumber) {
      writeJson(res, 400, { error: 'repo and prNumber are required' });
      return;
    }

    const item = await state.queue.enqueuePullRequest(repo, prNumber, {
      maxAttempts: toPositiveInteger(body.maxAttempts) ?? state.maxAttempts,
      serviceNowRecordId: asString(body.serviceNowRecordId),
      approvalOverride: asBoolean(body.approvalOverride),
      approvalRequestId: asString(body.approvalRequestId),
    });

    writeJson(res, 202, { queued: true, item });
    return;
  }

  if (method === 'POST' && path === '/queue/reap') {
    authorizeRequest(req, state.auth, 'admin', method, path);
    const items = await state.queue.reapExpiredRunning({
      now: new Date(),
      backoff: state.queueBackoff,
    });
    writeJson(res, 200, {
      reaped: items.length,
      items,
    });
    return;
  }

  if (method === 'POST' && path.startsWith('/queue/') && path.endsWith('/cancel')) {
    const principal = authorizeRequest(req, state.auth, 'operator', method, path);
    const itemId = decodeURIComponent(path.slice('/queue/'.length, -'/cancel'.length));
    const body = await readJsonBody(req);
    const reason = asString(body.reason) ?? `canceled by ${principal.id}`;
    const item = await state.queue.cancel(itemId, reason);
    writeJson(res, 200, {
      canceled: true,
      item,
    });
    return;
  }

  if (method === 'POST' && path.startsWith('/queue/') && path.endsWith('/retry')) {
    authorizeRequest(req, state.auth, 'operator', method, path);
    const itemId = decodeURIComponent(path.slice('/queue/'.length, -'/retry'.length));
    const item = await state.queue.retry(itemId);
    writeJson(res, 200, {
      retried: true,
      item,
    });
    return;
  }

  if (method === 'POST' && path.startsWith('/queue/') && path.endsWith('/timeout')) {
    const principal = authorizeRequest(req, state.auth, 'operator', method, path);
    const itemId = decodeURIComponent(path.slice('/queue/'.length, -'/timeout'.length));
    const body = await readJsonBody(req);
    const reason = asString(body.reason) ?? `force-timeout by ${principal.id}`;
    const item = await state.queue.forceTimeout(itemId, reason, state.queueBackoff);
    writeJson(res, 200, {
      timedOut: true,
      item,
    });
    return;
  }

  if (method === 'GET' && path.startsWith('/queue/')) {
    authorizeRequest(req, state.auth, 'viewer', method, path);
    const itemId = decodeURIComponent(path.slice('/queue/'.length));
    const item = await state.queue.get(itemId);
    if (!item) {
      writeJson(res, 404, { error: `queue item not found: ${itemId}` });
      return;
    }
    writeJson(res, 200, item);
    return;
  }

  if (method === 'GET' && path === '/approvals') {
    authorizeRequest(req, state.auth, 'viewer', method, path);
    const status = asString(url.searchParams.get('status') ?? undefined);
    const approvals = await state.approvals.list(isApprovalStatus(status) ? status : undefined);
    writeJson(res, 200, {
      count: approvals.length,
      approvals,
    });
    return;
  }

  if (method === 'GET' && path.startsWith('/approvals/')) {
    authorizeRequest(req, state.auth, 'viewer', method, path);
    const approvalId = decodeURIComponent(path.slice('/approvals/'.length));

    if (!approvalId.includes('/')) {
      const approval = await state.approvals.get(approvalId);
      if (!approval) {
        writeJson(res, 404, { error: `approval not found: ${approvalId}` });
        return;
      }
      writeJson(res, 200, approval);
      return;
    }
  }

  if (method === 'POST' && path.startsWith('/approvals/') && path.endsWith('/approve')) {
    const principal = authorizeRequest(req, state.auth, 'approver', method, path);
    const approvalId = decodeURIComponent(path.slice('/approvals/'.length, -'/approve'.length));
    const approval = await state.approvals.get(approvalId);
    if (!approval) {
      writeJson(res, 404, { error: `approval not found: ${approvalId}` });
      return;
    }

    const body = await readJsonBody(req);
    const approvedBy = asString(body.approvedBy) ?? principal.id;
    const serviceNowRecordId = asString(body.serviceNowRecordId) ?? approval.serviceNowRecordId;
    const maxAttempts = toPositiveInteger(body.maxAttempts) ?? state.maxAttempts;

    let queuedItem;
    if (approval.type === 'jira') {
      if (!approval.issueId) {
        writeJson(res, 400, { error: `approval ${approval.id} is missing issueId` });
        return;
      }
      queuedItem = await state.queue.enqueueJira(approval.issueId, {
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
      queuedItem = await state.queue.enqueuePullRequest(approval.repo, approval.prNumber, {
        maxAttempts,
        serviceNowRecordId,
        approvalOverride: true,
        approvalRequestId: approval.id,
      });
    }

    const updated = await state.approvals.markApproved(approval.id, {
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
    const principal = authorizeRequest(req, state.auth, 'approver', method, path);
    const approvalId = decodeURIComponent(path.slice('/approvals/'.length, -'/reject'.length));
    const approval = await state.approvals.get(approvalId);
    if (!approval) {
      writeJson(res, 404, { error: `approval not found: ${approvalId}` });
      return;
    }

    const body = await readJsonBody(req);
    const updated = await state.approvals.markRejected(approval.id, {
      rejectedBy: asString(body.rejectedBy) ?? principal.id,
      reason: asString(body.reason),
    });

    writeJson(res, 200, {
      rejected: true,
      approval: updated,
    });
    return;
  }

  if (method === 'GET' && path === '/schedules') {
    authorizeRequest(req, state.auth, 'viewer', method, path);
    const schedules = await state.schedules.list();
    writeJson(res, 200, {
      count: schedules.length,
      schedules,
    });
    return;
  }

  if (method === 'GET' && path.startsWith('/schedules/')) {
    authorizeRequest(req, state.auth, 'viewer', method, path);
    const scheduleId = decodeURIComponent(path.slice('/schedules/'.length));
    if (!scheduleId.includes('/')) {
      const schedule = await state.schedules.get(scheduleId);
      if (!schedule) {
        writeJson(res, 404, { error: `schedule not found: ${scheduleId}` });
        return;
      }
      writeJson(res, 200, schedule);
      return;
    }
  }

  if (method === 'POST' && path === '/schedules') {
    authorizeRequest(req, state.auth, 'operator', method, path);
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
        ? await state.schedules.create({
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
        : await state.schedules.create({
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
    authorizeRequest(req, state.auth, 'operator', method, path);
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

      const updated = await state.schedules.update(scheduleId, patch);
      writeJson(res, 200, updated);
      return;
    }
  }

  if (method === 'DELETE' && path.startsWith('/schedules/')) {
    authorizeRequest(req, state.auth, 'operator', method, path);
    const scheduleId = decodeURIComponent(path.slice('/schedules/'.length));
    if (!scheduleId.includes('/')) {
      const deleted = await state.schedules.delete(scheduleId);
      if (!deleted) {
        writeJson(res, 404, { error: `schedule not found: ${scheduleId}` });
        return;
      }
      writeJson(res, 200, { deleted: true, id: scheduleId });
      return;
    }
  }

  if (method === 'POST' && path.startsWith('/schedules/') && path.endsWith('/run-now')) {
    authorizeRequest(req, state.auth, 'operator', method, path);
    const scheduleId = decodeURIComponent(path.slice('/schedules/'.length, -'/run-now'.length));
    const schedule = await state.schedules.get(scheduleId);
    if (!schedule) {
      writeJson(res, 404, { error: `schedule not found: ${scheduleId}` });
      return;
    }

    const queuedItem = await enqueueFromSchedule(schedule, state);
    writeJson(res, 202, {
      queued: true,
      scheduleId,
      queuedItem,
    });
    return;
  }

  if (method === 'POST' && path === '/runs/jira') {
    authorizeRequest(req, state.auth, 'operator', method, path);
    const body = await readJsonBody(req);
    const issueId = asString(body.issueId);
    if (!issueId) {
      writeJson(res, 400, { error: 'issueId is required' });
      return;
    }

    if (state.asyncMode) {
      const item = await state.queue.enqueueJira(issueId, {
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
    authorizeRequest(req, state.auth, 'operator', method, path);
    const body = await readJsonBody(req);
    const issueId = asString(body.issueId);
    if (!issueId) {
      writeJson(res, 400, { error: 'issueId is required' });
      return;
    }

    const result = await state.runtimeState.runtime.probeTargetsFromJira(issueId, {
      serviceNowRecordId: asString(body.serviceNowRecordId),
    });

    writeJson(res, 200, result);
    return;
  }

  if (method === 'POST' && path === '/runs/pr') {
    authorizeRequest(req, state.auth, 'operator', method, path);
    const body = await readJsonBody(req);
    const repo = asString(body.repo);
    const prNumber = asString(body.prNumber);

    if (!repo || !prNumber) {
      writeJson(res, 400, { error: 'repo and prNumber are required' });
      return;
    }

    if (state.asyncMode) {
      const item = await state.queue.enqueuePullRequest(repo, prNumber, {
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
    authorizeRequest(req, state.auth, 'operator', method, path);
    const body = await readJsonBody(req);
    const repo = asString(body.repo);
    const prNumber = asString(body.prNumber);
    if (!repo || !prNumber) {
      writeJson(res, 400, { error: 'repo and prNumber are required' });
      return;
    }

    const result = await state.runtimeState.runtime.probeTargetsFromPullRequest(repo, prNumber, {
      serviceNowRecordId: asString(body.serviceNowRecordId),
    });

    writeJson(res, 200, result);
    return;
  }

  authorizeRequest(req, state.auth, 'viewer', method, path);
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
      'POST /queue/{id}/cancel',
      'POST /queue/{id}/retry',
      'POST /queue/{id}/timeout',
      'POST /queue/reap',
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
  if (config.adapter.auth.mode === 'api-key' && config.adapter.auth.keys.length === 0) {
    throw new Error(
      'Adapter auth is enabled but no API keys are configured. Set ADAPTER_API_KEY, ADAPTER_AUTH_KEYS, or ADAPTER_AUTH_KEYS_JSON.',
    );
  }

  const stores = createRuntimeStores(config);

  return {
    runtimeState: initializeRuntime(config),
    queue: stores.queue,
    approvals: stores.approvals,
    schedules: stores.schedules,
    asyncMode: config.adapter.asyncQueue,
    maxAttempts: config.queue.maxAttempts,
    queueBackoff: {
      initialBackoffMs: config.queue.initialBackoffMs,
      maxBackoffMs: config.queue.maxBackoffMs,
    },
    auth: config.adapter.auth,
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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
}

function authorizeRequest(
  req: IncomingMessage,
  authConfig: AdapterAuthRuntimeConfig,
  requiredRole: AdapterRole,
  method: string,
  path: string,
): AuthPrincipal {
  if (authConfig.mode !== 'api-key') {
    return {
      id: 'anonymous',
      roles: ['admin'],
    };
  }

  const apiKey = extractApiKey(req);
  if (!apiKey) {
    throw new HttpError(401, `API key required for ${method} ${path}`);
  }

  const key = authConfig.keys.find((item) => item.key === apiKey);
  if (!key) {
    throw new HttpError(401, 'Invalid API key');
  }

  if (!hasRole(key.roles, requiredRole)) {
    throw new HttpError(403, `API key '${key.id}' does not have required role '${requiredRole}'`);
  }

  return {
    id: key.id,
    roles: key.roles,
  };
}

function extractApiKey(req: IncomingMessage): string | undefined {
  const rawApiKey = req.headers['x-api-key'];
  if (typeof rawApiKey === 'string' && rawApiKey.trim()) {
    return rawApiKey.trim();
  }

  const authorization = req.headers.authorization;
  if (typeof authorization === 'string' && authorization.trim()) {
    const match = /^bearer\s+(.+)$/i.exec(authorization.trim());
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  return undefined;
}

function hasRole(roles: AdapterRole[], requiredRole: AdapterRole): boolean {
  if (roles.includes('admin')) {
    return true;
  }

  if (requiredRole === 'viewer') {
    return roles.includes('viewer') || roles.includes('operator') || roles.includes('approver');
  }

  if (requiredRole === 'operator') {
    return roles.includes('operator');
  }

  if (requiredRole === 'approver') {
    return roles.includes('approver');
  }

  return false;
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

async function enqueueFromSchedule(schedule: RunSchedule, state: AdapterState) {
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

function isApprovalStatus(value: string | undefined): value is ApprovalStatus {
  return value === 'pending' || value === 'approved' || value === 'rejected';
}

function isQueueStatus(value: string | undefined): value is QueueItemStatus {
  return value === 'queued' ||
    value === 'running' ||
    value === 'retryable' ||
    value === 'succeeded' ||
    value === 'failed' ||
    value === 'canceled';
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
