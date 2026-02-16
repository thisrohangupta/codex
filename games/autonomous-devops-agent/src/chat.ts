export type ChatCommand =
  | { type: 'help' }
  | { type: 'status' }
  | { type: 'events' }
  | { type: 'auth'; provider: 'jira' | 'github' }
  | { type: 'auth-status' }
  | { type: 'exit' }
  | { type: 'run-jira'; issueId: string }
  | { type: 'run-pr'; repo: string; prNumber: string }
  | { type: 'set-snow'; recordId: string }
  | { type: 'unknown'; raw: string };

export function parseChatCommand(input: string): ChatCommand {
  const trimmed = input.trim();
  if (!trimmed) {
    return { type: 'unknown', raw: input };
  }

  const normalized = trimmed.toLowerCase();
  if (normalized === 'help' || normalized === '/help') {
    return { type: 'help' };
  }

  if (normalized === 'status' || normalized === '/status') {
    return { type: 'status' };
  }

  if (normalized === 'events' || normalized === '/events') {
    return { type: 'events' };
  }

  if (normalized === 'auth status' || normalized === '/auth status') {
    return { type: 'auth-status' };
  }

  if (['exit', 'quit', '/exit', '/quit'].includes(normalized)) {
    return { type: 'exit' };
  }

  const authMatch = /^\/?auth\s+(jira|github)$/i.exec(trimmed);
  if (authMatch) {
    return { type: 'auth', provider: authMatch[1].toLowerCase() as 'jira' | 'github' };
  }

  const snowMatch = /^\/?snow\s+([A-Za-z0-9_-]+)$/i.exec(trimmed);
  if (snowMatch) {
    return { type: 'set-snow', recordId: snowMatch[1] };
  }

  const jiraMatch = /^(?:\/)?(?:run|start|trigger)\s+jira\s+([A-Z][A-Z0-9]+-\d+)$/i.exec(trimmed);
  if (jiraMatch) {
    return { type: 'run-jira', issueId: jiraMatch[1].toUpperCase() };
  }

  const jiraInSentence = /\b([A-Z][A-Z0-9]+-\d+)\b/.exec(trimmed);
  if (jiraInSentence && /\b(run|start|trigger|execute|work)\b/i.test(trimmed)) {
    return { type: 'run-jira', issueId: jiraInSentence[1].toUpperCase() };
  }

  const prMatch = /^(?:\/)?(?:run|start|trigger)\s+pr\s+([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#(\d+)$/i.exec(
    trimmed,
  );
  if (prMatch) {
    return { type: 'run-pr', repo: prMatch[1], prNumber: prMatch[2] };
  }

  const prInSentence =
    /\b([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#(\d+)\b/.exec(trimmed);
  if (prInSentence && /\b(run|start|trigger|execute|work)\b/i.test(trimmed)) {
    return { type: 'run-pr', repo: prInSentence[1], prNumber: prInSentence[2] };
  }

  return { type: 'unknown', raw: input };
}

export function helpText(): string {
  return [
    'Commands:',
    '  help                            Show this help',
    '  status                          Show runtime mode/configuration',
    '  auth github                     Start GitHub OAuth and persist token',
    '  auth jira                       Start Jira OAuth and persist token',
    '  auth status                     Show stored OAuth token status',
    '  events                          Show event history from this chat session',
    '  run jira DEV-123                Fetch Jira issue and execute the agent',
    '  run pr owner/repo#42            Fetch GitHub PR and execute the agent',
    '  snow INC0012345                 Set default ServiceNow record for next runs',
    '  exit                            Exit the chat session',
  ].join('\n');
}
