import { runCommand } from './exec';
import { config } from './config';
import { emitRun } from './events';

type Job = { id: string; runId: string; name: string; fn: () => Promise<void> };
const q: Job[] = [];
let working = false;

export function enqueue(job: Job) {
  q.push(job);
  tick();
}

async function tick() {
  if (working) return;
  working = true;
  while (q.length) {
    const job = q.shift()!;
    emitRun(job.runId, { type: 'log', line: `Starting job: ${job.name}` });
    try {
      await job.fn();
      emitRun(job.runId, { type: 'log', line: `Job succeeded: ${job.name}` });
    } catch (e: any) {
      emitRun(job.runId, { type: 'log', line: `Job failed: ${job.name}: ${e?.message || e}` });
    }
  }
  working = false;
}

export function dockerBuild(runId: string, contextPath: string, tag: string) {
  enqueue({ id: `${runId}-docker-${Date.now()}`, runId, name: `docker build ${tag}`, async fn() {
    emitRun(runId, { type: 'log', line: `Building image ${tag} from ${contextPath}` });
    await runCommand(config.dockerBin, ['build', '-t', tag, contextPath], {}, (l) => emitRun(runId, { type: 'log', line: l }));
  }});
}

export function helmUpgrade(runId: string, release: string, chart: string, values: Record<string, any>, namespace?: string) {
  const setArgs = Object.entries(values).flatMap(([k, v]) => ['--set', `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`]);
  const nsArgs = namespace ? ['--namespace', namespace, '--create-namespace'] : [];
  enqueue({ id: `${runId}-helm-${Date.now()}`, runId, name: `helm upgrade ${release}`, async fn() {
    emitRun(runId, { type: 'log', line: `Deploying ${release} using ${chart}` });
    await runCommand(config.helmBin, ['upgrade', '--install', release, chart, ...nsArgs, ...setArgs], {}, (l) => emitRun(runId, { type: 'log', line: l }));
  }});
}
