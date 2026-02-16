import { Badge } from "../ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from "../ui/card";
import { Button } from "../ui/button";
import type { Workflow } from "./types";
import { cn } from "../../lib/utils";
import { Check } from "lucide-react";

export interface WorkflowPickerProps {
  workflows: Workflow[];
  selectedWorkflowId: string;
  onSelect: (workflowId: string) => void;
}

export function WorkflowPicker({ workflows, selectedWorkflowId, onSelect }: WorkflowPickerProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {workflows.map((workflow) => {
        const isActive = workflow.id === selectedWorkflowId;
        return (
          <Card
            key={workflow.id}
            className={cn(
              "border-2 transition hover:border-primary/60",
              isActive ? "border-primary shadow-lg" : "border-transparent"
            )}
          >
            <CardHeader className="space-y-3">
              <div className="flex items-start justify-between gap-2">
                <Badge variant={isActive ? "default" : "secondary"}>{workflow.category}</Badge>
                {isActive ? (
                  <Badge className="gap-1 bg-primary/15 text-primary">
                    <Check className="h-3 w-3" /> Active
                  </Badge>
                ) : null}
              </div>
              <CardTitle>{workflow.name}</CardTitle>
              <CardDescription>{workflow.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>
                <span className="font-medium text-foreground">Trigger:</span> {workflow.trigger}
              </p>
              <p>
                <span className="font-medium text-foreground">Success:</span> {workflow.successCriteria}
              </p>
              <p>
                <span className="font-medium text-foreground">Duration:</span> ~
                {workflow.estimatedDurationMinutes} min
              </p>
            </CardContent>
            <CardFooter>
              <Button
                variant={isActive ? "secondary" : "outline"}
                className="w-full"
                onClick={() => onSelect(workflow.id)}
              >
                {isActive ? "Selected" : "Select workflow"}
              </Button>
            </CardFooter>
          </Card>
        );
      })}
    </div>
  );
}
