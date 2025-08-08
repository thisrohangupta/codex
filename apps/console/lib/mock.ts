// Client-side mock generators and flows
export function mockPlan(prompt: string) {
  const id = nano();
  const steps = ['Build', 'Test', 'Package & Sign', 'Deploy Canary 10%', 'Verify & Promote'].map((title) => ({ id: nano(), title, status: 'planned' as const }));
  return { id, summary: `Plan for: ${prompt}`, steps };
}

export function runMockPlan(plan: any, onUpdate: (u: any) => void) {
  let i = 0;
  const tick = () => {
    if (i >= plan.steps.length) {
      onUpdate({ type: 'status', runStatus: 'succeeded', done: true });
      return;
    }
    const s = plan.steps[i];
    onUpdate({ type: 'status', stepId: s.id, status: 'running' });
    onUpdate({ type: 'log', stepId: s.id, line: `Running: ${s.title}` });
    setTimeout(() => {
      onUpdate({ type: 'status', stepId: s.id, status: 'succeeded' });
      i += 1;
      setTimeout(tick, 500);
    }, 600);
  };
  setTimeout(tick, 300);
}

export function mockPolicy(plan: any) {
  const allow = true;
  const findings = [{ level: 'info', code: 'MOCK', message: 'No issues found in mock mode.' }];
  return { allow, findings };
}

function nano() { return Math.random().toString(36).slice(2, 10); }

