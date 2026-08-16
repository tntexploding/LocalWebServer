import React from 'react';
import {
  Bell,
  Clock3,
  Flag,
  GitBranch,
  LoaderCircle,
  Play,
  TestTube2,
} from 'lucide-react';
import {
  evaluateWorkflowLogic,
  workflowLogicInput,
  type ActionConfig,
  type ActionResult,
  type EventEnvelope,
  type ScheduledWorkflowStatus,
  type WorkflowExpressionContext,
  type WorkflowNode,
  type WorkflowSchedule,
} from '@las/core';

type Translator = (
  key: string,
  values?: Record<string, string | number>,
) => string;

interface RuleTestResult {
  event: EventEnvelope;
  matches: Array<{ruleId: string; matched: boolean}>;
}

interface WorkflowNodeTestPanelProps {
  ruleId: string;
  ruleEnabled: boolean;
  node?: WorkflowNode;
  actions: ActionConfig[];
  runs: ActionResult[];
  activeRuns: ActionResult[];
  schedules: ScheduledWorkflowStatus[];
  eventText: string;
  eventResult: RuleTestResult | null;
  previewContext: WorkflowExpressionContext;
  t: Translator;
  onEventTextChange: (value: string) => void;
  onRunEvent: () => Promise<void>;
  onRunAction: (id: string) => Promise<ActionResult>;
}

interface LogicTestResult {
  matched: boolean;
  input: unknown;
}

/** Provides a test plan tailored to the currently selected workflow node. */
export function WorkflowNodeTestPanel({
  ruleId,
  ruleEnabled,
  node,
  actions,
  runs,
  activeRuns,
  schedules,
  eventText,
  eventResult,
  previewContext,
  t,
  onEventTextChange,
  onRunEvent,
  onRunAction,
}: WorkflowNodeTestPanelProps) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [actionResult, setActionResult] = React.useState<ActionResult | null>(
    null,
  );
  const [logicText, setLogicText] = React.useState('{}');
  const [logicResult, setLogicResult] = React.useState<LogicTestResult | null>(
    null,
  );

  React.useEffect(() => {
    setError(null);
    setActionResult(null);
    setLogicResult(null);
    if (node?.type === 'logic') setLogicText(logicSample(node));
  }, [node?.id, node?.type]);

  async function runEventTest() {
    setBusy(true);
    setError(null);
    try {
      await onRunEvent();
    } catch (runError) {
      setError(errorMessage(runError));
    } finally {
      setBusy(false);
    }
  }

  async function runActionTest(actionId: string) {
    setBusy(true);
    setError(null);
    setActionResult(null);
    try {
      setActionResult(await onRunAction(actionId));
    } catch (runError) {
      setError(errorMessage(runError));
    } finally {
      setBusy(false);
    }
  }

  function runLogicTest(logicNode: Extract<WorkflowNode, {type: 'logic'}>) {
    setError(null);
    setLogicResult(null);
    try {
      const value = JSON.parse(logicText) as unknown;
      const context = contextWithLogicInput(
        previewContext,
        logicNode.logic.input,
        value,
      );
      setLogicResult({
        input: workflowLogicInput(logicNode, context),
        matched: evaluateWorkflowLogic(logicNode, context),
      });
    } catch (runError) {
      setError(errorMessage(runError));
    }
  }

  const observedActionResult = actionResult
    ? (runs.find(item => item.id === actionResult.id) ??
      activeRuns.find(item => item.id === actionResult.id) ??
      actionResult)
    : null;

  return (
    <section className="workflowNodeTestPanel">
      <div className="modalHead">
        <div>
          <span>{t('workflow.test.description')}</span>
          <h2>{node?.label ?? t('workflow.selectNode')}</h2>
        </div>
      </div>
      {!node ? (
        <div className="inspectorEmpty">
          <TestTube2 size={22} />
          <span>{t('workflow.test.noNode')}</span>
        </div>
      ) : (
        <div className="workflowNodeTestBody">
          {node.type === 'trigger' && node.trigger.type === 'event' && (
            <EventTriggerTest
              ruleId={ruleId}
              eventText={eventText}
              result={eventResult}
              busy={busy}
              error={error}
              t={t}
              onChange={onEventTextChange}
              onRun={() => void runEventTest()}
            />
          )}
          {node.type === 'trigger' && node.trigger.type === 'time' && (
            <ScheduleTriggerTest
              node={node}
              ruleEnabled={ruleEnabled}
              schedule={schedules.find(item => item.ruleId === ruleId)}
              t={t}
            />
          )}
          {node.type === 'action' && (
            <ActionNodeTest
              node={node}
              action={referencedAction(node, actions)}
              busy={busy}
              error={error}
              result={observedActionResult}
              t={t}
              onRun={id => void runActionTest(id)}
            />
          )}
          {node.type === 'logic' && (
            <LogicNodeTest
              node={node}
              value={logicText}
              result={logicResult}
              error={error}
              t={t}
              onChange={setLogicText}
              onRun={() => runLogicTest(node)}
            />
          )}
          {node.type === 'end' && <EndNodeTest node={node} t={t} />}
        </div>
      )}
    </section>
  );
}

