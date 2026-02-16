import type { AgentContext, WorkItem } from './types.js';

export type DeploymentPolicyMode = 'auto' | 'approval';

export const MANUAL_APPROVAL_NOTE = 'Manual approval required for production deployment';

export interface DeploymentPolicy {
  readonly mode: DeploymentPolicyMode;
  requiresManualApproval(input: WorkItem, context: AgentContext): boolean;
}

class StaticDeploymentPolicy implements DeploymentPolicy {
  constructor(readonly mode: DeploymentPolicyMode) {}

  requiresManualApproval(input: WorkItem): boolean {
    if (this.mode !== 'approval') {
      return false;
    }

    return input.metadata?.approvalOverride !== 'true';
  }
}

export function createDeploymentPolicy(mode: DeploymentPolicyMode): DeploymentPolicy {
  return new StaticDeploymentPolicy(mode);
}
