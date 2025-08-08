import { nanoid, nowISO } from './util';
import { upsert, list as dbList } from './store';
import { record } from './audit';

export type Environment = {
  id: string;
  name: string;
  provider: 'aws' | 'gcp' | 'azure' | 'local';
  target: 'kubernetes' | 'vm' | 'serverless';
  region?: string;
  createdAt: string;
};

export function createEnv(input: Omit<Environment, 'id' | 'createdAt'>) {
  const env: Environment = { ...input, id: nanoid(), createdAt: nowISO() };
  upsert('environments', env.id, env);
  record('admin', 'ENV_CREATED', env.id, env);
  return env;
}

export function listEnvs() {
  return dbList<Environment>('environments').sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

