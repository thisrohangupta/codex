type UnknownRecord = Record<string, unknown>;

interface QueueItem {
  id: string;
  type: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  resultStatus?: string;
  lastError?: string;
}

interface ApprovalItem {
  id: string;
  status: string;
  type: string;
  issueId?: string;
  repo?: string;
  prNumber?: string;
  reason?: string;
}

interface ScheduleItem {
  id: string;
  name: string;
  cron: string;
  enabled: boolean;
  nextRunAt?: string;
  target?: UnknownRecord;
}

interface UiState {
  baseUrl: string;
  autoRefresh: boolean;
  timer?: ReturnType<typeof setInterval>;
  recentOutputs: string[];
}

const STORAGE_KEY = 'agentic-devops-ui.base-url';

const state: UiState = {
  baseUrl: localStorage.getItem(STORAGE_KEY) ?? 'http://127.0.0.1:8790',
  autoRefresh: true,
  recentOutputs: [],
};

const baseUrlInput = byId<HTMLInputElement>('baseUrlInput');
const healthBadge = byId<HTMLSpanElement>('healthBadge');
const autoRefreshToggle = byId<HTMLInputElement>('autoRefreshToggle');
const outputArea = byId<HTMLPreElement>('outputArea');

const jiraIssueInput = byId<HTMLInputElement>('jiraIssueInput');
const jiraSnowInput = byId<HTMLInputElement>('jiraSnowInput');
const repoInput = byId<HTMLInputElement>('repoInput');
const prNumberInput = byId<HTMLInputElement>('prNumberInput');
const prSnowInput = byId<HTMLInputElement>('prSnowInput');

const approvalsBody = byId<HTMLTableSectionElement>('approvalsBody');
const queueBody = byId<HTMLTableSectionElement>('queueBody');
const schedulesBody = byId<HTMLTableSectionElement>('schedulesBody');

const scheduleTypeSelect = byId<HTMLSelectElement>('scheduleTypeSelect');
const scheduleJiraFields = byId<HTMLElement>('scheduleJiraFields');
const schedulePrFields = byId<HTMLElement>('schedulePrFields');
const scheduleNameInput = byId<HTMLInputElement>('scheduleNameInput');
const scheduleCronInput = byId<HTMLInputElement>('scheduleCronInput');
const scheduleIssueInput = byId<HTMLInputElement>('scheduleIssueInput');
const scheduleRepoInput = byId<HTMLInputElement>('scheduleRepoInput');
const schedulePrInput = byId<HTMLInputElement>('schedulePrInput');
const scheduleForm = byId<HTMLFormElement>('scheduleForm');

init();

function init(): void {
  baseUrlInput.value = state.baseUrl;
  autoRefreshToggle.checked = state.autoRefresh;

  byId<HTMLButtonElement>('connectBtn').addEventListener('click', async () => {
    applyBaseUrl();
    await refreshAll();
  });
  byId<HTMLButtonElement>('refreshAllBtn').addEventListener('click', refreshAll);
  byId<HTMLButtonElement>('reloadRuntimeBtn').addEventListener('click', reloadRuntime);
  byId<HTMLButtonElement>('clearOutputBtn').addEventListener('click', () => {
    state.recentOutputs = [];
    outputArea.textContent = 'No responses yet.';
  });

  byId<HTMLButtonElement>('runJiraBtn').addEventListener('click', () => runOrQueueJira('run'));
  byId<HTMLButtonElement>('queueJiraBtn').addEventListener('click', () => runOrQueueJira('queue'));
  byId<HTMLButtonElement>('probeJiraBtn').addEventListener('click', () => runOrQueueJira('probe'));

  byId<HTMLButtonElement>('runPrBtn').addEventListener('click', () => runOrQueuePr('run'));
  byId<HTMLButtonElement>('queuePrBtn').addEventListener('click', () => runOrQueuePr('queue'));
  byId<HTMLButtonElement>('probePrBtn').addEventListener('click', () => runOrQueuePr('probe'));

  byId<HTMLButtonElement>('refreshQueueBtn').addEventListener('click', refreshQueue);
  byId<HTMLButtonElement>('refreshApprovalsBtn').addEventListener('click', refreshApprovals);
  byId<HTMLButtonElement>('refreshSchedulesBtn').addEventListener('click', refreshSchedules);

  autoRefreshToggle.addEventListener('change', () => {
    state.autoRefresh = autoRefreshToggle.checked;
    refreshTimerState();
  });

  scheduleTypeSelect.addEventListener('change', renderScheduleTargetFields);
  scheduleForm.addEventListener('submit', createSchedule);

  approvalsBody.addEventListener('click', handleApprovalAction);
  schedulesBody.addEventListener('click', handleScheduleAction);

  renderScheduleTargetFields();
  refreshTimerState();
  void refreshAll();
}

