import {randomUUID} from 'node:crypto';
import {
  evaluateWorkflowLogic,
  resolveWorkflowExpressions,
  workflowLogicInput,
  type ActionConfig,
  type ActionResult,
  type EventEnvelope,
  type LoadedConfig,
  type RuleConfig,
  type WorkflowEdgeOutcome,
  type WorkflowExpressionContext,
  type WorkflowNode,
  type WorkflowNodeContextValue,
  type WorkflowNodeExecution,
  type WorkflowRunDetail,
} from '@las/core';
import type {JsonlStore} from '@las/storage';
import type {ActionQueue} from './actionQueue.js';
import type {EventWaitBroker} from './eventWaitBroker.js';

interface WorkflowBranch {
  id: string;
  nodeId: string;
  context: WorkflowExpressionContext;
}

interface RunningWorkflow {
  run: ActionResult;
  controller: AbortController;
  timeline: WorkflowNodeExecution[];
  nodeRunIds: string[];
  currentNodeIds: string[];
  aggregateNodes: Record<string, WorkflowNodeContextValue>;
  lastContext: WorkflowExpressionContext;
}

interface ExecutedNode {
  result: ActionResult;
  event?: EventEnvelope;
  context: WorkflowExpressionContext;
}

/** Executes versioned workflow graphs and exposes a live node timeline. */
export class WorkflowExecutor {
  private readonly running = new Map<string, RunningWorkflow>();

  constructor(
    private readonly queue: ActionQueue,
    private readonly runLog: JsonlStore<ActionResult>,
    private readonly eventWaits: EventWaitBroker,
    private readonly getConfig: () => LoadedConfig,
    private readonly onPersistenceError: (error: unknown) => void = () =>
      undefined,
    private readonly sanitizeResult: (
      result: ActionResult,
    ) => ActionResult = result => result,
  ) {}

  start(rule: RuleConfig, event: EventEnvelope): ActionResult {
    if (!rule.workflow) throw new Error(`Rule "${rule.id}" has no workflow.`);
    const queuedAt = new Date().toISOString();
    const run: ActionResult = {
      id: randomUUID(),
      traceId: event.traceId,
      actionId: rule.id,
      eventId: event.id,
      ruleId: rule.id,
      status: 'queued',
      queuedAt,
      detail: emptyWorkflowDetail(),
    };
    const context: WorkflowExpressionContext = {
      trigger: event,
      inputs: {},
      nodes: {},
      last: {},
      workflow: {
        id: rule.id,
        runId: run.id,
        traceId: event.traceId,
        startedAt: queuedAt,
      },
    };
    const controller = new AbortController();
    this.running.set(run.id, {
      run: {...run, status: 'running', startedAt: queuedAt},
      controller,
      timeline: [],
      nodeRunIds: [],
      currentNodeIds: [rule.workflow.startNodeId],
      aggregateNodes: {},
      lastContext: context,
    });
    this.refreshLiveRun(run.id);
    void this.execute(rule, event, run, context, controller.signal);
    return run;
  }

  acceptEvent(event: EventEnvelope): void {
    this.eventWaits.accept(event);
  }

  snapshot(): ActionResult[] {
    return [...this.running.values()].map(item => item.run);
  }

  cancel(runId: string): ActionResult | undefined {
    const item = this.running.get(runId);
    if (!item) return undefined;
    item.controller.abort('Cancelled by user.');
    return item.run;
  }

