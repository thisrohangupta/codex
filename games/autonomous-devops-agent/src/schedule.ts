import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import type { QueueItemType } from './queue.js';

export interface ScheduleTarget {
  type: QueueItemType;
  issueId?: string;
  repo?: string;
  prNumber?: string;
  serviceNowRecordId?: string;
  maxAttempts?: number;
}

export interface RunSchedule {
  id: string;
  name: string;
  cron: string;
  enabled: boolean;
  target: ScheduleTarget;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  nextRunAt: string;
}

interface ScheduleStoreState {
  schedules: RunSchedule[];
}

interface ParsedCronField {
  readonly min: number;
  readonly max: number;
  readonly values: Set<number>;
  readonly wildcard: boolean;
}

interface ParsedCron {
  minute: ParsedCronField;
  hour: ParsedCronField;
  dayOfMonth: ParsedCronField;
  month: ParsedCronField;
  dayOfWeek: ParsedCronField;
}

export class FileScheduleStore {
  private readonly filePath: string;

  constructor(path: string) {
    this.filePath = isAbsolute(path) ? path : resolve(process.cwd(), path);
  }

  list(): RunSchedule[] {
    return this.readState().schedules.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  get(id: string): RunSchedule | undefined {
    return this.readState().schedules.find((entry) => entry.id === id);
  }

  create(input: {
    name: string;
    cron: string;
    enabled?: boolean;
    target: ScheduleTarget;
  }): RunSchedule {
    validateTarget(input.target);
    validateCron(input.cron);

    const now = new Date();
    const nowIso = now.toISOString();
    const enabled = input.enabled ?? true;

    const schedule: RunSchedule = {
      id: `sch-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      name: input.name.trim() || 'Unnamed schedule',
      cron: input.cron.trim(),
      enabled,
      target: normalizeTarget(input.target),
      createdAt: nowIso,
      updatedAt: nowIso,
      nextRunAt: enabled
        ? nextRunAfter(input.cron, now).toISOString()
        : nowIso,
    };

    const state = this.readState();
    state.schedules.push(schedule);
    this.writeState(state);
    return schedule;
  }

  update(
    id: string,
    patch: Partial<Pick<RunSchedule, 'name' | 'cron' | 'enabled'>> & { target?: ScheduleTarget },
  ): RunSchedule {
    const state = this.readState();
    const schedule = state.schedules.find((entry) => entry.id === id);
    if (!schedule) {
      throw new Error(`Schedule not found: ${id}`);
    }

    const now = new Date();

    if (typeof patch.name === 'string') {
      schedule.name = patch.name.trim() || schedule.name;
    }

    if (typeof patch.cron === 'string') {
      validateCron(patch.cron);
      schedule.cron = patch.cron.trim();
    }

    if (typeof patch.enabled === 'boolean') {
      schedule.enabled = patch.enabled;
    }

    if (patch.target) {
      validateTarget(patch.target);
      schedule.target = normalizeTarget(patch.target);
    }

    schedule.updatedAt = now.toISOString();

    if (schedule.enabled) {
      schedule.nextRunAt = nextRunAfter(schedule.cron, now).toISOString();
    }

    this.writeState(state);
    return { ...schedule };
  }

  delete(id: string): boolean {
    const state = this.readState();
    const before = state.schedules.length;
    state.schedules = state.schedules.filter((entry) => entry.id !== id);
    if (state.schedules.length === before) {
      return false;
    }

    this.writeState(state);
    return true;
  }

  claimDue(now: Date = new Date()): RunSchedule[] {
    const state = this.readState();
    const due: RunSchedule[] = [];

    for (const schedule of state.schedules) {
      if (!schedule.enabled) {
        continue;
      }

      if (new Date(schedule.nextRunAt).getTime() > now.getTime()) {
        continue;
      }

      const runAt = now.toISOString();
      schedule.lastRunAt = runAt;
      schedule.updatedAt = runAt;
      schedule.nextRunAt = nextRunAfter(schedule.cron, now).toISOString();
      due.push({ ...schedule });
    }

    if (due.length > 0) {
      this.writeState(state);
    }

    return due;
  }

  private readState(): ScheduleStoreState {
    if (!existsSync(this.filePath)) {
      return { schedules: [] };
    }

    try {
      const raw = readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as ScheduleStoreState;
      if (!parsed || !Array.isArray(parsed.schedules)) {
        return { schedules: [] };
      }
      return { schedules: parsed.schedules };
    } catch {
      return { schedules: [] };
    }
  }

  private writeState(state: ScheduleStoreState): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.tmp`;
    writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    renameSync(temp, this.filePath);
  }
}

export function validateCron(cron: string): void {
  parseCron(cron);
}

export function nextRunAfter(cron: string, from: Date): Date {
  const parsed = parseCron(cron);
  const cursor = new Date(from.getTime());
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);

  for (let i = 0; i < 2 * 366 * 24 * 60; i += 1) {
    if (matches(parsed, cursor)) {
      return new Date(cursor.getTime());
    }
    cursor.setMinutes(cursor.getMinutes() + 1);
  }

  throw new Error(`Unable to compute next run time for cron: ${cron}`);
}

function matches(parsed: ParsedCron, date: Date): boolean {
  if (!parsed.minute.values.has(date.getMinutes())) {
    return false;
  }
  if (!parsed.hour.values.has(date.getHours())) {
    return false;
  }
  if (!parsed.month.values.has(date.getMonth() + 1)) {
    return false;
  }

  const dayOfMonthMatch = parsed.dayOfMonth.values.has(date.getDate());
  const dayOfWeekMatch = parsed.dayOfWeek.values.has(date.getDay());

  if (parsed.dayOfMonth.wildcard || parsed.dayOfWeek.wildcard) {
    return dayOfMonthMatch && dayOfWeekMatch;
  }

  return dayOfMonthMatch || dayOfWeekMatch;
}

function parseCron(cron: string): ParsedCron {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`Cron expression must have 5 fields. Received: ${cron}`);
  }

  return {
    minute: parseField(fields[0], 0, 59),
    hour: parseField(fields[1], 0, 23),
    dayOfMonth: parseField(fields[2], 1, 31),
    month: parseField(fields[3], 1, 12),
    dayOfWeek: parseField(fields[4], 0, 6, true),
  };
}

