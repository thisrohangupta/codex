import { createDefaultAgent } from '../src/main.js';
import { assertEqual, assertTrue } from './test-helpers.js';

export async function runMainTests(): Promise<void> {
  const agent = createDefaultAgent();
  const result = await agent.run({
    id: 'DEV-101',
    kind: 'jira',
    title: 'Create deployment automation',
    body: 'Implement automation for dev and prod release flow',
    repo: 'acme/platform-service',
    branch: 'feature/deployment-automation',
  });

  assertTrue(result.runId.includes('jira-DEV-101'), 'default agent run id should include source id');
  assertEqual(result.plan.length, 8, 'default plan should include 8 workflow steps');
  assertTrue(agent.events.list().length > 0, 'default agent should emit execution events');
}
