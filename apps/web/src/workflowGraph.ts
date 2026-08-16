import type {WorkflowGraph} from '@las/core';

/** Removes every outcome edge connecting the selected source and target nodes. */
export function removeWorkflowConnection(
  workflow: WorkflowGraph,
  sourceId: string,
  targetId: string,
): WorkflowGraph {
  const edges = workflow.edges.filter(
    edge => !(edge.from === sourceId && edge.to === targetId),
  );
  return edges.length === workflow.edges.length
    ? workflow
    : {...workflow, edges};
}
