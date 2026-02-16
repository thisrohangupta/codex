import { runAgentTests } from './agent.test.js';
import { runChatTests } from './chat.test.js';
import { runMainTests } from './main.test.js';
import { runRuntimeTests } from './runtime.test.js';
import { runUtilityTests } from './utils.test.js';

async function run(): Promise<void> {
  await runMainTests();
  await runUtilityTests();
  await runChatTests();
  await runRuntimeTests();
  await runAgentTests();
  console.log('All tests passed');
}

await run();
