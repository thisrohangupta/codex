import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createTargetCommands,
  inferDeploymentTargets,
  parseDeploymentTargets,
  selectTargetsForEnvironment,
} from '../src/deployment-targets.js';
import { assertEqual, assertRejects, assertTrue } from './test-helpers.js';

export async function runDeploymentTargetTests(): Promise<void> {
  await testTargetParsingAndSelection();
  await testTargetParsingValidation();
  await testTargetCommandGeneration();
  await testTargetInference();
}

async function testTargetParsingAndSelection(): Promise<void> {
  const targets = parseDeploymentTargets(
    JSON.stringify([
      { name: 'dev-k8s', type: 'kubernetes', environments: ['dev'], manifestPath: 'k8s/dev' },
      { name: 'prod-helm', type: 'helm', environments: ['prod'], chartPath: 'helm' },
    ]),
  );

  assertEqual(targets.length, 2, 'target parser should load two targets');
  assertEqual(selectTargetsForEnvironment(targets, 'dev').length, 1, 'dev filter should match one target');
  assertEqual(
    selectTargetsForEnvironment(targets, 'prod')[0]?.name,
    'prod-helm',
    'prod filter should return helm target',
  );
}

async function testTargetParsingValidation(): Promise<void> {
  await assertRejects(
    Promise.resolve().then(() => parseDeploymentTargets('{')),
    'not valid JSON',
    'parser should reject invalid JSON input',
  );

  await assertRejects(
    Promise.resolve().then(() => parseDeploymentTargets(JSON.stringify([{ name: 'x', type: 'unknown' }]))),
    'unsupported type',
    'parser should reject unsupported target types',
  );
}

async function testTargetCommandGeneration(): Promise<void> {
  const helm = createTargetCommands(
    {
      name: 'prod-helm',
      type: 'helm',
      chartPath: 'helm',
      valuesFile: 'helm/values.prod.yaml',
      releaseName: 'platform-service',
      namespace: 'prod',
    },
    {
      environment: 'prod',
      workspacePath: '/tmp/workspace',
      deploymentConfigPath: '/tmp/workspace/deploy',
    },
  );

  assertTrue(
    helm.deployCommand.includes('helm upgrade --install'),
    'helm target should produce helm deploy command',
  );
  assertTrue(helm.validateCommand?.includes('helm status') ?? false, 'helm target should produce validate command');

  const lambda = createTargetCommands(
    {
      name: 'fn',
      type: 'aws-lambda',
      functionName: 'process-event',
      region: 'us-east-1',
      binaryPath: 'dist/function.zip',
    },
    {
      environment: 'prod',
      workspacePath: '/tmp/workspace',
      deploymentConfigPath: '/tmp/workspace/deploy',
    },
  );

  assertTrue(
    lambda.deployCommand.includes('aws lambda update-function-code'),
    'lambda target should produce aws lambda deploy command',
  );
}

async function testTargetInference(): Promise<void> {
  const temp = mkdtempSync(join(tmpdir(), 'agent-target-infer-'));
  mkdirSync(join(temp, 'helm'), { recursive: true });
  writeFileSync(join(temp, 'helm', 'Chart.yaml'), 'apiVersion: v2\nname: demo\n', 'utf8');
  mkdirSync(join(temp, 'k8s', 'overlays', 'dev'), { recursive: true });
  writeFileSync(join(temp, 'k8s', 'overlays', 'dev', 'deployment.yaml'), 'kind: Deployment\n', 'utf8');

  const inferred = inferDeploymentTargets(temp, 'dev');
  assertTrue(inferred.some((entry) => entry.type === 'helm'), 'inference should detect helm');
  assertTrue(inferred.some((entry) => entry.type === 'kubernetes'), 'inference should detect kubernetes');
}
