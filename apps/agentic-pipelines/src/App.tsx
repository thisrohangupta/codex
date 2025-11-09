import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PipelineRunPanel } from "./components/pipeline/pipeline-run-panel";
import { WorkflowPicker } from "./components/pipeline/workflow-picker";
import type {
  PipelineRunState,
  PipelineStep,
  StepRunState,
  Workflow
} from "./components/pipeline/types";
import { Badge } from "./components/ui/badge";
import { Separator } from "./components/ui/separator";
import { Layers, LineChart, ShieldCheck, Sparkles } from "lucide-react";

const workflows: Workflow[] = [
  {
    id: "cloud-release",
    name: "Cloud Release Autopilot",
    description:
      "Progressively deploy services with environment drift detection, gated rollouts, and automated health verification.",
    category: "DevOps",
    trigger: "Git push to main / codex-cli deploy --env production",
    successCriteria: "Blue/green cutover with zero failed health checks across regions",
    estimatedDurationMinutes: 18,
    steps: [
      {
        id: "plan-release",
        title: "Compile deployment plan",
        summary: "Evaluate infrastructure drift, generate deployment manifest, and notify change advisory.",
        capability: "DevOps",
        agent: "Atlas DevOps",
        command: "codex-cli deploy plan --env production --drift-detection",
        estimatedMinutes: 4,
        successCriteria: "Change set approved with no critical drift detected"
      },
      {
        id: "security-scan",
        title: "Enforce release security gates",
        summary: "Run SBOM diff, secrets scan, and package signature verification before rollout.",
        capability: "AppSec",
        agent: "Sentinel AppSec",
        command: "codex-cli appsec verify --release $GIT_SHA --policy prod",
        estimatedMinutes: 5,
        successCriteria: "All policies satisfied; zero critical vulnerabilities"
      },
      {
        id: "progressive-rollout",
        title: "Execute progressive rollout",
        summary: "Automate canary, analyze live metrics, and promote traffic across clusters.",
        capability: "DevOps",
        agent: "Atlas DevOps",
        command: "codex-cli deploy rollout --strategy canary --env production",
        estimatedMinutes: 6,
        successCriteria: "Canary promoted with SLO error budget intact"
      },
      {
        id: "post-deploy",
        title: "Post-deploy validation",
        summary: "Run smoke tests, capture dashboards, and archive deployment transcript.",
        capability: "DevOps",
        agent: "Observer QA",
        command: "codex-cli qa verify --suite smoke --env production",
        estimatedMinutes: 3,
        successCriteria: "Synthetic transactions succeed and monitoring baselines restored"
      }
    ]
  },
  {
    id: "secure-supply-chain",
    name: "Secure Supply Chain",
    description:
      "Continuously harden the software supply chain with provenance capture, policy enforcement, and runtime attestation.",
    category: "AppSec",
    trigger: "Nightly codex-cli compliance run",
    successCriteria: "Artifacts signed, provenance stored, and runtime baselines updated",
    estimatedDurationMinutes: 22,
    steps: [
      {
        id: "sbom-generate",
        title: "Generate and diff SBOM",
        summary: "Produce software bill of materials, compare to baseline, and flag drift.",
        capability: "AppSec",
        agent: "Sentinel AppSec",
        command: "codex-cli appsec sbom --module api --fail-on drift",
        estimatedMinutes: 6,
        successCriteria: "SBOM diff acknowledged with no unvetted components"
      },
      {
        id: "runtime-scan",
        title: "Runtime sensor sweep",
        summary: "Scan running workloads for CVEs, misconfigurations, and leaked secrets.",
        capability: "AppSec",
        agent: "Guardian Runtime",
        command: "codex-cli runtime scan --workload api --deep",
        estimatedMinutes: 5,
        successCriteria: "No critical runtime findings remain open"
      },
      {
        id: "policy-enforce",
        title: "Policy enforcement snapshot",
        summary: "Validate OPA policies, admission controllers, and infrastructure guardrails.",
        capability: "DevOps",
        agent: "Atlas DevOps",
        command: "codex-cli policy evaluate --bundle supply-chain --env prod",
        estimatedMinutes: 5,
        successCriteria: "Cluster policies validated with full compliance"
      },
      {
        id: "attestation",
        title: "Publish attestation",
        summary: "Sign build outputs, push to provenance ledger, and notify auditors.",
        capability: "AppSec",
        agent: "Sentinel AppSec",
        command: "codex-cli attest release --target api --channel auditors",
        estimatedMinutes: 6,
        successCriteria: "Attestation recorded with traceable provenance"
      }
    ]
  },
  {
    id: "finops-guardrails",
    name: "FinOps Guardrails",
    description:
      "Monitor spend, forecast burn, and orchestrate remediation actions across multi-cloud workloads.",
    category: "FinOps",
    trigger: "Hourly codex-cli cost monitor",
    successCriteria: "Spend forecasts updated with automated savings actions executed",
    estimatedDurationMinutes: 16,
    steps: [
      {
        id: "ingest-costs",
        title: "Ingest live cost feeds",
        summary: "Pull billing exports, normalize tags, and enrich with usage context.",
        capability: "FinOps",
        agent: "Ledger FinOps",
        command: "codex-cli finops ingest --sources aws,gcp --window 1h",
        estimatedMinutes: 4,
        successCriteria: "Unified dataset published with cost anomalies labeled"
      },
      {
        id: "forecast",
        title: "Forecast burn down",
        summary: "Apply ML forecast, compute savings opportunities, and flag outliers.",
        capability: "FinOps",
        agent: "Ledger FinOps",
        command: "codex-cli finops forecast --horizon 30d --scenario proactive",
        estimatedMinutes: 4,
        successCriteria: "Forecast variance within 3% of historical accuracy"
      },
      {
        id: "optimize",
        title: "Automate optimization playbooks",
        summary: "Right-size workloads, schedule idle resources, and push IaC merge requests.",
        capability: "DevOps",
        agent: "Atlas DevOps",
        command: "codex-cli finops optimize --apply --channels sre,owners",
        estimatedMinutes: 5,
        successCriteria: "Optimization tasks executed with owner acknowledgement"
      },
      {
        id: "report",
        title: "Broadcast executive digest",
        summary: "Publish savings report, update dashboard tiles, and send executive summary.",
        capability: "FinOps",
        agent: "Ledger FinOps",
        command: "codex-cli finops report --audience exec --format pdf",
        estimatedMinutes: 3,
        successCriteria: "Stakeholders receive actionable savings digest"
      }
    ]
  }
];

