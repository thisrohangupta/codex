import { runAgentTests } from './agent.test.js';
import { runApprovalTests } from './approvals.test.js';
import { runChatTests } from './chat.test.js';
import { runConfigTests } from './config.test.js';
import { runDeploymentTargetTests } from './deployment-targets.test.js';
import { runMainTests } from './main.test.js';
import { runOAuthTests } from './oauth.test.js';
import { runQueueTests } from './queue.test.js';
import { runRuntimeTests } from './runtime.test.js';
import { runScheduleTests } from './schedule.test.js';
import { runUtilityTests } from './utils.test.js';

async function run(): Promise<void> {
  await runMainTests();
  await runConfigTests();
  await runUtilityTests();
  await runChatTests();
  await runDeploymentTargetTests();
  await runApprovalTests();
  await runOAuthTests();
  await runQueueTests();
  await runScheduleTests();
  await runRuntimeTests();
  await runAgentTests();
  console.log('All tests passed');
}

await run();