function EventTriggerTest({
  ruleId,
  eventText,
  result,
  busy,
  error,
  t,
  onChange,
  onRun,
}: {
  ruleId: string;
  eventText: string;
  result: RuleTestResult | null;
  busy: boolean;
  error: string | null;
  t: Translator;
  onChange: (value: string) => void;
  onRun: () => void;
}) {
  const matched = result?.matches.find(item => item.ruleId === ruleId)?.matched;
  return (
    <>
      <TestPlan
        icon={<TestTube2 size={18} />}
        title={t('workflow.test.eventTitle')}
        description={t('workflow.test.eventPlan')}
      />
      <label className="workflowTestPayload">
        <span>{t('rule.testEvent')}</span>
        <textarea
          className="testPayload"
          value={eventText}
          onChange={event => onChange(event.target.value)}
          spellCheck={false}
        />
      </label>
      {error && <div className="formError">{error}</div>}
      {matched !== undefined && (
        <TestOutcome
          tone={matched ? 'success' : 'warning'}
          title={t(
            matched
              ? 'workflow.simulationMatched'
              : 'workflow.simulationMissed',
          )}
        />
      )}
      <TestActions
        busy={busy}
        label={t('workflow.runSimulation')}
        onRun={onRun}
      />
    </>
  );
}

function ScheduleTriggerTest({
  node,
  ruleEnabled,
  schedule,
  t,
}: {
  node: Extract<WorkflowNode, {type: 'trigger'}>;
  ruleEnabled: boolean;
  schedule?: ScheduledWorkflowStatus;
  t: Translator;
}) {
  if (node.trigger.type !== 'time') return null;
  const configured = scheduleSummary(node.trigger.schedule, t);
  return (
    <>
      <TestPlan
        icon={<Clock3 size={18} />}
        title={t('workflow.test.scheduleTitle')}
        description={t('workflow.test.schedulePlan')}
      />
      <div className="workflowTestFacts">
        <Fact label={t('workflow.test.configured')} value={configured} />
        <Fact
          label={t('workflow.test.registration')}
          value={t(
            schedule
              ? 'workflow.test.scheduleRegistered'
              : ruleEnabled
                ? 'workflow.test.schedulePending'
                : 'workflow.test.scheduleDisabled',
          )}
        />
        {schedule && (
          <>
            <Fact
              label={t('workflow.test.nextRun')}
              value={formatDateTime(schedule.nextRunAt)}
            />
            <Fact
              label={t('workflow.test.lastRun')}
              value={
                schedule.lastRunAt
                  ? formatDateTime(schedule.lastRunAt)
                  : t('common.none')
              }
            />
          </>
        )}
      </div>
      <TestOutcome
        tone={schedule ? 'success' : 'warning'}
        title={t(
          schedule
            ? 'workflow.test.scheduleHealthy'
            : 'workflow.test.scheduleNotRegistered',
        )}
      />
    </>
  );
}

