import { helpText, parseChatCommand } from '../src/chat.js';
import { assertEqual, assertTrue } from './test-helpers.js';

export async function runChatTests(): Promise<void> {
  const jira = parseChatCommand('run jira DEV-42');
  assertEqual(jira.type, 'run-jira', 'jira command should parse');
  if (jira.type === 'run-jira') {
    assertEqual(jira.issueId, 'DEV-42', 'jira command should include issue id');
  }

  const pr = parseChatCommand('run pr acme/service#19');
  assertEqual(pr.type, 'run-pr', 'pull request command should parse');
  if (pr.type === 'run-pr') {
    assertEqual(pr.repo, 'acme/service', 'pull request command should capture repo');
    assertEqual(pr.prNumber, '19', 'pull request command should capture PR number');
  }

  const naturalJira = parseChatCommand('Please start work on DEV-999 now');
  assertEqual(naturalJira.type, 'run-jira', 'natural language jira command should parse');

  const naturalPr = parseChatCommand('execute work for acme/service#56');
  assertEqual(naturalPr.type, 'run-pr', 'natural language pull request command should parse');

  const snow = parseChatCommand('snow INC0012345');
  assertEqual(snow.type, 'set-snow', 'service now command should parse');

  const authGithub = parseChatCommand('auth github');
  assertEqual(authGithub.type, 'auth', 'auth github command should parse');

  const authStatus = parseChatCommand('auth status');
  assertEqual(authStatus.type, 'auth-status', 'auth status command should parse');

  const probeJira = parseChatCommand('probe targets jira DEV-500');
  assertEqual(probeJira.type, 'probe-targets-jira', 'target probe jira command should parse');
  if (probeJira.type === 'probe-targets-jira') {
    assertEqual(probeJira.issueId, 'DEV-500', 'target probe jira should include issue id');
  }

  const probePr = parseChatCommand('probe targets pr acme/service#77');
  assertEqual(probePr.type, 'probe-targets-pr', 'target probe pr command should parse');
  if (probePr.type === 'probe-targets-pr') {
    assertEqual(probePr.repo, 'acme/service', 'target probe pr should include repo');
    assertEqual(probePr.prNumber, '77', 'target probe pr should include PR number');
  }

  const unknown = parseChatCommand('run this now');
  assertEqual(unknown.type, 'unknown', 'non-command text should be unknown');

  const help = helpText();
  assertTrue(help.includes('run jira DEV-123'), 'help should include jira run example');
  assertTrue(help.includes('probe targets jira DEV-123'), 'help should include target probe command');
}