  private async execute(
    rule: RuleConfig,
    triggerEvent: EventEnvelope,
    queuedRun: ActionResult,
    initialContext: WorkflowExpressionContext,
    signal: AbortSignal,
  ): Promise<void> {
    const startedAt = new Date();
    let completedEnds = 0;
    try {
      const workflow = rule.workflow;
      if (!workflow) throw new Error(`Rule "${rule.id}" has no workflow.`);
      const branches: WorkflowBranch[] = [
        {id: 'branch-1', nodeId: workflow.startNodeId, context: initialContext},
      ];
      let steps = 0;

      while (branches.length > 0) {
        signal.throwIfAborted();
        if (steps++ >= 200) {
          throw new Error('Workflow exceeded the 200-node execution limit.');
        }
        const branch = branches.shift();
        if (!branch) break;
        const node = workflow.nodes.find(item => item.id === branch.nodeId);
        if (!node) throw new Error(`Unknown workflow node: ${branch.nodeId}`);

        this.setCurrentNodes(queuedRun.id, [
          node.id,
          ...branches.map(item => item.nodeId),
        ]);
        const timeline = this.beginNode(queuedRun.id, node, branch);
        let outcome: WorkflowEdgeOutcome = 'always';
        let nextContext = branch.context;

        if (node.type === 'trigger') {
          nextContext = addNodeContext(branch.context, node.id, {
            status: 'completed',
            event: triggerEvent,
            output: triggerEvent.body,
          });
          this.finishNode(queuedRun.id, timeline, {
            status: 'completed',
            outcome,
            output: previewValue(triggerEvent),
          });
        } else if (node.type === 'action') {
          const executed = await this.executeAction(
            rule,
            queuedRun.id,
            node,
            branch.context,
            triggerEvent,
            signal,
            runId => this.attachActionRun(queuedRun.id, timeline.id, runId),
          );
          this.addNodeRun(queuedRun.id, executed.result.id);
          outcome = executed.result.ok ? 'success' : 'failure';
          nextContext = addNodeContext(executed.context, node.id, {
            status: executionStatus(executed.result),
            result: executed.result,
            event: executed.event,
            output: executed.result.output,
            error: executed.result.error,
          });
          this.finishNode(queuedRun.id, timeline, {
            status: executionStatus(executed.result),
            outcome,
            actionRunId: executed.result.id,
            output: previewValue(executed.result),
            error: executed.result.error,
          });
        } else if (node.type === 'logic') {
          const input = workflowLogicInput(node, branch.context);
          const matched = evaluateWorkflowLogic(node, branch.context);
          outcome = matched ? 'true' : 'false';
          nextContext = addNodeContext(branch.context, node.id, {
            status: 'completed',
            output: matched,
          });
          this.finishNode(queuedRun.id, timeline, {
            status: 'completed',
            outcome,
            input: previewValue(input),
            output: matched,
          });
        } else {
          const failed = node.end.status === 'failed';
          nextContext = addNodeContext(branch.context, node.id, {
            status: failed ? 'failed' : 'completed',
            output: node.end.message,
            error: failed ? node.end.message : undefined,
          });
          this.finishNode(queuedRun.id, timeline, {
            status: failed ? 'failed' : 'completed',
            output: node.end.message,
            error: failed ? node.end.message : undefined,
          });
          this.updateContext(queuedRun.id, nextContext);
          if (failed) {
            throw new Error(
              node.end.message || `Reached failed end: ${node.id}`,
            );
          }
          completedEnds += 1;
          continue;
        }

        this.updateContext(queuedRun.id, nextContext);
        const outgoing = workflow.edges.filter(
          edge =>
            edge.from === node.id &&
            (edge.outcome === 'always' || edge.outcome === outcome),
        );
        if (outgoing.length === 0) {
          if (node.type === 'action' && outcome === 'failure') {
            throw new Error(
              nextContext.last.result?.error ||
                `Action node failed: ${node.id}`,
            );
          }
          throw new Error(`Workflow node "${node.id}" has no matching edge.`);
        }
        branches.push(
          ...outgoing.map((edge, index) => ({
            id: outgoing.length === 1 ? branch.id : `${branch.id}.${index + 1}`,
            nodeId: edge.to,
            context: cloneContext(nextContext),
          })),
        );
        this.setCurrentNodes(
          queuedRun.id,
          branches.map(item => item.nodeId),
        );
      }

      if (completedEnds === 0) {
        throw new Error('Workflow finished without reaching an end node.');
      }
      await this.finishWorkflow(queuedRun, startedAt, {
        status: 'completed',
        ok: true,
        output: `Reached ${completedEnds} completed end node(s).`,
        completedEnds,
      });
    } catch (error) {
      this.finishActiveNodes(
        queuedRun.id,
        signal.aborted ? 'cancelled' : 'failed',
        error instanceof Error ? error.message : String(error),
      );
      await this.finishWorkflow(queuedRun, startedAt, {
        status: signal.aborted ? 'cancelled' : 'failed',
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        completedEnds,
      });
    }
  }

