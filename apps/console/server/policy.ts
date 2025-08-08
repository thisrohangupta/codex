import { Plan } from './plan';
import { runCommand } from './exec';

export type PolicyFinding = { level: 'info' | 'warn' | 'error'; message: string; code: string };
export type PolicyResult = { allow: boolean; findings: PolicyFinding[] };

export function evaluatePlan(plan: Plan): PolicyResult {
  const findings: PolicyFinding[] = [];
  const summary = plan.summary.toLowerCase();
  if (summary.includes('prod') && !summary.includes('canary')) {
    findings.push({ level: 'error', message: 'Production deployments must use canary or blue/green.', code: 'DEPLOY_STRATEGY' });
  }
  if (summary.includes('deploy') && !summary.includes('verify')) {
    findings.push({ level: 'warn', message: 'Add post-deploy verification gates.', code: 'VERIFY_GATES' });
  }
  const allow = findings.every((f) => f.level !== 'error');
  return { allow, findings };
}

// Optional: If conftest is installed and policies exist in ops/policy/, run them against the plan JSON.
export async function evaluateWithConftest(plan: Plan): Promise<PolicyResult | null> {
  try {
    const input = JSON.stringify(plan);
    let output = '';
    const code = await runCommand('conftest', ['test', '--all-namespaces', '--policy', 'ops/policy', '-'], {}, (l) => {
      output += l + '\n';
    });
    // conftest returns non-zero on failures; parse output for messages
    const lines = output.split('\n').filter(Boolean);
    const findings = lines.map((line) => ({ level: code === 0 ? 'info' : 'error', message: line, code: 'CONFTEST' as const }));
    return { allow: code === 0, findings };
  } catch {
    return null;
  }
}