function refreshTimerState(): void {
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = undefined;
  }

  if (!state.autoRefresh) {
    return;
  }

  state.timer = setInterval(() => {
    void refreshLightweight();
  }, 5000);
}

function applyBaseUrl(): void {
  state.baseUrl = normalizeBaseUrl(baseUrlInput.value);
  baseUrlInput.value = state.baseUrl;
  localStorage.setItem(STORAGE_KEY, state.baseUrl);
}

async function refreshAll(): Promise<void> {
  applyBaseUrl();
  const tasks = [refreshHealth(), refreshQueue(), refreshApprovals(), refreshSchedules()];
  await Promise.all(tasks.map((task) => task.catch((error) => appendOutput('Refresh Error', { error: asError(error) }))));
}

async function refreshLightweight(): Promise<void> {
  const tasks = [refreshHealth(), refreshQueue(), refreshApprovals(), refreshSchedules()];
  await Promise.all(tasks.map((task) => task.catch(() => undefined)));
}

async function refreshHealth(): Promise<void> {
  const payload = await requestJson<UnknownRecord>('/health', { method: 'GET' });
  const ok = Boolean(payload.ok);
  healthBadge.textContent = ok ? 'online' : 'offline';
  healthBadge.className = `badge ${ok ? 'ok' : 'error'}`;
}

async function reloadRuntime(): Promise<void> {
  const payload = await requestJson<UnknownRecord>('/runtime/reload', { method: 'POST' });
  appendOutput('Runtime Reloaded', payload);
  await refreshHealth();
}

async function refreshQueue(): Promise<void> {
  const payload = await requestJson<UnknownRecord>('/queue', { method: 'GET' });
  const items = asArray(payload.items).map(asQueueItem);
  queueBody.innerHTML = items.length > 0
    ? items.map(renderQueueRow).join('')
    : `<tr><td colspan="5" class="empty">No queue items loaded</td></tr>`;
}

async function refreshApprovals(): Promise<void> {
  const payload = await requestJson<UnknownRecord>('/approvals', { method: 'GET' });
  const approvals = asArray(payload.approvals).map(asApprovalItem);
  approvalsBody.innerHTML = approvals.length > 0
    ? approvals.map(renderApprovalRow).join('')
    : `<tr><td colspan="5" class="empty">No approvals loaded</td></tr>`;
}

async function refreshSchedules(): Promise<void> {
  const payload = await requestJson<UnknownRecord>('/schedules', { method: 'GET' });
  const schedules = asArray(payload.schedules).map(asScheduleItem);
  schedulesBody.innerHTML = schedules.length > 0
    ? schedules.map(renderScheduleRow).join('')
    : `<tr><td colspan="5" class="empty">No schedules loaded</td></tr>`;
}

async function runOrQueueJira(mode: 'run' | 'queue' | 'probe'): Promise<void> {
  const issueId = jiraIssueInput.value.trim().toUpperCase();
  if (!issueId) {
    appendOutput('Input Error', { error: 'Issue ID is required.' });
    return;
  }

  const serviceNowRecordId = jiraSnowInput.value.trim();
  const body: UnknownRecord = { issueId };
  if (serviceNowRecordId) {
    body.serviceNowRecordId = serviceNowRecordId;
  }

  const endpoint = mode === 'run' ? '/runs/jira' : mode === 'queue' ? '/queue/jira' : '/probe/jira';
  const payload = await requestJson<UnknownRecord>(endpoint, {
    method: 'POST',
    body: JSON.stringify(body),
  });

  appendOutput(`Jira ${mode.toUpperCase()}`, payload);
  await refreshAll();
}

async function runOrQueuePr(mode: 'run' | 'queue' | 'probe'): Promise<void> {
  const repo = repoInput.value.trim();
  const prNumber = prNumberInput.value.trim();
  if (!repo || !prNumber) {
    appendOutput('Input Error', { error: 'Repo and PR number are required.' });
    return;
  }

  const serviceNowRecordId = prSnowInput.value.trim();
  const body: UnknownRecord = { repo, prNumber };
  if (serviceNowRecordId) {
    body.serviceNowRecordId = serviceNowRecordId;
  }

  const endpoint = mode === 'run' ? '/runs/pr' : mode === 'queue' ? '/queue/pr' : '/probe/pr';
  const payload = await requestJson<UnknownRecord>(endpoint, {
    method: 'POST',
    body: JSON.stringify(body),
  });

  appendOutput(`PR ${mode.toUpperCase()}`, payload);
  await refreshAll();
}