  private async executeAction(
    rule: RuleConfig,
    workflowRunId: string,
    node: Extract<WorkflowNode, {type: 'action'}>,
    context: WorkflowExpressionContext,
    triggerEvent: EventEnvelope,
    signal: AbortSignal,
    onQueued: (runId: string) => void,
  ): Promise<ExecutedNode> {
    const resolved = this.resolveExecutableAction(rule, node, context);
    const result = await this.queue.enqueueAndWait({
      action: resolved.action,
      event: triggerEvent,
      ruleId: rule.id,
      workflowRunId,
      workflowNodeId: node.id,
      context: resolved.context,
      signal,
      onQueued: run => onQueued(run.id),
    });
    return {
      result,
      event: receivedEvent(result),
      context: resolved.context,
    };
  }

  private resolveExecutableAction(
    rule: RuleConfig,
    node: Extract<WorkflowNode, {type: 'action'}>,
    context: WorkflowExpressionContext,
  ): {action: ActionConfig; context: WorkflowExpressionContext} {
    const config = this.getConfig();
    const spec = node.action;
    if (spec.type === 'reference') {
      const referenced = config.actions.find(item => item.id === spec.actionId);
      if (!referenced) throw new Error(`Unknown action: ${spec.actionId}`);
      const onMissing =
        spec.onMissing ?? referenced.expressionPolicy ?? 'error';
      const inputs = resolveWorkflowExpressions(spec.with ?? {}, context, {
        onMissing,
      });
      return {
        action: {...referenced, expressionPolicy: onMissing},
        context: {...context, inputs},
      };
    }

    const resolved = resolveWorkflowExpressions(spec, context, {
      onMissing: 'error',
    });
    const id = `${rule.id}:${node.id}`;
    if (resolved.type === 'command' || resolved.type === 'script') {
      return {action: {...resolved, id}, context};
    }
    if (
      resolved.type === 'notification' ||
      resolved.type === 'prompt' ||
      resolved.type === 'wait_event' ||
      resolved.type === 'send_ws'
    ) {
      return {action: {...resolved, id}, context};
    }

    const client = resolved.clientId
      ? config.endpoints.httpClients.find(item => item.id === resolved.clientId)
      : undefined;
    if (resolved.clientId && !client) {
      throw new Error(`Unknown HTTP client endpoint: ${resolved.clientId}`);
    }
    if (client && !client.enabled) {
      throw new Error(`HTTP client endpoint is disabled: ${client.id}`);
    }
    const url =
      resolved.url ?? resolveClientUrl(client?.baseUrl, resolved.path);
    if (!url) throw new Error('HTTP workflow action has no destination URL.');
    return {
      context,
      action: {
        id,
        type: 'send_http',
        method: resolved.method,
        url,
        headers: {...client?.headers, ...resolved.headers},
        body: resolved.body,
        template: resolved.template ?? client?.template,
        templateValues: {
          ...client?.templateValues,
          ...resolved.templateValues,
        },
        timeoutMs: resolved.timeoutMs,
        retry: resolved.retry,
        idempotencyKey: resolved.idempotencyKey,
        expressionPolicy: resolved.expressionPolicy,
      },
    };
  }

  private beginNode(
    runId: string,
    node: WorkflowNode,
    branch: WorkflowBranch,
  ): WorkflowNodeExecution {
    const execution: WorkflowNodeExecution = {
      id: randomUUID(),
      nodeId: node.id,
      nodeType: node.type,
      branchId: branch.id,
      status: 'running',
      startedAt: new Date().toISOString(),
    };
    const item = this.running.get(runId);
    if (item) {
      item.timeline.push(execution);
      this.refreshLiveRun(runId);
    }
    return execution;
  }

  private finishNode(
    runId: string,
    execution: WorkflowNodeExecution,
    patch: Partial<WorkflowNodeExecution>,
  ): void {
    const finishedAt = new Date().toISOString();
    Object.assign(execution, patch, {
      finishedAt,
      durationMs:
        new Date(finishedAt).getTime() -
        new Date(execution.startedAt).getTime(),
    });
    this.refreshLiveRun(runId);
  }

  private attachActionRun(
    workflowRunId: string,
    timelineId: string,
    actionRunId: string,
  ): void {
    const item = this.running.get(workflowRunId);
    const execution = item?.timeline.find(entry => entry.id === timelineId);
    if (execution) execution.actionRunId = actionRunId;
    this.refreshLiveRun(workflowRunId);
  }

  private addNodeRun(workflowRunId: string, actionRunId: string): void {
    const item = this.running.get(workflowRunId);
    if (item) item.nodeRunIds.push(actionRunId);
  }

