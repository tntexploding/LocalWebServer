import {firstJsonPathValue} from './matcher.js';
import type {WorkflowExpressionContext, WorkflowNode} from './types.js';

type WorkflowLogicNode = Extract<WorkflowNode, {type: 'logic'}>;

/** Returns the configured input value inspected by a workflow logic node. */
export function workflowLogicInput(
  node: WorkflowLogicNode,
  context: WorkflowExpressionContext,
): unknown {
  const source =
    node.logic.input === 'triggerEvent'
      ? context.trigger
      : node.logic.input === 'lastEvent'
        ? context.last.event
        : context.last.result;
  return node.logic.jsonPath
    ? firstJsonPathValue(source, node.logic.jsonPath)
    : source;
}

/** Evaluates a workflow logic node using the production branch semantics. */
export function evaluateWorkflowLogic(
  node: WorkflowLogicNode,
  context: WorkflowExpressionContext,
): boolean {
  if (node.logic.operator === 'success') {
    return context.last.result?.ok === true;
  }
  const value = workflowLogicInput(node, context);
  if (node.logic.operator === 'truthy') return Boolean(value);
  if (node.logic.operator === 'contains') {
    return String(value ?? '').includes(String(node.logic.value ?? ''));
  }
  if (node.logic.operator === 'regex') {
    return new RegExp(String(node.logic.value ?? '')).test(String(value ?? ''));
  }
  return JSON.stringify(value) === JSON.stringify(node.logic.value);
}