function parseField(rawField: string, min: number, max: number, mapSevenToZero = false): ParsedCronField {
  const field = rawField.trim();
  const values = new Set<number>();

  if (field === '*') {
    for (let value = min; value <= max; value += 1) {
      values.add(value);
    }
    return { min, max, values, wildcard: true };
  }

  const parts = field.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) {
    throw new Error(`Invalid cron field: ${field}`);
  }

  for (const part of parts) {
    if (/^\*\/\d+$/.test(part)) {
      const step = Number.parseInt(part.slice(2), 10);
      if (step <= 0) {
        throw new Error(`Invalid step value in cron field: ${part}`);
      }
      for (let value = min; value <= max; value += step) {
        values.add(mapDayOfWeek(value, mapSevenToZero));
      }
      continue;
    }

    const rangeMatch = /^(\d+)-(\d+)(?:\/(\d+))?$/.exec(part);
    if (rangeMatch) {
      const start = Number.parseInt(rangeMatch[1], 10);
      const end = Number.parseInt(rangeMatch[2], 10);
      const step = rangeMatch[3] ? Number.parseInt(rangeMatch[3], 10) : 1;
      if (step <= 0 || start > end) {
        throw new Error(`Invalid range in cron field: ${part}`);
      }
      for (let value = start; value <= end; value += step) {
        const mapped = mapDayOfWeek(value, mapSevenToZero);
        if (mapped < min || mapped > max) {
          throw new Error(`Cron value out of range: ${value}`);
        }
        values.add(mapped);
      }
      continue;
    }

    if (/^\d+$/.test(part)) {
      const value = mapDayOfWeek(Number.parseInt(part, 10), mapSevenToZero);
      if (value < min || value > max) {
        throw new Error(`Cron value out of range: ${part}`);
      }
      values.add(value);
      continue;
    }

    throw new Error(`Unsupported cron field token: ${part}`);
  }

  if (values.size === 0) {
    throw new Error(`Cron field resolved to no values: ${field}`);
  }

  return { min, max, values, wildcard: false };
}

function mapDayOfWeek(value: number, mapSevenToZero: boolean): number {
  if (mapSevenToZero && value === 7) {
    return 0;
  }
  return value;
}

function validateTarget(target: ScheduleTarget): void {
  if (target.type === 'jira') {
    if (!target.issueId) {
      throw new Error('Schedule target issueId is required for jira type');
    }
    return;
  }

  if (!target.repo || !target.prNumber) {
    throw new Error('Schedule target repo and prNumber are required for pull_request type');
  }
}

function normalizeTarget(target: ScheduleTarget): ScheduleTarget {
  if (target.type === 'jira') {
    return {
      type: 'jira',
      issueId: target.issueId?.trim(),
      serviceNowRecordId: target.serviceNowRecordId?.trim(),
      maxAttempts: target.maxAttempts,
    };
  }

  return {
    type: 'pull_request',
    repo: target.repo?.trim(),
    prNumber: target.prNumber?.trim(),
    serviceNowRecordId: target.serviceNowRecordId?.trim(),
    maxAttempts: target.maxAttempts,
  };
}
