import { nowISO, nanoid } from './util';
import { upsert, list } from './store';

export type AuditEvent = {
  id: string;
  ts: string;
  actor: string;
  action: string;
  target?: string;
  detail?: any;
};

export function record(actor: string, action: string, target?: string, detail?: any) {
  const evt: AuditEvent = { id: nanoid(), ts: nowISO(), actor, action, target, detail };
  upsert('audits', evt.id, evt);
}

export function listAudits() {
  return list<AuditEvent>('audits').sort((a, b) => (a.ts < b.ts ? 1 : -1));
}

