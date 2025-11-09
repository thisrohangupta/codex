export type Capability = "DevOps" | "AppSec" | "FinOps";

export interface PipelineStep {
  id: string;
  title: string;
  summary: string;
  capability: Capability;
  agent: string;
  command: string;
  estimatedMinutes: number;
  successCriteria: string;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  category: Capability;
  trigger: string;
  successCriteria: string;
  estimatedDurationMinutes: number;
  steps: PipelineStep[];
}

export type StepStatus = "idle" | "pending" | "running" | "succeeded";

export interface StepRunState {
  step: PipelineStep;
  status: StepStatus;
  startedAt?: number;
  completedAt?: number;
  logs: string[];
}

export interface PipelineRunState {
  status: "idle" | "running" | "succeeded";
  steps: StepRunState[];
  currentStepIndex: number;
  startedAt?: number;
  completedAt?: number;
}