function ActionNodeTest({
  node,
  action,
  busy,
  error,
  result,
  t,
  onRun,
}: {
  node: Extract<WorkflowNode, {type: 'action'}>;
  action?: ActionConfig;
  busy: boolean;
  error: string | null;
  result: ActionResult | null;
  t: Translator;
  onRun: (id: string) => void;
}) {
  const isReference = node.action.type === 'reference';
  return (
    <>
      <TestPlan
        icon={<Bell size={18} />}
        title={t('workflow.test.actionTitle')}
        description={
          action
            ? t(`workflow.test.actionPlan.${action.type}`)
            : t(
                isReference
                  ? 'workflow.test.actionMissing'
                  : 'workflow.test.inlineUnsupported',
              )
        }
      />
      {action && (
        <div className="workflowTestFacts">
          <Fact
            label={t('field.type')}
            value={t(`workflow.action.${action.type}`)}
          />
          <Fact
            label={t('workflow.test.target')}
            value={actionTarget(action)}
          />
        </div>
      )}
      {action && (
        <div className="workflowTestWarning">
          <Play size={16} />
          <span>{t('workflow.test.actionRealWarning')}</span>
        </div>
      )}
      {error && <div className="formError">{error}</div>}
      {result && (
        <TestOutcome
          tone={actionResultTone(result)}
          title={t(`run.${result.status}`)}
          detail={result.error ?? result.output ?? result.id}
        />
      )}
      <TestActions
        busy={busy}
        disabled={!action}
        label={t('workflow.test.runAction')}
        onRun={() => action && onRun(action.id)}
      />
    </>
  );
}

function LogicNodeTest({
  node,
  value,
  result,
  error,
  t,
  onChange,
  onRun,
}: {
  node: Extract<WorkflowNode, {type: 'logic'}>;
  value: string;
  result: LogicTestResult | null;
  error: string | null;
  t: Translator;
  onChange: (value: string) => void;
  onRun: () => void;
}) {
  return (
    <>
      <TestPlan
        icon={<GitBranch size={18} />}
        title={t('workflow.test.logicTitle')}
        description={t('workflow.test.logicPlan', {
          operator: t(`workflow.logic.${node.logic.operator}`),
        })}
      />
      <label className="workflowTestPayload">
        <span>{t(`workflow.test.logicInput.${node.logic.input}`)}</span>
        <textarea
          className="testPayload"
          value={value}
          onChange={event => onChange(event.target.value)}
          spellCheck={false}
        />
      </label>
      {error && <div className="formError">{error}</div>}
      {result && (
        <TestOutcome
          tone={result.matched ? 'success' : 'warning'}
          title={t('workflow.test.logicBranch', {
            branch: t(
              result.matched
                ? 'workflow.test.trueBranch'
                : 'workflow.test.falseBranch',
            ),
          })}
          detail={t('workflow.test.observedValue', {
            value: printable(result.input),
          })}
        />
      )}
      <TestActions label={t('workflow.test.runLogic')} onRun={onRun} />
    </>
  );
}

function EndNodeTest({
  node,
  t,
}: {
  node: Extract<WorkflowNode, {type: 'end'}>;
  t: Translator;
}) {
  const ok = node.end.status === 'completed';
  return (
    <>
      <TestPlan
        icon={<Flag size={18} />}
        title={t('workflow.test.endTitle')}
        description={t('workflow.test.endPlan')}
      />
      <TestOutcome
        tone={ok ? 'success' : 'danger'}
        title={t(`run.${node.end.status}`)}
        detail={node.end.message || t('workflow.test.noEndMessage')}
      />
    </>
  );
}

