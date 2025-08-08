import { nanoid } from './util';
import { upsert, get as dbGet, list as dbList } from './store';
import { record } from './audit';

export type PlanStep = { id: string; title: string; status: 'pending' | 'planned' | 'running' | 'succeeded' | 'failed' };
export type Plan = {
  id: string;
  summary: string;
  steps: PlanStep[];
  envId?: string;
  meta?: {
    helm?: {
      release: string;
      chartPath: string;
      namespace?: string;
      values: Record<string, any>;
    };
  };
};

const plans = new Map<string, Plan>();

export function createPlan(prompt: string, envId?: string, meta?: Plan['meta']): Plan {
  const id = nanoid();
  const steps: PlanStep[] = [
    { id: nanoid(), title: 'Build', status: 'planned' },
    { id: nanoid(), title: 'Test', status: 'planned' },
    { id: nanoid(), title: 'Package & Sign', status: 'planned' },
    { id: nanoid(), title: 'Deploy Canary 10%', status: 'planned' },
    { id: nanoid(), title: 'Verify & Promote', status: 'planned' },
  ];
  const plan = { id, summary: `Plan for: ${prompt}`, steps, envId, meta };
  plans.set(id, plan);
  upsert('plans', id, plan);
  record('system', 'PLAN_CREATED', id, { prompt });
  return plan;
}

export function getPlanById(id: string): Plan | undefined {
  return plans.get(id) || dbGet<Plan>('plans', id);
}

export function listPlans(): Plan[] {
  const mem = Array.from(plans.values());
  const disk = dbList<Plan>('plans');
  const merged = new Map<string, Plan>();
  for (const p of [...mem, ...disk]) merged.set(p.id, p);
  return Array.from(merged.values());
}