const PIPELINE_DELAY_FACTOR_MS = 350;

function createIdleRunState(): PipelineRunState {
  return {
    status: "idle",
    steps: [],
    currentStepIndex: 0
  };
}

function createStartLogs(step: PipelineStep): string[] {
  return [
    `🚀 Launching ${step.agent} (${step.capability})`,
    `🔧 Executing command: ${step.command}`,
    `🎯 Success criteria: ${step.successCriteria}`
  ];
}

function createCompletionLogs(step: PipelineStep): string[] {
  return [
    `✅ ${step.agent} completed ${step.title}`,
    `📈 Outcome aligned: ${step.successCriteria}`
  ];
}

export default function App() {
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>(workflows[0]?.id ?? "");
  const [runState, setRunState] = useState<PipelineRunState>(() => createIdleRunState());
  const timerRef = useRef<number | null>(null);

  const selectedWorkflow = useMemo(
    () => workflows.find((workflow) => workflow.id === selectedWorkflowId),
    [selectedWorkflowId]
  );

  const capabilitySummary = useMemo(() => {
    return workflows.reduce(
      (acc, workflow) => {
        workflow.steps.forEach((step) => {
          acc[step.capability] = (acc[step.capability] ?? 0) + 1;
        });
        return acc;
      },
      {} as Record<string, number>
    );
  }, []);

  const handleSelectWorkflow = useCallback((workflowId: string) => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setSelectedWorkflowId(workflowId);
    setRunState(createIdleRunState());
  }, []);

  const startPipeline = useCallback(() => {
    if (!selectedWorkflow) {
      return;
    }
    const now = Date.now();
    if (selectedWorkflow.steps.length === 0) {
      setRunState({
        status: "succeeded",
        steps: [],
        currentStepIndex: 0,
        startedAt: now,
        completedAt: now
      });
      return;
    }

    setRunState({
      status: "running",
      steps: selectedWorkflow.steps.map((step, index) => ({
        step,
        status: index === 0 ? "running" : "pending",
        startedAt: index === 0 ? now : undefined,
        logs: index === 0 ? createStartLogs(step) : []
      })),
      currentStepIndex: 0,
      startedAt: now
    });
  }, [selectedWorkflow]);

  useEffect(() => {
    if (!selectedWorkflow) {
      return undefined;
    }
    if (runState.status !== "running") {
      return undefined;
    }
    const activeStep = runState.steps[runState.currentStepIndex];
    if (!activeStep || activeStep.status !== "running") {
      return undefined;
    }

    const delay = Math.max(activeStep.step.estimatedMinutes, 1) * PIPELINE_DELAY_FACTOR_MS;
    timerRef.current = window.setTimeout(() => {
      setRunState((previous) => {
        const current = previous.steps[previous.currentStepIndex];
        if (!current) {
          return previous;
        }

        const updatedSteps: StepRunState[] = previous.steps.map((state, index) => {
          if (index === previous.currentStepIndex) {
            return {
              ...state,
              status: "succeeded",
              completedAt: Date.now(),
              logs: [...state.logs, ...createCompletionLogs(state.step)]
            };
          }
          if (index === previous.currentStepIndex + 1) {
            return {
              ...state,
              status: "running",
              startedAt: Date.now(),
              logs: [...state.logs, ...createStartLogs(state.step)]
            };
          }
          return state;
        });

        const nextIndex = previous.currentStepIndex + 1;
        const isComplete = nextIndex >= updatedSteps.length;

        return {
          status: isComplete ? "succeeded" : "running",
          steps: updatedSteps,
          currentStepIndex: isComplete
            ? Math.max(updatedSteps.length - 1, 0)
            : nextIndex,
          startedAt: previous.startedAt,
          completedAt: isComplete ? Date.now() : previous.completedAt
        };
      });
    }, delay);

    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [runState, selectedWorkflow]);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  const totalAgents = useMemo(() => {
    const agentIds = new Set<string>();
    workflows.forEach((workflow) => {
      workflow.steps.forEach((step) => agentIds.add(step.agent));
    });
    return agentIds.size;
  }, []);

  const totalSteps = useMemo(() => workflows.reduce((acc, workflow) => acc + workflow.steps.length, 0), []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-background">
      <header className="border-b bg-background/80 backdrop-blur">
        <div className="container space-y-8 py-10">
          <div className="flex flex-wrap items-center gap-3 text-sm font-semibold text-primary">
            <Sparkles className="h-4 w-4" /> Agentic pipeline orchestrator
          </div>
          <div className="grid gap-6 lg:grid-cols-[3fr,2fr] lg:items-center">
            <div className="space-y-6">
              <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                Compose DevOps, AppSec, and FinOps workflows that execute like clockwork
              </h1>
              <p className="max-w-2xl text-base text-muted-foreground">
                Choose a runbook, preview the orchestrated agents, and observe the pipeline as it executes
                codex-cli and agentic tasks with audit-ready telemetry.
              </p>
              <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                <span className="flex items-center gap-2">
                  <Layers className="h-4 w-4 text-primary" />
                  {workflows.length} curated workflows
                </span>
                <span className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  {totalAgents} dedicated agents
                </span>
                <span className="flex items-center gap-2">
                  <LineChart className="h-4 w-4 text-primary" />
                  {totalSteps} orchestrated steps
                </span>
              </div>
            </div>
            <div className="space-y-4 rounded-2xl border bg-card p-6 shadow-sm">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Capability coverage
              </h2>
              <div className="flex flex-wrap gap-3">
                {Object.entries(capabilitySummary).map(([capability, count]) => (
                  <Badge key={capability} variant="secondary" className="gap-2 text-sm">
                    <span className="font-semibold text-foreground">{count}</span> {capability} touchpoints
                  </Badge>
                ))}
              </div>
            </div>
          </div>
          <Separator />
        </div>
      </header>
      <main className="container space-y-12 py-12">
        <section className="space-y-6">
          <div className="space-y-1">
            <h2 className="text-2xl font-semibold text-foreground">Pick a workflow</h2>
            <p className="text-sm text-muted-foreground">
              Each runbook orchestrates codex-cli commands and specialised agents to deliver autonomous platform
              outcomes.
            </p>
          </div>
          <WorkflowPicker
            workflows={workflows}
            selectedWorkflowId={selectedWorkflowId}
            onSelect={handleSelectWorkflow}
          />
        </section>
        <PipelineRunPanel workflow={selectedWorkflow} runState={runState} onStart={startPipeline} />
      </main>
    </div>
  );
}