  private setCurrentNodes(runId: string, nodeIds: string[]): void {
    const item = this.running.get(runId);
    if (item) item.currentNodeIds = [...new Set(nodeIds)];
    this.refreshLiveRun(runId);
  }

  private updateContext(
    runId: string,
    context: WorkflowExpressionContext,
  ): void {
    const item = this.running.get(runId);
    if (!item) return;
    item.lastContext = context;
    Object.assign(item.aggregateNodes, context.nodes);
    this.refreshLiveRun(runId);
  }

  private finishActiveNodes(
    runId: string,
    status: 'failed' | 'cancelled',
    error: string,
  ): void {
    const item = this.running.get(runId);
    if (!item) return;
    for (const execution of item.timeline.filter(
      entry => entry.status === 'running',
    )) {
      this.finishNode(runId, execution, {status, error});
    }
  }

  private refreshLiveRun(runId: string): void {
    const item = this.running.get(runId);
    if (!item) return;
    item.run = {...item.run, detail: workflowDetail(item)};
  }

  private async finishWorkflow(
    queuedRun: ActionResult,
    startedAt: Date,
    patch: Partial<ActionResult> & {completedEnds: number},
  ): Promise<void> {
    const finishedAt = new Date();
    const item = this.running.get(queuedRun.id);
    if (item) item.currentNodeIds = [];
    const result: ActionResult = {
      ...queuedRun,
      ...patch,
      detail: item ? workflowDetail(item, patch.completedEnds) : patch.detail,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
    };
    this.running.delete(queuedRun.id);
    try {
      await this.runLog.append(this.sanitizeResult(result));
    } catch (error) {
      try {
        this.onPersistenceError(error);
      } catch {
        // Workflow completion must not become an unhandled rejection.
      }
    }
  }
}

function addNodeContext(
  context: WorkflowExpressionContext,
  nodeId: string,
  value: WorkflowNodeContextValue,
): WorkflowExpressionContext {
  return {
    ...context,
    nodes: {...context.nodes, [nodeId]: value},
    last: {
      result: value.result ?? context.last.result,
      event: value.event ?? context.last.event,
    },
  };
}

function cloneContext(
  context: WorkflowExpressionContext,
): WorkflowExpressionContext {
  return {
    ...context,
    inputs: {...context.inputs},
    nodes: {...context.nodes},
    last: {...context.last},
  };
}

function workflowDetail(
  item: RunningWorkflow,
  completedEnds?: number,
): WorkflowRunDetail {
  return {
    kind: 'workflow',
    currentNodeIds: item.currentNodeIds,
    timeline: item.timeline,
    nodeRunIds: item.nodeRunIds,
    ...(completedEnds === undefined ? {} : {completedEnds}),
    context: {
      inputs: item.lastContext.inputs,
      nodes: item.aggregateNodes,
      last: item.lastContext.last,
    },
  };
}

function emptyWorkflowDetail(): WorkflowRunDetail {
  return {
    kind: 'workflow',
    currentNodeIds: [],
    timeline: [],
    nodeRunIds: [],
  };
}

function executionStatus(
  result: ActionResult,
): 'completed' | 'failed' | 'cancelled' {
  if (result.status === 'cancelled') return 'cancelled';
  return result.ok ? 'completed' : 'failed';
}

function receivedEvent(result: ActionResult): EventEnvelope | undefined {
  const value = result.detail?.receivedEvent;
  if (!value || typeof value !== 'object') return undefined;
  const event = value as Partial<EventEnvelope>;
  return typeof event.id === 'string' && typeof event.kind === 'string'
    ? (value as EventEnvelope)
    : undefined;
}

function previewValue(value: unknown): unknown {
  if (value === undefined) return undefined;
  const serialized = JSON.stringify(value);
  if (serialized.length <= 4000) return value;
  return {truncated: true, preview: serialized.slice(0, 4000)};
}

function resolveClientUrl(
  baseUrl: string | undefined,
  path: string | undefined,
): string | undefined {
  if (!baseUrl) return undefined;
  const base = new URL(baseUrl);
  const resolved = new URL(
    path ?? '',
    baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`,
  );
  if (resolved.origin !== base.origin) {
    throw new Error('HTTP client paths must not change the configured origin.');
  }
  return resolved.toString();
}
