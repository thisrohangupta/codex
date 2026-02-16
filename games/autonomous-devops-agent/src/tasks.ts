import type { AgentContext } from './types.js';

export interface AgentTask {
  id: string;
  description: string;
  run(context: AgentContext): Promise<void>;
}

/**
 * Immutable task graph with lightweight validation for duplicate task IDs.
 */
export class TaskGraph {
  private readonly tasksById: ReadonlyMap<string, AgentTask>;

  constructor(tasks: AgentTask[]) {
    const map = new Map<string, AgentTask>();
    for (const task of tasks) {
      if (map.has(task.id)) {
        throw new Error(`Duplicate task id: ${task.id}`);
      }
      map.set(task.id, task);
    }
    this.tasksById = map;
  }

  list(): AgentTask[] {
    return [...this.tasksById.values()];
  }

  get(taskId: string): AgentTask | undefined {
    return this.tasksById.get(taskId);
  }

  size(): number {
    return this.tasksById.size;
  }
}