function renderScheduleTargetFields(): void {
  if (scheduleTypeSelect.value === 'jira') {
    scheduleJiraFields.classList.remove('hidden');
    schedulePrFields.classList.add('hidden');
    return;
  }

  scheduleJiraFields.classList.add('hidden');
  schedulePrFields.classList.remove('hidden');
}

async function createSchedule(event: SubmitEvent): Promise<void> {
  event.preventDefault();

  const name = scheduleNameInput.value.trim();
  const cron = scheduleCronInput.value.trim();
  const type = scheduleTypeSelect.value;
  if (!name || !cron) {
    appendOutput('Input Error', { error: 'Schedule name and cron are required.' });
    return;
  }

  const body: UnknownRecord = { name, cron };
  if (type === 'jira') {
    const issueId = scheduleIssueInput.value.trim().toUpperCase();
    if (!issueId) {
      appendOutput('Input Error', { error: 'Issue ID is required for Jira schedules.' });
      return;
    }
    body.type = 'jira';
    body.issueId = issueId;
  } else {
    const repo = scheduleRepoInput.value.trim();
    const prNumber = schedulePrInput.value.trim();
    if (!repo || !prNumber) {
      appendOutput('Input Error', { error: 'Repo and PR number are required for PR schedules.' });
      return;
    }
    body.type = 'pull_request';
    body.repo = repo;
    body.prNumber = prNumber;
  }

  const payload = await requestJson<UnknownRecord>('/schedules', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  appendOutput('Schedule Created', payload);
  await refreshSchedules();
}

async function handleApprovalAction(event: Event): Promise<void> {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) {
    return;
  }

  const action = target.dataset.action;
  const id = target.dataset.id;
  if (!action || !id) {
    return;
  }

  if (action === 'approve') {
    const approvedBy = window.prompt('Approved by:', 'architect')?.trim();
    const payload = await requestJson<UnknownRecord>(`/approvals/${encodeURIComponent(id)}/approve`, {
      method: 'POST',
      body: JSON.stringify({ approvedBy: approvedBy || 'operator' }),
    });
    appendOutput('Approval Approved', payload);
    await refreshAll();
    return;
  }

  if (action === 'reject') {
    const rejectedBy = window.prompt('Rejected by:', 'operator')?.trim();
    const reason = window.prompt('Rejection reason:', 'Blocked by manual review')?.trim();
    const payload = await requestJson<UnknownRecord>(`/approvals/${encodeURIComponent(id)}/reject`, {
      method: 'POST',
      body: JSON.stringify({
        rejectedBy: rejectedBy || 'operator',
        reason: reason || 'Rejected from UI',
      }),
    });
    appendOutput('Approval Rejected', payload);
    await refreshApprovals();
  }
}

async function handleScheduleAction(event: Event): Promise<void> {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) {
    return;
  }

  const action = target.dataset.action;
  const id = target.dataset.id;
  if (!action || !id) {
    return;
  }

  if (action === 'run-now') {
    const payload = await requestJson<UnknownRecord>(`/schedules/${encodeURIComponent(id)}/run-now`, {
      method: 'POST',
    });
    appendOutput('Schedule Run Triggered', payload);
    await refreshAll();
    return;
  }

  if (action === 'toggle') {
    const enabled = target.dataset.enabled === 'true';
    const payload = await requestJson<UnknownRecord>(`/schedules/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled: !enabled }),
    });
    appendOutput('Schedule Updated', payload);
    await refreshSchedules();
    return;
  }

  if (action === 'delete') {
    const confirmed = window.confirm(`Delete schedule ${id}?`);
    if (!confirmed) {
      return;
    }
    const payload = await requestJson<UnknownRecord>(`/schedules/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    appendOutput('Schedule Deleted', payload);
    await refreshSchedules();
  }
}

function renderQueueRow(item: QueueItem): string {
  return `
    <tr>
      <td><code>${escapeHtml(short(item.id))}</code></td>
      <td>${escapeHtml(item.status)}</td>
      <td>${escapeHtml(item.type)}</td>
      <td>${item.attempts}/${item.maxAttempts}</td>
      <td>${escapeHtml(item.resultStatus ?? item.lastError ?? '-')}</td>
    </tr>
  `;
}

