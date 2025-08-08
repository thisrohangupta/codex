import { Plan } from './plan';
import { nanoid, nowISO } from './util';
import { upsert } from './store';
import { record } from './audit';
import { emitRun, onRun } from './events';
import { dockerBuild, helmUpgrade } from './queue';
import { get as dbGet } from './store';
import type { Environment } from './env';

type Run = { id: string; planSummary: string; stepIds: string[]; createdAt: string; status: 'pending' | 'running' | 'succeeded' | 'failed' };

const runs = new Map<string, Run>();

export function createRunFromPlan(plan: Plan): string {
  const id = nanoid();
  const run = { id, planSummary: plan.summary, stepIds: plan.steps.map((s) => s.id), createdAt: nowISO(), status: 'pending' as Run['status'] };
  runs.set(id, run);
  upsert('runs', id, run);
  record('system', 'RUN_CREATED', id, { plan: plan.id });
  return id;
}

export function listRuns() {
  return Array.from(runs.values()).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function getRun(id: string) {
  return runs.get(id);
}

export function startRunStreaming(
  runId: string,
  send: (evt: any) => void,
  close: () => void
) {
  const run = runs.get(runId);
  if (!run) return close();
  run.status = 'running';
  const off = onRun(runId, (payload) => send(payload));
  // Emit initial status
  send({ type: 'status', runStatus: run.status });
  // Auto-finish when a finalize event arrives (simulated in orchestrateRun)
  const timer = setInterval(() => {}, 10000);
  return () => {
    off();
    clearInterval(timer);
  };
}

export function triggerRollback(runId: string, send: (evt: any) => void) {
  const run = runs.get(runId);
  if (!run) return;
  send({ type: 'log', line: 'Rollback initiated...' });
  for (const stepId of run.stepIds.slice().reverse()) {
    send({ type: 'log', stepId, line: 'Reverting step...' });
    send({ type: 'status', stepId, status: 'succeeded' });
  }
  run.status = 'succeeded';
  send({ type: 'status', runStatus: run.status, done: true });
}

export async function orchestrateRun(runId: string, plan: Plan) {
  // Map plan steps to real jobs and emit progress via event bus.
  const stepMap = plan.steps;
  const env: Environment | undefined = plan.envId ? dbGet<Environment>('environments', plan.envId) : undefined;
  for (const step of stepMap) {
    emitRun(runId, { type: 'status', stepId: step.id, status: 'running' });
    if (step.title.toLowerCase().includes('build')) {
      dockerBuild(runId, process.cwd(), `${Date.now()}`);
      emitRun(runId, { type: 'log', stepId: step.id, line: 'Queued docker build.' });
    }
    if (step.title.toLowerCase().includes('deploy')) {
      const ns = plan.meta?.helm?.namespace || env?.name || 'demo';
      const release = plan.meta?.helm?.release || 'demo';
      const chartPath = plan.meta?.helm?.chartPath || 'ops/helm/app';
      const values = plan.meta?.helm?.values || { image: { repository: 'example/web', tag: 'local' } };
      helmUpgrade(runId, release, chartPath, values, ns);
      emitRun(runId, { type: 'log', stepId: step.id, line: `Queued helm deploy (${release} → ${ns}).` });
    }
    // Mark step succeeded after a short delay (simulation)
    await new Promise((r) => setTimeout(r, 900));
    emitRun(runId, { type: 'status', stepId: step.id, status: 'succeeded' });
  }
  const run = runs.get(runId);
  if (run) run.status = 'succeeded';
  emitRun(runId, { type: 'status', runStatus: 'succeeded', done: true });
}
