import { spawn } from 'node:child_process';
import { config } from './config';

export async function runCommand(cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv }, onLine: (l: string) => void) {
  if (config.dryRun) {
    onLine(`[dry-run] ${cmd} ${args.join(' ')}`);
    await new Promise((r) => setTimeout(r, 300));
    return 0;
  }
  return await new Promise<number>((resolve) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, env: { ...process.env, ...opts.env } });
    child.stdout.on('data', (d) => d.toString().split('\n').forEach((l: string) => l && onLine(l)));
    child.stderr.on('data', (d) => d.toString().split('\n').forEach((l: string) => l && onLine(l)));
    child.on('close', (code) => resolve(code ?? 1));
  });
}