function TestPlan({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="workflowTestPlan">
      {icon}
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
    </div>
  );
}

function Fact({label, value}: {label: string; value: string}) {
  return (
    <div>
      <span>{label}</span>
      <code title={value}>{value}</code>
    </div>
  );
}

function TestOutcome({
  tone,
  title,
  detail,
}: {
  tone: 'success' | 'warning' | 'danger' | 'neutral';
  title: string;
  detail?: string;
}) {
  return (
    <div className={`workflowTestOutcome ${tone}`}>
      <strong>{title}</strong>
      {detail && <code>{detail}</code>}
    </div>
  );
}

function TestActions({
  label,
  busy = false,
  disabled = false,
  onRun,
}: {
  label: string;
  busy?: boolean;
  disabled?: boolean;
  onRun: () => void;
}) {
  return (
    <div className="workflowTestActions">
      <button
        className="primaryButton"
        disabled={disabled || busy}
        onClick={onRun}
      >
        {busy ? (
          <LoaderCircle className="spin" size={15} />
        ) : (
          <Play size={15} />
        )}
        {label}
      </button>
    </div>
  );
}

function contextWithLogicInput(
  context: WorkflowExpressionContext,
  input: Extract<WorkflowNode, {type: 'logic'}>['logic']['input'],
  value: unknown,
): WorkflowExpressionContext {
  const next = {...context, last: {...context.last}};
  if (input === 'triggerEvent') next.trigger = value as EventEnvelope;
  else if (input === 'lastEvent') next.last.event = value as EventEnvelope;
  else next.last.result = value as ActionResult;
  return next;
}

function logicSample(node: Extract<WorkflowNode, {type: 'logic'}>): string {
  if (node.logic.input === 'lastResult') {
    return JSON.stringify(
      {
        id: 'test-result',
        actionId: 'test-action',
        status: 'completed',
        ok: true,
        output: 'demo',
      },
      null,
      2,
    );
  }
  return JSON.stringify(
    {
      id: 'test-event',
      traceId: 'test-trace',
      time: new Date().toISOString(),
      source: 'test.event',
      kind: 'http.request',
      body: {value: 'demo'},
      meta: {},
    },
    null,
    2,
  );
}

function actionTarget(action: ActionConfig): string {
  if (action.type === 'command') {
    return `${action.cwd} · ${action.command} ${action.args?.join(' ') ?? ''}`.trim();
  }
  if (action.type === 'script') {
    return `${action.cwd} · ${action.interpreter} ${action.script}`;
  }
  if (action.type === 'send_http') return `${action.method} ${action.url}`;
  if (action.type === 'send_ws') return action.target;
  if (action.type === 'wait_event') return action.source ?? '*';
  return action.title;
}

function referencedAction(
  node: Extract<WorkflowNode, {type: 'action'}>,
  actions: ActionConfig[],
): ActionConfig | undefined {
  if (node.action.type !== 'reference') return undefined;
  const actionId = node.action.actionId;
  return actions.find(item => item.id === actionId);
}

function scheduleSummary(schedule: WorkflowSchedule, t: Translator): string {
  if (schedule.mode === 'once') return schedule.at;
  if (schedule.mode === 'interval') {
    return t('workflow.test.intervalSummary', {
      seconds: schedule.everyMs / 1000,
    });
  }
  return `${schedule.time} · ${schedule.timeZone ?? t('workflow.test.localTime')}`;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function printable(value: unknown): string {
  const serialized = JSON.stringify(value);
  return serialized === undefined ? String(value) : serialized;
}

function actionResultTone(
  result: ActionResult,
): 'success' | 'warning' | 'danger' | 'neutral' {
  if (result.status === 'queued' || result.status === 'running')
    return 'warning';
  if (result.status === 'failed' || result.status === 'cancelled')
    return 'danger';
  return result.ok === false ? 'danger' : 'success';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
