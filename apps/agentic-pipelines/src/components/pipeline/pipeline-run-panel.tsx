import { useMemo } from "react";
import { Badge } from "../ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "../ui/card";
import { Button } from "../ui/button";
import { Progress } from "../ui/progress";
import { ScrollArea } from "../ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { Separator } from "../ui/separator";
import type { PipelineRunState, StepRunState, Workflow } from "./types";
import { cn } from "../../lib/utils";
import { Clock, GaugeCircle, Sparkles, Wand2 } from "lucide-react";

export interface PipelineRunPanelProps {
  workflow?: Workflow;
  runState: PipelineRunState;
  onStart: () => void;
}
export function PipelineRunPanel({ workflow, runState, onStart }: PipelineRunPanelProps) {
  const totalSteps = workflow?.steps.length ?? 0;
  const completedSteps = runState.steps.filter((step) => step.status === "succeeded").length;
  const progressValue = totalSteps === 0 ? 0 : Math.round((completedSteps / totalSteps) * 100);
  const isRunning = runState.status === "running";

  const uniqueAgents = useMemo(() => {
    if (!workflow) return [];
    const map = new Map<string, { capability: string; command: string }>();
    workflow.steps.forEach((step) => {
      if (!map.has(step.agent)) {
        map.set(step.agent, {
          capability: step.capability,
          command: step.command
        });
      }
    });
    return Array.from(map.entries());
  }, [workflow]);

  if (!workflow) {
    return (
      <Card className="border-dashed">
        <CardHeader>
          <CardTitle>Select a workflow to inspect the orchestration pipeline</CardTitle>
          <CardDescription>
            Pick one of the workflows above to preview the execution graph, agent roster, and
            observability signals for the run.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }
  return (
    <Card className="shadow-lg">
      <CardHeader className="gap-4 space-y-4 sm:space-y-0 sm:[&>div]:flex sm:[&>div]:justify-between">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="uppercase tracking-wide">
              {workflow.category}
            </Badge>
            <Badge className="bg-primary/15 text-primary">{totalSteps} orchestrated steps</Badge>
            <Badge variant="secondary" className="gap-1">
              <GaugeCircle className="h-3 w-3" />
              SLA {workflow.estimatedDurationMinutes}m
            </Badge>
          </div>
          <CardTitle className="text-3xl font-bold">{workflow.name} pipeline</CardTitle>
          <CardDescription>{workflow.description}</CardDescription>
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={onStart} disabled={isRunning} size="lg">
            {isRunning ? "Pipeline running" : "Execute pipeline"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-8">
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <p className="text-sm font-medium text-muted-foreground">Run progress</p>
              <p className="text-2xl font-semibold text-foreground">{progressValue}%</p>
            </div>
            <div className="flex gap-6 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <span>{completedSteps} completed</span>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-primary" />
                <span>{workflow.estimatedDurationMinutes}m target</span>
              </div>
            </div>
          </div>
          <Progress value={progressValue} />
        </section>
        <Tabs defaultValue="steps" className="space-y-4">
          <TabsList className="w-full sm:w-auto">
            <TabsTrigger className="flex-1 sm:flex-none" value="steps">
              Execution feed
            </TabsTrigger>
            <TabsTrigger className="flex-1 sm:flex-none" value="agents">
              Agent roster
            </TabsTrigger>
            <TabsTrigger className="flex-1 sm:flex-none" value="insights">
              Run insights
            </TabsTrigger>
          </TabsList>

          <TabsContent value="steps" className="border-none p-0 outline-none">
            <ScrollArea className="h-[360px] rounded-lg border bg-card">
              <div className="divide-y">
                {runState.steps.map((stepState) => (
                  <StepItem key={stepState.step.id} stepState={stepState} />
                ))}
                {runState.steps.length === 0 ? (
                  <div className="p-6 text-sm text-muted-foreground">
                    Pipeline ready. Kick off an execution to stream orchestration events.
                  </div>
                ) : null}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="agents" className="border-none p-0 outline-none">
            <div className="grid gap-4 md:grid-cols-2">
              {uniqueAgents.map(([agent, meta]) => (
                <Card key={agent} className="border border-dashed">
                  <CardHeader className="space-y-2">
                    <Badge variant="secondary" className="w-fit uppercase tracking-wide">
                      {meta.capability}
                    </Badge>
                    <CardTitle className="text-xl">{agent}</CardTitle>
                    <CardDescription className="font-mono text-xs">
                      {meta.command}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="text-sm text-muted-foreground">
                    Purpose: orchestrates {meta.capability} objectives for this workflow.
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="insights" className="border-none p-0 outline-none">
            <div className="grid gap-4 md:grid-cols-2">
              <InsightCard
                title="Current status"
                description={
                  runState.status === "idle"
                    ? "No active run"
                    : runState.status === "running"
                    ? "Pipeline execution in progress"
                    : "Pipeline completed successfully"
                }
                metric={runState.status.toUpperCase()}
              />
              <InsightCard
                title="Steps remaining"
                description="Tasks left before the pipeline finalizes"
                metric={`${Math.max(totalSteps - completedSteps, 0)}`}
              />
              <InsightCard
                title="Average step duration"
                description="Based on the runbook expectations"
                metric={`${Math.round(
                  workflow.steps.reduce((acc, step) => acc + step.estimatedMinutes, 0) /
                    (workflow.steps.length || 1)
                )}m`}
              />
              <InsightCard
                title="Success criteria"
                description={workflow.successCriteria}
                metric="Aligned"
              />
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
interface StepItemProps {
  stepState: StepRunState;
}

function StepItem({ stepState }: StepItemProps) {
  const statusBadge = (() => {
    switch (stepState.status) {
      case "running":
        return <Badge className="bg-primary/15 text-primary">Running</Badge>;
      case "succeeded":
        return <Badge className="bg-emerald-500/15 text-emerald-600">Completed</Badge>;
      case "pending":
        return <Badge variant="secondary">Pending</Badge>;
      default:
        return <Badge variant="secondary">Idle</Badge>;
    }
  })();

  const timelineColor = (() => {
    switch (stepState.status) {
      case "running":
        return "bg-primary";
      case "succeeded":
        return "bg-emerald-500";
      case "pending":
        return "bg-muted";
      default:
        return "bg-muted";
    }
  })();

  return (
    <div className="flex items-start gap-4 p-6">
      <div className="flex flex-col items-center gap-6">
        <div className={cn("h-3 w-3 rounded-full ring-4 ring-background", timelineColor)} />
      </div>
      <div className="flex-1 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <p className="text-base font-semibold text-foreground">{stepState.step.title}</p>
            <p className="text-sm text-muted-foreground">{stepState.step.summary}</p>
          </div>
          <div className="flex flex-col items-start gap-2 sm:items-end">
            {statusBadge}
            <Badge variant="secondary" className="uppercase tracking-wide">
              {stepState.step.capability}
            </Badge>
          </div>
        </div>
        <div className="grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
          <div>
            <p className="font-medium text-foreground">Agent</p>
            <p>{stepState.step.agent}</p>
          </div>
          <div>
            <p className="font-medium text-foreground">Command</p>
            <p className="font-mono text-xs">{stepState.step.command}</p>
          </div>
        </div>
        {stepState.logs.length ? (
          <div className="space-y-1 rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
            {stepState.logs.slice(-3).map((log, logIndex) => (
              <p key={logIndex}>{log}</p>
            ))}
          </div>
        ) : null}
        <Separator />
      </div>
    </div>
  );
}
interface InsightCardProps {
  title: string;
  description: string;
  metric: string;
}

function InsightCard({ title, description, metric }: InsightCardProps) {
  return (
    <Card className="border border-dashed">
      <CardHeader className="space-y-2">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Wand2 className="h-4 w-4 text-primary" />
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-semibold text-foreground">{metric}</p>
      </CardContent>
    </Card>
  );
}