function renderApprovalRow(item: ApprovalItem): string {
  const subject = item.type === 'jira'
    ? item.issueId ?? '-'
    : `${item.repo ?? '-'}#${item.prNumber ?? '-'}`;
  const actions = item.status === 'pending'
    ? `
      <button type="button" class="secondary" data-action="approve" data-id="${escapeHtml(item.id)}">Approve</button>
      <button type="button" class="danger" data-action="reject" data-id="${escapeHtml(item.id)}">Reject</button>
    `
    : '<span class="muted">Closed</span>';

  return `
    <tr>
      <td><code>${escapeHtml(short(item.id))}</code></td>
      <td>${escapeHtml(item.status)}</td>
      <td>${escapeHtml(item.type)}</td>
      <td>${escapeHtml(subject)}</td>
      <td>${actions}</td>
    </tr>
  `;
}

function renderScheduleRow(item: ScheduleItem): string {
  const targetType = typeof item.target?.type === 'string' ? item.target.type : 'unknown';
  const toggleLabel = item.enabled ? 'Disable' : 'Enable';

  return `
    <tr>
      <td>${escapeHtml(item.name)}</td>
      <td><code>${escapeHtml(item.cron)}</code></td>
      <td>${escapeHtml(targetType)}</td>
      <td>${escapeHtml(item.nextRunAt ?? '-')}</td>
      <td>
        <button type="button" class="secondary" data-action="run-now" data-id="${escapeHtml(item.id)}">Run Now</button>
        <button type="button" class="warn" data-action="toggle" data-id="${escapeHtml(item.id)}" data-enabled="${String(item.enabled)}">${toggleLabel}</button>
        <button type="button" class="danger" data-action="delete" data-id="${escapeHtml(item.id)}">Delete</button>
      </td>
    </tr>
  `;
}

async function requestJson<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${state.baseUrl}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

  const raw = await response.text();
  const payload = parseJson(raw);
  if (!response.ok) {
    const errorMessage = asString((payload as UnknownRecord).error) ??
      `HTTP ${response.status} ${response.statusText}`;
    throw new Error(errorMessage);
  }

  return payload as T;
}

function parseJson(value: string): unknown {
  if (!value.trim()) {
    return {};
  }
  try {
    return JSON.parse(value);
  } catch {
    return { raw: value };
  }
}

function appendOutput(title: string, payload: unknown): void {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${title}\n${JSON.stringify(payload, null, 2)}`;
  state.recentOutputs = [line, ...state.recentOutputs].slice(0, 8);
  outputArea.textContent = state.recentOutputs.join('\n\n---\n\n');
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asQueueItem(value: unknown): QueueItem {
  const entry = asRecord(value);
  return {
    id: asString(entry.id) ?? 'unknown',
    type: asString(entry.type) ?? 'unknown',
    status: asString(entry.status) ?? 'unknown',
    attempts: asNumber(entry.attempts),
    maxAttempts: asNumber(entry.maxAttempts),
    resultStatus: asString(entry.resultStatus),
    lastError: asString(entry.lastError),
  };
}

function asApprovalItem(value: unknown): ApprovalItem {
  const entry = asRecord(value);
  return {
    id: asString(entry.id) ?? 'unknown',
    status: asString(entry.status) ?? 'unknown',
    type: asString(entry.type) ?? 'unknown',
    issueId: asString(entry.issueId),
    repo: asString(entry.repo),
    prNumber: asString(entry.prNumber),
    reason: asString(entry.reason),
  };
}

function asScheduleItem(value: unknown): ScheduleItem {
  const entry = asRecord(value);
  return {
    id: asString(entry.id) ?? 'unknown',
    name: asString(entry.name) ?? 'unnamed',
    cron: asString(entry.cron) ?? 'unknown',
    enabled: Boolean(entry.enabled),
    nextRunAt: asString(entry.nextRunAt),
    target: asRecord(entry.target),
  };
}

function asRecord(value: unknown): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as UnknownRecord;
}

function asNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}

function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return 'http://127.0.0.1:8790';
  }
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
}

function asError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return 'unknown error';
}

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing required element: ${id}`);
  }
  return element as T;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function short(value: string): string {
  if (value.length <= 18) {
    return value;
  }
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}
