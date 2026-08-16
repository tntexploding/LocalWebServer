import React from 'react';
import {
  Bell,
  Clock3,
  Code2,
  FileCode2,
  Flag,
  GitBranch,
  GripVertical,
  Link2,
  MessageSquare,
  Play,
  Plus,
  Save,
  Search,
  Send,
  Settings2,
  Split,
  Terminal,
  Trash2,
  Unlink,
  Webhook,
  Zap,
} from 'lucide-react';
import {
  actionConfigSchema,
  inspectWorkflowExpressions,
  resolveWorkflowExpressions,
  type ActionResult,
  type ActionConfig,
  type EndpointsConfig,
  type EventEnvelope,
  type MatchCondition,
  type MatchConfig,
  type MessageTemplateField,
  type RuleConfig,
  type ScheduledWorkflowStatus,
  type WorkflowActionSpec,
  type WorkflowEdge,
  type WorkflowEdgeOutcome,
  type WorkflowEventFilter,
  type WorkflowGraph,
  type WorkflowNode,
  type WorkflowNodePosition,
  type WorkflowExpressionContext,
  type WorkflowNodeExecutionStatus,
  type WorkflowRunDetail,
  type WorkflowSchedule,
  type WorkflowTrigger,
} from '@las/core';
import {ResizablePanel} from './ResizablePanel';
import {WorkflowNodeTestPanel} from './WorkflowNodeTestPanel';
import {WorkflowSplitLayout} from './WorkflowSplitLayout';
import {removeWorkflowConnection} from './workflowGraph';

type Translator = (
  key: string,
  values?: Record<string, string | number>,
) => string;

interface TemplateSummary {
  name: string;
  id: string;
  displayName: string;
  capabilities: {receive: boolean; send: boolean; match: boolean};
  fields: MessageTemplateField[];
}

interface RuleTestResult {
  event: EventEnvelope;
  matches: Array<{
    ruleId: string;
    matched: boolean;
    actions: string[];
    description?: string;
  }>;
}

interface WorkflowWorkspaceProps {
  raw: string;
  rules: RuleConfig[];
  actions: ActionConfig[];
  endpoints: EndpointsConfig;
  templates: TemplateSummary[];
  runs: ActionResult[];
  activeRuns: ActionResult[];
  schedules: ScheduledWorkflowStatus[];
  t: Translator;
  onSaveRules: (rules: RuleConfig[], id: string) => Promise<RuleConfig[]>;
  onSaveRaw: (content: string) => Promise<void>;
  onTest: (eventText: string) => Promise<RuleTestResult>;
  onRunAction: (id: string) => Promise<ActionResult>;
}

type RuleStatusFilter = 'all' | 'enabled' | 'disabled';
type WorkspaceView = 'graph' | 'config';
type WorkflowInspectorMode = 'config' | 'test';

/** Central visual editor for event-triggered automation workflows. */
export function WorkflowWorkspace({
  raw,
  rules,
  actions,
  endpoints,
  templates,
  runs,
  activeRuns,
  schedules,
  t,
  onSaveRules,
  onSaveRaw,
  onTest,
  onRunAction,
}: WorkflowWorkspaceProps) {
  const [view, setView] = React.useState<WorkspaceView>('graph');
  const [query, setQuery] = React.useState('');
  const [statusFilter, setStatusFilter] =
    React.useState<RuleStatusFilter>('all');
  const [inspectorMode, setInspectorMode] =
    React.useState<WorkflowInspectorMode>('config');
  const [originalId, setOriginalId] = React.useState<string | null>(
    rules[0]?.id ?? null,
  );
  const [draft, setDraft] = React.useState<RuleConfig | null>(() =>
    rules[0]
      ? ensureWorkflow(rules[0], actions, t)
      : createWorkflowRule(rules, actions, t),
  );
  const [selectedNodeId, setSelectedNodeId] = React.useState(
    draft?.workflow?.startNodeId ?? '',
  );
  const [connectFrom, setConnectFrom] = React.useState<string | null>(null);
  const [disconnectFrom, setDisconnectFrom] = React.useState<string | null>(
    null,
  );
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [rawDraft, setRawDraft] = React.useState(raw);
  const [testText, setTestText] = React.useState(
    JSON.stringify(
      {source: 'test.event', kind: 'http.request', body: {value: 'demo'}},
      null,
      2,
    ),
  );
  const [testResult, setTestResult] = React.useState<RuleTestResult | null>(
    null,
  );

  React.useEffect(() => setRawDraft(raw), [raw]);

  const filteredRules = rules.filter(rule => {
    if (statusFilter === 'enabled' && !rule.enabled) return false;
    if (statusFilter === 'disabled' && rule.enabled) return false;
    const text = `${rule.id} ${rule.description ?? ''} ${workflowSummary(rule, t)}`;
    return text.toLowerCase().includes(query.trim().toLowerCase());
  });
  const workflow = draft?.workflow;
  const selectedNode = workflow?.nodes.find(node => node.id === selectedNodeId);
  const selectedWorkflowRun = latestWorkflowRun(originalId, activeRuns, runs);
  const selectedWorkflowDetail = workflowRunDetail(selectedWorkflowRun);
  const previewContext = createExpressionPreviewContext(
    draft,
    testResult?.event,
    testText,
    selectedWorkflowRun,
    selectedWorkflowDetail,
  );

  function selectRule(rule: RuleConfig) {
    const next = ensureWorkflow(rule, actions, t);
    setOriginalId(rule.id);
    setDraft(next);
    setSelectedNodeId(next.workflow?.startNodeId ?? '');
    setConnectFrom(null);
    setDisconnectFrom(null);
    setSaveError(null);
  }

  function createRule() {
    const next = createWorkflowRule(rules, actions, t);
    setOriginalId(null);
    setDraft(next);
    setSelectedNodeId(next.workflow?.startNodeId ?? '');
    setConnectFrom(null);
    setDisconnectFrom(null);
    setSaveError(null);
    setInspectorMode('config');
  }

  async function saveDraft() {
    if (!draft?.workflow) return;
    setSaveError(null);
    try {
      const duplicate = rules.some(
        rule => rule.id === draft.id && rule.id !== originalId,
      );
      if (duplicate) throw new Error(t('workflow.error.duplicateId'));
      const stored: RuleConfig = {
        id: draft.id.trim(),
        enabled: draft.enabled,
        description: draft.description?.trim() || undefined,
        workflow: draft.workflow,
      };
      const next = [...rules];
      const index = originalId
        ? next.findIndex(rule => rule.id === originalId)
        : -1;
      if (index >= 0) next[index] = stored;
      else next.push(stored);
      const savedRules = await onSaveRules(next, stored.id);
      const saved = savedRules.find(rule => rule.id === stored.id);
      if (!saved) throw new Error(t('workflow.error.savedRuleMissing'));
      const persisted = ensureWorkflow(saved, actions, t);
      setOriginalId(persisted.id);
      setDraft(persisted);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    }
  }

  async function deleteRule(rule: RuleConfig) {
    if (!window.confirm(t('common.confirmDelete', {id: rule.id}))) return;
    const savedRules = await onSaveRules(
      rules.filter(item => item.id !== rule.id),
      rule.id,
    );
    const next = savedRules[0]
      ? ensureWorkflow(savedRules[0], actions, t)
      : createWorkflowRule([], actions, t);
    setOriginalId(savedRules[0]?.id ?? null);
    setDraft(next);
    setSelectedNodeId(next.workflow?.startNodeId ?? '');
    setConnectFrom(null);
    setDisconnectFrom(null);
  }

  function updateWorkflow(next: WorkflowGraph) {
    setDraft(current => (current ? {...current, workflow: next} : current));
  }

  function updateDraft(patch: Partial<RuleConfig>) {
    setDraft(current => (current ? {...current, ...patch} : current));
  }

  function updateNode(nextNode: WorkflowNode) {
    if (!workflow) return;
    updateWorkflow({
      ...workflow,
      nodes: workflow.nodes.map(node =>
        node.id === nextNode.id ? nextNode : node,
      ),
    });
  }

  function addNode(type: 'action' | 'logic' | 'end') {
    if (!workflow) return;
    const node = createNode(type, workflow, actions, t);
    updateWorkflow({...workflow, nodes: [...workflow.nodes, node]});
    setSelectedNodeId(node.id);
  }

  function deleteSelectedNode() {
    if (!workflow || !selectedNode || selectedNode.type === 'trigger') return;
    if (
      selectedNode.type === 'end' &&
      workflow.nodes.filter(node => node.type === 'end').length === 1
    ) {
      setSaveError(t('workflow.error.lastEnd'));
      return;
    }
    updateWorkflow({
      ...workflow,
      nodes: workflow.nodes.filter(node => node.id !== selectedNode.id),
      edges: workflow.edges.filter(
        edge => edge.from !== selectedNode.id && edge.to !== selectedNode.id,
      ),
    });
    setSelectedNodeId(workflow.startNodeId);
    setConnectFrom(null);
    setDisconnectFrom(null);
  }

  function selectCanvasNode(nodeId: string) {
    if (disconnectFrom && disconnectFrom !== nodeId && workflow) {
      updateWorkflow(
        removeWorkflowConnection(workflow, disconnectFrom, nodeId),
      );
      setDisconnectFrom(null);
      setSelectedNodeId(nodeId);
      return;
    }
    if (connectFrom && connectFrom !== nodeId && workflow) {
      const source = workflow.nodes.find(node => node.id === connectFrom);
      const edge: WorkflowEdge = {
        id: uniqueId(
          'edge',
          workflow.edges.map(item => item.id),
        ),
        from: connectFrom,
        to: nodeId,
        outcome:
          source?.type === 'logic'
            ? 'true'
            : source?.type === 'action'
              ? 'success'
              : 'always',
      };
      updateWorkflow({...workflow, edges: [...workflow.edges, edge]});
      setConnectFrom(null);
    }
    setSelectedNodeId(nodeId);
  }

  async function runSimulation() {
    setTestResult(await onTest(testText));
  }

  return (
    <section className="workflowWorkspace">
      <div className="workspaceToolbar">
        <div className="endpointViewSwitch">
          <button
            className={view === 'graph' ? 'active' : ''}
            onClick={() => setView('graph')}
          >
            <GitBranch size={15} />
            {t('workflow.visualEditor')}
          </button>
          <button
            className={view === 'config' ? 'active' : ''}
            onClick={() => setView('config')}
          >
            <Settings2 size={15} />
            {t('common.configView')}
          </button>
        </div>
        {view === 'graph' && (
          <div className="workflowToolbarActions">
            <select
              aria-label={t('workflow.filterStatus')}
              value={statusFilter}
              onChange={event =>
                setStatusFilter(event.target.value as RuleStatusFilter)
              }
            >
              <option value="all">{t('rule.allStatuses')}</option>
              <option value="enabled">{t('common.enabled')}</option>
              <option value="disabled">{t('common.disabled')}</option>
            </select>
            <label className="endpointSearch">
              <Search size={15} />
              <input
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder={t('workflow.search')}
              />
            </label>
            <button onClick={createRule}>
              <Plus size={16} />
              {t('workflow.create')}
            </button>
          </div>
        )}
      </div>

      {view === 'config' ? (
        <ResizablePanel
          storageKey="workflow-yaml-v2"
          className="panel yamlPanel"
          resetLabel={t('common.resetPanelSize')}
        >
          <div className="panelHead">
            <h2>{t('workflow.configFile')}</h2>
          </div>
          <textarea
            className="codeEditor"
            value={rawDraft}
            onChange={event => setRawDraft(event.target.value)}
            spellCheck={false}
            wrap="off"
          />
          <button className="primaryButton" onClick={() => onSaveRaw(rawDraft)}>
            <Save size={16} />
            {t('common.save')}
          </button>
        </ResizablePanel>
      ) : (
        <WorkflowSplitLayout
          resizeColumnLabel={t('workflow.resizeRegistry')}
          resizeRowLabel={t('workflow.resizeCanvas')}
          registry={
            <WorkflowRuleTable
              rules={filteredRules}
              allRules={rules}
              selectedId={originalId}
              activeRuns={activeRuns}
              runs={runs}
              t={t}
              onSelect={selectRule}
              onDelete={rule => void deleteRule(rule)}
            />
          }
          inspector={
            <WorkflowInspector
              draft={draft}
              workflow={workflow}
              selectedNode={selectedNode}
              mode={inspectorMode}
              actions={actions}
              runs={runs}
              activeRuns={activeRuns}
              endpoints={endpoints}
              templates={templates}
              previewContext={previewContext}
              schedules={schedules}
              testText={testText}
              testResult={testResult}
              saveError={saveError}
              t={t}
              onModeChange={setInspectorMode}
              onDraftChange={updateDraft}
              onNodeChange={updateNode}
              onWorkflowChange={updateWorkflow}
              onTestTextChange={setTestText}
              onSave={() => void saveDraft()}
              onRunSimulation={runSimulation}
              onRunAction={onRunAction}
            />
          }
          canvas={
            <>
              <div className="workflowCanvasToolbar">
                <div>
                  <span>{t('workflow.canvasDescription')}</span>
                  <strong>{t('workflow.canvas')}</strong>
                </div>
                <div>
                  <button onClick={() => addNode('action')}>
                    <Plus size={14} />
                    {t('workflow.addAction')}
                  </button>
                  <button onClick={() => addNode('logic')}>
                    <Plus size={14} />
                    {t('workflow.addLogic')}
                  </button>
                  <button onClick={() => addNode('end')}>
                    <Plus size={14} />
                    {t('workflow.addEnd')}
                  </button>
                  <button
                    className={connectFrom ? 'active' : ''}
                    aria-pressed={Boolean(connectFrom)}
                    disabled={!selectedNode || selectedNode.type === 'end'}
                    onClick={() =>
                      setConnectFrom(current => {
                        setDisconnectFrom(null);
                        return current ? null : selectedNodeId;
                      })
                    }
                  >
                    {connectFrom ? <Unlink size={14} /> : <Link2 size={14} />}
                    {connectFrom
                      ? t('workflow.cancelConnect')
                      : t('workflow.connect')}
                  </button>
                  <button
                    className={disconnectFrom ? 'active dangerButton' : ''}
                    aria-pressed={Boolean(disconnectFrom)}
                    disabled={
                      !selectedNode ||
                      selectedNode.type === 'end' ||
                      !workflow?.edges.some(
                        edge => edge.from === selectedNode.id,
                      )
                    }
                    onClick={() =>
                      setDisconnectFrom(current => {
                        setConnectFrom(null);
                        return current ? null : selectedNodeId;
                      })
                    }
                  >
                    <Unlink size={14} />
                    {disconnectFrom
                      ? t('workflow.cancelDisconnect')
                      : t('workflow.disconnect')}
                  </button>
                  <button
                    className="dangerButton"
                    disabled={!selectedNode || selectedNode.type === 'trigger'}
                    onClick={deleteSelectedNode}
                  >
                    <Trash2 size={14} />
                    {t('common.delete')}
                  </button>
                </div>
              </div>
              <WorkflowRuntimeStrip
                run={selectedWorkflowRun}
                detail={selectedWorkflowDetail}
                t={t}
              />
              {workflow ? (
                <WorkflowCanvas
                  workflow={workflow}
                  runtime={selectedWorkflowDetail}
                  selectedNodeId={selectedNodeId}
                  connectFrom={connectFrom}
                  disconnectFrom={disconnectFrom}
                  t={t}
                  onSelect={selectCanvasNode}
                  onMove={(id, position) =>
                    updateWorkflow({
                      ...workflow,
                      nodes: workflow.nodes.map(node =>
                        node.id === id ? {...node, position} : node,
                      ),
                    })
                  }
                />
              ) : (
                <div className="inspectorEmpty">{t('workflow.selectTask')}</div>
              )}
            </>
          }
        />
      )}
    </section>
  );
}

function WorkflowRuleTable({
  rules,
  allRules,
  selectedId,
  activeRuns,
  runs,
  t,
  onSelect,
  onDelete,
}: {
  rules: RuleConfig[];
  allRules: RuleConfig[];
  selectedId: string | null;
  activeRuns: ActionResult[];
  runs: ActionResult[];
  t: Translator;
  onSelect: (rule: RuleConfig) => void;
  onDelete: (rule: RuleConfig) => void;
}) {
  return (
    <div className="connectionTable workflowConnectionTable">
      <div className="connectionSummary">
        <div>
          <span>{t('workflow.registryDescription')}</span>
          <strong>{t('workflow.registry')}</strong>
        </div>
        <div className="connectionStats">
          <span>
            <strong>
              {rules.length}/{allRules.length}
            </strong>
            {t('rule.visible')}
          </span>
          <span>
            <strong>{allRules.filter(rule => rule.enabled).length}</strong>
            {t('rule.active')}
          </span>
        </div>
      </div>
      <div className="connectionRows">
        <div className="connectionTableHead">
          <span>{t('field.id')}</span>
          <span>{t('workflow.nodes')}</span>
          <span>{t('rule.triggerSource')}</span>
          <span>{t('endpoint.lastActivity')}</span>
          <span />
        </div>
        {rules.map(rule => {
          const latest = latestWorkflowRun(rule.id, activeRuns, runs);
          const latestAt =
            latest?.finishedAt ?? latest?.startedAt ?? latest?.queuedAt;
          return (
            <div
              role="button"
              tabIndex={0}
              className={`connectionRow${rule.id === selectedId ? ' selected' : ''}${rule.enabled ? '' : ' disabled'}`}
              key={rule.id}
              onClick={() => onSelect(rule)}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') onSelect(rule);
              }}
            >
              <span className="connectionIdentity">
                <i />
                <strong>{rule.id}</strong>
                <small
                  className={
                    rule.enabled
                      ? 'statusBadge enabled'
                      : 'statusBadge disabled'
                  }
                >
                  {t(rule.enabled ? 'common.enabled' : 'common.disabled')}
                </small>
              </span>
              <code>{workflowNodeCount(rule)}</code>
              <span className="connectionUrl">{workflowSummary(rule, t)}</span>
              <em>
                {latestAt
                  ? new Date(latestAt).toLocaleTimeString()
                  : t('endpoint.noActivity')}
              </em>
              <span className="connectionActions">
                <button
                  className="dangerIconButton"
                  title={`${t('common.delete')} ${rule.id}`}
                  onClick={event => {
                    event.stopPropagation();
                    onDelete(rule);
                  }}
                >
                  <Trash2 size={15} />
                </button>
              </span>
            </div>
          );
        })}
        {rules.length === 0 && (
          <div className="connectionEmpty">
            <Search size={20} />
            <span>{t('rule.noMatches')}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function WorkflowInspector({
  draft,
  workflow,
  selectedNode,
  mode,
  actions,
  runs,
  activeRuns,
  endpoints,
  templates,
  previewContext,
  schedules,
  testText,
  testResult,
  saveError,
  t,
  onModeChange,
  onDraftChange,
  onNodeChange,
  onWorkflowChange,
  onTestTextChange,
  onSave,
  onRunSimulation,
  onRunAction,
}: {
  draft: RuleConfig | null;
  workflow?: WorkflowGraph;
  selectedNode?: WorkflowNode;
  mode: WorkflowInspectorMode;
  actions: ActionConfig[];
  runs: ActionResult[];
  activeRuns: ActionResult[];
  endpoints: EndpointsConfig;
  templates: TemplateSummary[];
  previewContext: WorkflowExpressionContext;
  schedules: ScheduledWorkflowStatus[];
  testText: string;
  testResult: RuleTestResult | null;
  saveError: string | null;
  t: Translator;
  onModeChange: (mode: WorkflowInspectorMode) => void;
  onDraftChange: (patch: Partial<RuleConfig>) => void;
  onNodeChange: (node: WorkflowNode) => void;
  onWorkflowChange: (workflow: WorkflowGraph) => void;
  onTestTextChange: (value: string) => void;
  onSave: () => void;
  onRunSimulation: () => Promise<void>;
  onRunAction: (id: string) => Promise<ActionResult>;
}) {
  if (!draft || !workflow) {
    return (
      <div className="inspectorEmpty">
        <Settings2 size={22} />
        <span>{t('workflow.selectTask')}</span>
      </div>
    );
  }

  return (
    <>
      <div className="inspectorTabs">
        <button
          className={mode === 'config' ? 'active' : ''}
          onClick={() => onModeChange('config')}
        >
          <Settings2 size={15} />
          {t('workflow.taskConfiguration')}
        </button>
        <button
          className={mode === 'test' ? 'active' : ''}
          onClick={() => onModeChange('test')}
        >
          <Play size={15} />
          {t('workflow.nodeTest')}
        </button>
      </div>
      {mode === 'config' ? (
        <div className="inspectorEditor">
          <section className="inspectorEditorPanel workflowInspectorEditor">
            <div className="modalHead">
              <div>
                <span>{t('workflow.taskConfiguration')}</span>
                <h2>{draft.id}</h2>
              </div>
            </div>
            <div className="formGrid">
              {saveError && (
                <div className="formError wideLabel">{saveError}</div>
              )}
              <label>
                <span>{t('field.id')}</span>
                <input
                  value={draft.id}
                  onChange={event => onDraftChange({id: event.target.value})}
                />
              </label>
              <label className="checkLabel">
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={event =>
                    onDraftChange({enabled: event.target.checked})
                  }
                />
                <span>{t('field.enabled')}</span>
              </label>
              <label className="wideLabel">
                <span>{t('field.description')}</span>
                <input
                  value={draft.description ?? ''}
                  onChange={event =>
                    onDraftChange({description: event.target.value})
                  }
                />
              </label>
            </div>
            <div className="workflowNodeInspectorHead">
              <span>{t('workflow.selectedNode')}</span>
              <strong>{selectedNode?.label ?? t('workflow.selectNode')}</strong>
            </div>
            {selectedNode ? (
              <WorkflowNodeEditor
                node={selectedNode}
                workflow={workflow}
                actions={actions}
                endpoints={endpoints}
                templates={templates}
                previewContext={previewContext}
                t={t}
                onChange={onNodeChange}
                onChangeWorkflow={onWorkflowChange}
              />
            ) : (
              <div className="inspectorEmpty">{t('workflow.selectNode')}</div>
            )}
            <div className="modalActions">
              <button className="primaryButton" onClick={onSave}>
                <Save size={15} />
                {t('common.save')}
              </button>
            </div>
          </section>
        </div>
      ) : (
        <WorkflowNodeTestPanel
          ruleId={draft.id}
          ruleEnabled={draft.enabled}
          node={selectedNode}
          actions={actions}
          runs={runs}
          activeRuns={activeRuns}
          schedules={schedules}
          eventText={testText}
          eventResult={testResult}
          previewContext={previewContext}
          t={t}
          onEventTextChange={onTestTextChange}
          onRunEvent={onRunSimulation}
          onRunAction={onRunAction}
        />
      )}
    </>
  );
}

function WorkflowRuntimeStrip({
  run,
  detail,
  t,
}: {
  run?: ActionResult;
  detail?: WorkflowRunDetail;
  t: Translator;
}) {
  if (!run || !detail) {
    return (
      <div className="workflowRuntimeStrip empty">
        {t('workflow.runtime.noRuns')}
      </div>
    );
  }
  return (
    <div className={`workflowRuntimeStrip ${run.status}`}>
      <div>
        <span>{t('workflow.runtime.latest')}</span>
        <strong>{t(`run.${run.status}`)}</strong>
        <code>{run.traceId}</code>
      </div>
      <div className="workflowRuntimeSteps">
        {detail.timeline.slice(-8).map(entry => (
          <span className={entry.status} key={entry.id} title={entry.error}>
            {entry.nodeId}
          </span>
        ))}
        {detail.timeline.length === 0 && (
          <span>{t('workflow.runtime.waiting')}</span>
        )}
      </div>
    </div>
  );
}

function WorkflowCanvas({
  workflow,
  runtime,
  selectedNodeId,
  connectFrom,
  disconnectFrom,
  t,
  onSelect,
  onMove,
}: {
  workflow: WorkflowGraph;
  runtime?: WorkflowRunDetail;
  selectedNodeId: string;
  connectFrom: string | null;
  disconnectFrom: string | null;
  t: Translator;
  onSelect: (id: string) => void;
  onMove: (id: string, position: WorkflowNodePosition) => void;
}) {
  const positions = new Map(
    workflow.nodes.map((node, index) => [
      node.id,
      node.position ?? defaultPosition(node, index),
    ]),
  );
  const canvasWidth = Math.max(
    1000,
    ...[...positions.values()].map(position => position.x + 240),
  );
  const canvasHeight = Math.max(
    420,
    ...[...positions.values()].map(position => position.y + 140),
  );
  return (
    <div
      className={`workflowCanvas${connectFrom ? ' connecting' : ''}${disconnectFrom ? ' disconnecting' : ''}`}
      style={{width: canvasWidth, height: canvasHeight}}
    >
      <svg className="workflowEdges" aria-hidden="true">
        <defs>
          <marker
            id="workflowArrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" />
          </marker>
        </defs>
        {workflow.edges.map(edge => {
          const from = positions.get(edge.from);
          const to = positions.get(edge.to);
          if (!from || !to) return null;
          const startX = from.x + 196;
          const startY = from.y + 46;
          const endX = to.x;
          const endY = to.y + 46;
          const bend = Math.max(55, Math.abs(endX - startX) / 2);
          const path = `M ${startX} ${startY} C ${startX + bend} ${startY}, ${endX - bend} ${endY}, ${endX} ${endY}`;
          const taken = runtime?.timeline.some(
            entry =>
              entry.nodeId === edge.from &&
              (edge.outcome === 'always' || entry.outcome === edge.outcome),
          );
          return (
            <g
              className={`edge-${edge.outcome}${taken ? ' runtime-taken' : ''}`}
              key={edge.id}
            >
              <path d={path} markerEnd="url(#workflowArrow)" />
              <text x={(startX + endX) / 2} y={(startY + endY) / 2 - 7}>
                {edge.label || t(`workflow.outcome.${edge.outcome}`)}
              </text>
            </g>
          );
        })}
      </svg>
      {workflow.nodes.map((node, index) => {
        const position = positions.get(node.id) ?? defaultPosition(node, index);
        return (
          <WorkflowCanvasNode
            key={node.id}
            node={node}
            position={position}
            selected={node.id === selectedNodeId}
            connecting={node.id === connectFrom}
            disconnecting={node.id === disconnectFrom}
            runtimeStatus={workflowNodeRuntimeStatus(runtime, node.id)}
            t={t}
            onSelect={() => onSelect(node.id)}
            onMove={position => onMove(node.id, position)}
          />
        );
      })}
    </div>
  );
}

function WorkflowCanvasNode({
  node,
  position,
  selected,
  connecting,
  disconnecting,
  runtimeStatus,
  t,
  onSelect,
  onMove,
}: {
  node: WorkflowNode;
  position: WorkflowNodePosition;
  selected: boolean;
  connecting: boolean;
  disconnecting: boolean;
  runtimeStatus?: WorkflowNodeExecutionStatus;
  t: Translator;
  onSelect: () => void;
  onMove: (position: WorkflowNodePosition) => void;
}) {
  const drag = React.useRef<{
    clientX: number;
    clientY: number;
    x: number;
    y: number;
  } | null>(null);
  const Icon = nodeIcon(node);
  return (
    <article
      className={`workflowNode ${node.type}${selected ? ' selected' : ''}${connecting ? ' connecting' : ''}${disconnecting ? ' disconnecting' : ''}${runtimeStatus ? ` runtime-${runtimeStatus}` : ''}`}
      style={{left: position.x, top: position.y}}
    >
      <button
        className="workflowNodeGrip"
        title={t('workflow.dragNode')}
        onPointerDown={event => {
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = {
            clientX: event.clientX,
            clientY: event.clientY,
            x: position.x,
            y: position.y,
          };
        }}
        onPointerMove={event => {
          if (!drag.current) return;
          onMove({
            x: Math.max(
              12,
              drag.current.x + event.clientX - drag.current.clientX,
            ),
            y: Math.max(
              12,
              drag.current.y + event.clientY - drag.current.clientY,
            ),
          });
        }}
        onPointerUp={() => (drag.current = null)}
      >
        <GripVertical size={14} />
      </button>
      <button className="workflowNodeBody" onClick={onSelect}>
        <span>
          <Icon size={16} />
          {t(`workflow.node.${node.type}`)}
        </span>
        <strong>{node.label}</strong>
        <small>{nodeSummary(node, t)}</small>
        {runtimeStatus && <em>{t(`workflow.runtime.${runtimeStatus}`)}</em>}
      </button>
    </article>
  );
}

function WorkflowNodeEditor({
  node,
  workflow,
  actions,
  endpoints,
  templates,
  previewContext,
  t,
  onChange,
  onChangeWorkflow,
}: {
  node: WorkflowNode;
  workflow: WorkflowGraph;
  actions: ActionConfig[];
  endpoints: EndpointsConfig;
  templates: TemplateSummary[];
  previewContext: WorkflowExpressionContext;
  t: Translator;
  onChange: (node: WorkflowNode) => void;
  onChangeWorkflow: (workflow: WorkflowGraph) => void;
}) {
  const outgoing = workflow.edges.filter(edge => edge.from === node.id);
  return (
    <div className="workflowNodeEditor">
      <div className="workflowCompactGrid">
        <label>
          <span>{t('workflow.nodeId')}</span>
          <input value={node.id} disabled />
        </label>
        <label>
          <span>{t('workflow.nodeLabel')}</span>
          <input
            value={node.label}
            onChange={event => onChange({...node, label: event.target.value})}
          />
        </label>
      </div>
      {node.type === 'trigger' && (
        <WorkflowTriggerEditor
          trigger={node.trigger}
          endpoints={endpoints}
          templates={templates}
          t={t}
          onChange={trigger => onChange({...node, trigger})}
        />
      )}
      {node.type === 'action' && (
        <WorkflowActionEditor
          action={node.action}
          actions={actions}
          previewContext={previewContext}
          t={t}
          onChange={action => onChange({...node, action})}
        />
      )}
      {node.type === 'logic' && (
        <LogicEditor node={node} t={t} onChange={onChange} />
      )}
      {node.type === 'end' && (
        <div className="workflowCompactGrid">
          <label>
            <span>{t('workflow.endStatus')}</span>
            <select
              value={node.end.status}
              onChange={event =>
                onChange({
                  ...node,
                  end: {
                    ...node.end,
                    status: event.target.value as 'completed' | 'failed',
                  },
                })
              }
            >
              <option value="completed">{t('run.completed')}</option>
              <option value="failed">{t('run.failed')}</option>
            </select>
          </label>
          <label>
            <span>{t('workflow.endMessage')}</span>
            <input
              value={node.end.message ?? ''}
              onChange={event =>
                onChange({
                  ...node,
                  end: {...node.end, message: event.target.value},
                })
              }
            />
          </label>
        </div>
      )}
      {node.type !== 'end' && (
        <fieldset className="workflowEdgeEditor">
          <legend>{t('workflow.outgoingEdges')}</legend>
          {outgoing.map(edge => (
            <div key={edge.id}>
              <select
                value={edge.outcome}
                onChange={event =>
                  onChangeWorkflow({
                    ...workflow,
                    edges: workflow.edges.map(item =>
                      item.id === edge.id
                        ? {
                            ...item,
                            outcome: event.target.value as WorkflowEdgeOutcome,
                          }
                        : item,
                    ),
                  })
                }
              >
                {edgeOutcomes(node).map(outcome => (
                  <option value={outcome} key={outcome}>
                    {t(`workflow.outcome.${outcome}`)}
                  </option>
                ))}
              </select>
              <select
                value={edge.to}
                onChange={event =>
                  onChangeWorkflow({
                    ...workflow,
                    edges: workflow.edges.map(item =>
                      item.id === edge.id
                        ? {...item, to: event.target.value}
                        : item,
                    ),
                  })
                }
              >
                {workflow.nodes
                  .filter(item => item.id !== node.id)
                  .map(item => (
                    <option value={item.id} key={item.id}>
                      {item.label}
                    </option>
                  ))}
              </select>
              <button
                title={t('workflow.removeConnection')}
                onClick={() =>
                  onChangeWorkflow({
                    ...workflow,
                    edges: workflow.edges.filter(item => item.id !== edge.id),
                  })
                }
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          {outgoing.length === 0 && <p>{t('workflow.noOutgoingEdges')}</p>}
        </fieldset>
      )}
    </div>
  );
}

function WorkflowTriggerEditor({
  trigger,
  endpoints,
  templates,
  t,
  onChange,
}: {
  trigger: WorkflowTrigger;
  endpoints: EndpointsConfig;
  templates: TemplateSummary[];
  t: Translator;
  onChange: (trigger: WorkflowTrigger) => void;
}) {
  const mode = trigger.type === 'event' ? 'event' : trigger.schedule.mode;
  const intervalSchedule =
    trigger.type === 'time' && trigger.schedule.mode === 'interval'
      ? trigger.schedule
      : undefined;
  const onceSchedule =
    trigger.type === 'time' && trigger.schedule.mode === 'once'
      ? trigger.schedule
      : undefined;
  const dailySchedule =
    trigger.type === 'time' && trigger.schedule.mode === 'daily'
      ? trigger.schedule
      : undefined;
  return (
    <fieldset className="workflowFilterEditor">
      <legend>{t('workflow.triggerConfiguration')}</legend>
      <div className="workflowCompactGrid">
        <label>
          <span>{t('workflow.triggerType')}</span>
          <select
            value={mode}
            onChange={event =>
              onChange(createWorkflowTrigger(event.target.value))
            }
          >
            <option value="event">{t('workflow.trigger.event')}</option>
            <option value="once">{t('workflow.trigger.once')}</option>
            <option value="interval">{t('workflow.trigger.interval')}</option>
            <option value="daily">{t('workflow.trigger.daily')}</option>
          </select>
        </label>
        {onceSchedule && (
          <label>
            <span>{t('workflow.triggerAt')}</span>
            <input
              type="datetime-local"
              value={onceSchedule.at}
              onChange={event =>
                onChange({
                  type: 'time',
                  schedule: {
                    mode: 'once',
                    at: event.target.value,
                    misfirePolicy: onceSchedule.misfirePolicy,
                  },
                })
              }
            />
          </label>
        )}
        {intervalSchedule && (
          <>
            <label>
              <span>{t('workflow.triggerIntervalSeconds')}</span>
              <input
                type="number"
                min="1"
                value={intervalSchedule.everyMs / 1000}
                onChange={event =>
                  onChange({
                    type: 'time',
                    schedule: {
                      mode: 'interval',
                      everyMs: Math.max(
                        1000,
                        Number(event.target.value) * 1000,
                      ),
                      startAt: intervalSchedule.startAt,
                      misfirePolicy: intervalSchedule.misfirePolicy,
                    },
                  })
                }
              />
            </label>
            <label>
              <span>{t('workflow.triggerStartAt')}</span>
              <input
                type="datetime-local"
                value={intervalSchedule.startAt ?? ''}
                onChange={event =>
                  onChange({
                    type: 'time',
                    schedule: {
                      mode: 'interval',
                      everyMs: intervalSchedule.everyMs,
                      startAt: event.target.value || undefined,
                      misfirePolicy: intervalSchedule.misfirePolicy,
                    },
                  })
                }
              />
            </label>
          </>
        )}
        {dailySchedule && (
          <>
            <label>
              <span>{t('workflow.triggerDailyTime')}</span>
              <input
                type="time"
                step="1"
                value={dailySchedule.time}
                onChange={event =>
                  onChange({
                    type: 'time',
                    schedule: {
                      mode: 'daily',
                      time: event.target.value,
                      timeZone: dailySchedule.timeZone,
                      misfirePolicy: dailySchedule.misfirePolicy,
                    },
                  })
                }
              />
            </label>
            <label>
              <span>{t('workflow.triggerTimeZone')}</span>
              <input
                value={dailySchedule.timeZone ?? ''}
                placeholder={Intl.DateTimeFormat().resolvedOptions().timeZone}
                onChange={event =>
                  onChange({
                    type: 'time',
                    schedule: {
                      mode: 'daily',
                      time: dailySchedule.time,
                      timeZone: event.target.value || undefined,
                      misfirePolicy: dailySchedule.misfirePolicy,
                    },
                  })
                }
              />
            </label>
          </>
        )}
        {trigger.type === 'time' && (
          <label>
            <span>{t('workflow.triggerMisfire')}</span>
            <select
              value={trigger.schedule.misfirePolicy ?? 'skip'}
              onChange={event =>
                onChange({
                  type: 'time',
                  schedule: setMisfirePolicy(
                    trigger.schedule,
                    event.target.value as 'skip' | 'runOnce',
                  ),
                })
              }
            >
              <option value="skip">{t('workflow.misfire.skip')}</option>
              <option value="runOnce">{t('workflow.misfire.runOnce')}</option>
            </select>
          </label>
        )}
      </div>
      {trigger.type === 'time' && (
        <p className="workflowFieldHint">{t('workflow.timeZoneHint')}</p>
      )}
      {trigger.type === 'event' && (
        <EventFilterEditor
          filter={trigger.event}
          endpoints={endpoints}
          templates={templates}
          t={t}
          onChange={event => onChange({type: 'event', event})}
        />
      )}
    </fieldset>
  );
}

function EventFilterEditor({
  filter,
  endpoints,
  templates,
  t,
  onChange,
}: {
  filter: WorkflowEventFilter;
  endpoints: EndpointsConfig;
  templates: TemplateSummary[];
  t: Translator;
  onChange: (filter: WorkflowEventFilter) => void;
}) {
  const conditions = matchConditions(filter.match);
  const template = templates.find(
    item => item.name === filter.template || item.id === filter.template,
  );
  return (
    <fieldset className="workflowFilterEditor">
      <legend>{t('workflow.eventFilter')}</legend>
      <div className="workflowCompactGrid">
        <label className="checkField">
          <input
            type="checkbox"
            checked={filter.anySource ?? !filter.source}
            onChange={event =>
              onChange({
                ...filter,
                anySource: event.target.checked,
                source: event.target.checked ? undefined : filter.source,
              })
            }
          />
          <span>{t('rule.anySource')}</span>
        </label>
        <label>
          <span>{t('workflow.source')}</span>
          <select
            disabled={filter.anySource ?? !filter.source}
            value={filter.source ?? ''}
            onChange={event =>
              onChange({...filter, source: event.target.value || undefined})
            }
          >
            <option value="">{t('workflow.selectSource')}</option>
            {eventSources(endpoints).map(source => (
              <option value={source} key={source}>
                {source}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{t('field.eventKind')}</span>
          <select
            value={filter.kind ?? ''}
            onChange={event =>
              onChange({
                ...filter,
                kind:
                  (event.target.value as WorkflowEventFilter['kind']) ||
                  undefined,
              })
            }
          >
            <option value="">{t('rule.anyKind')}</option>
            <option value="http.request">http.request</option>
            <option value="http.response">http.response</option>
            <option value="ws.message">ws.message</option>
            <option value="action.result">action.result</option>
          </select>
        </label>
        <label>
          <span>{t('field.messageTemplate')}</span>
          <select
            value={filter.template ?? ''}
            onChange={event =>
              onChange({...filter, template: event.target.value || undefined})
            }
          >
            <option value="">{t('template.none')}</option>
            {templates
              .filter(
                item => item.capabilities.receive || item.capabilities.match,
              )
              .map(item => (
                <option value={item.name} key={item.name}>
                  {item.displayName}
                </option>
              ))}
          </select>
        </label>
      </div>
      <div className="workflowConditionList">
        <div className="workflowSubhead">
          <strong>{t('workflow.conditions')}</strong>
          <button
            onClick={() =>
              onChange({
                ...filter,
                match: conditionsToMatch([
                  ...conditions,
                  {jsonPath: '$.body.value', equals: ''},
                ]),
              })
            }
          >
            <Plus size={14} />
            {t('workflow.addCondition')}
          </button>
        </div>
        {conditions.map((condition, index) => (
          <ConditionEditor
            key={`${condition.jsonPath ?? 'body'}-${index}`}
            condition={condition}
            template={template}
            t={t}
            onChange={next =>
              onChange({
                ...filter,
                match: conditionsToMatch(
                  conditions.map((item, itemIndex) =>
                    itemIndex === index ? next : item,
                  ),
                ),
              })
            }
            onDelete={() =>
              onChange({
                ...filter,
                match: conditionsToMatch(
                  conditions.filter((_, itemIndex) => itemIndex !== index),
                ),
              })
            }
          />
        ))}
        {conditions.length === 0 && <p>{t('workflow.noConditions')}</p>}
      </div>
    </fieldset>
  );
}

function ConditionEditor({
  condition,
  template,
  t,
  onChange,
  onDelete,
}: {
  condition: MatchCondition;
  template?: TemplateSummary;
  t: Translator;
  onChange: (condition: MatchCondition) => void;
  onDelete: () => void;
}) {
  const operator = conditionOperator(condition);
  const value = conditionValue(condition);
  const fields = template?.fields.filter(field => field.roles.match) ?? [];
  return (
    <div className="workflowConditionRow">
      <select
        aria-label={t('workflow.templateField')}
        value={
          fields.some(field => templateFieldPath(field) === condition.jsonPath)
            ? condition.jsonPath
            : '__custom__'
        }
        onChange={event =>
          onChange({
            ...condition,
            jsonPath:
              event.target.value === '__custom__'
                ? condition.jsonPath
                : event.target.value,
          })
        }
      >
        <option value="__custom__">{t('workflow.customPath')}</option>
        {fields.map(field => (
          <option value={templateFieldPath(field)} key={field.key}>
            {field.label}
          </option>
        ))}
      </select>
      <input
        aria-label={t('field.jsonPath')}
        value={condition.jsonPath ?? ''}
        onChange={event =>
          onChange({...condition, jsonPath: event.target.value || undefined})
        }
      />
      <select
        aria-label={t('field.operator')}
        value={operator}
        onChange={event =>
          onChange(
            buildCondition(
              condition.jsonPath,
              event.target.value as 'equals' | 'contains' | 'regex',
              value,
            ),
          )
        }
      >
        <option value="equals">{t('operator.equals')}</option>
        <option value="contains">{t('operator.contains')}</option>
        <option value="regex">{t('operator.regex')}</option>
      </select>
      <input
        aria-label={t('field.matchValue')}
        value={stringifyInputValue(value)}
        onChange={event =>
          onChange(
            buildCondition(
              condition.jsonPath,
              operator,
              parseLooseValue(event.target.value),
            ),
          )
        }
      />
      <button title={t('common.delete')} onClick={onDelete}>
        <Trash2 size={14} />
      </button>
    </div>
  );
}

function WorkflowActionEditor({
  action,
  actions,
  previewContext,
  t,
  onChange,
}: {
  action: WorkflowActionSpec;
  actions: ActionConfig[];
  previewContext: WorkflowExpressionContext;
  t: Translator;
  onChange: (action: WorkflowActionSpec) => void;
}) {
  const selected =
    action.type === 'reference'
      ? actions.find(item => item.id === action.actionId)
      : undefined;
  const bindingSource =
    action.type === 'reference'
      ? JSON.stringify(action.with ?? {}, null, 2)
      : '{}';
  const [bindingsText, setBindingsText] = React.useState(bindingSource);
  const [bindingsError, setBindingsError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setBindingsText(bindingSource);
    setBindingsError(null);
  }, [bindingSource]);

  function commitBindings() {
    if (action.type !== 'reference') return;
    try {
      const parsed = JSON.parse(bindingsText || '{}') as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(t('workflow.expression.bindingsObject'));
      }
      setBindingsError(null);
      onChange({...action, with: parsed as Record<string, unknown>});
    } catch (error) {
      setBindingsError(error instanceof Error ? error.message : String(error));
    }
  }

  const preview = actionExpressionPreview(action, selected, previewContext);
  return (
    <fieldset className="workflowActionEditor">
      <legend>{t('workflow.actionConfiguration')}</legend>
      <div className="workflowCompactGrid">
        <label className="wideField">
          <span>{t('workflow.referencedAction')}</span>
          <select
            value={action.type === 'reference' ? action.actionId : ''}
            onChange={event => {
              const previous = action.type === 'reference' ? action : undefined;
              onChange({
                type: 'reference',
                actionId: event.target.value,
                with: previous?.with,
                onMissing: previous?.onMissing,
              });
            }}
          >
            <option value="" disabled>
              {t('workflow.selectAction')}
            </option>
            {actions.map(item => (
              <option value={item.id} key={item.id}>
                {item.id} · {t(`workflow.action.${item.type}`)}
              </option>
            ))}
          </select>
        </label>
        {action.type === 'reference' && (
          <label>
            <span>{t('workflow.expression.onMissing')}</span>
            <select
              value={action.onMissing ?? 'error'}
              onChange={event =>
                onChange({
                  ...action,
                  onMissing: event.target.value as typeof action.onMissing,
                })
              }
            >
              <option value="error">
                {t('action.expressionPolicy.error')}
              </option>
              <option value="empty">
                {t('action.expressionPolicy.empty')}
              </option>
              <option value="preserve">
                {t('action.expressionPolicy.preserve')}
              </option>
            </select>
          </label>
        )}
      </div>
      {action.type === 'reference' && (
        <label className="workflowBindingEditor">
          <span>{t('workflow.expression.bindings')}</span>
          <textarea
            value={bindingsText}
            onChange={event => setBindingsText(event.target.value)}
            onBlur={commitBindings}
            spellCheck={false}
          />
          {bindingsError && (
            <small className="inlineError">{bindingsError}</small>
          )}
        </label>
      )}
      {action.type !== 'reference' && (
        <p className="workflowFieldWarning">
          {t('workflow.legacyInlineAction')}
        </p>
      )}
      {actions.length === 0 && (
        <p className="workflowFieldWarning">{t('workflow.noSavedActions')}</p>
      )}
      {selected && (
        <p className="workflowFieldHint">
          {selected.description || t(`workflow.action.${selected.type}`)}
        </p>
      )}
      {action.type === 'reference' && (
        <div className="workflowExpressionPreview">
          <strong>{t('workflow.expression.preview')}</strong>
          {preview.items.map((item, index) => (
            <div
              className={item.ok ? 'ok' : 'failed'}
              key={`${item.path}-${index}`}
            >
              <code>{item.path || t('workflow.expression.syntax')}</code>
              <span>{item.message}</span>
            </div>
          ))}
          {preview.items.length === 0 && <p>{t('workflow.expression.none')}</p>}
        </div>
      )}
    </fieldset>
  );
}

function LogicEditor({
  node,
  t,
  onChange,
}: {
  node: Extract<WorkflowNode, {type: 'logic'}>;
  t: Translator;
  onChange: (node: WorkflowNode) => void;
}) {
  return (
    <fieldset className="workflowLogicEditor">
      <legend>{t('workflow.logicConfiguration')}</legend>
      <div className="workflowCompactGrid">
        <label>
          <span>{t('workflow.logicInput')}</span>
          <select
            value={node.logic.input}
            onChange={event =>
              onChange({
                ...node,
                logic: {
                  ...node.logic,
                  input: event.target.value as typeof node.logic.input,
                },
              })
            }
          >
            <option value="lastResult">{t('workflow.input.lastResult')}</option>
            <option value="triggerEvent">
              {t('workflow.input.triggerEvent')}
            </option>
            <option value="lastEvent">{t('workflow.input.lastEvent')}</option>
          </select>
        </label>
        <label>
          <span>{t('field.operator')}</span>
          <select
            value={node.logic.operator}
            onChange={event =>
              onChange({
                ...node,
                logic: {
                  ...node.logic,
                  operator: event.target.value as typeof node.logic.operator,
                },
              })
            }
          >
            {['success', 'equals', 'contains', 'regex', 'truthy'].map(
              operator => (
                <option value={operator} key={operator}>
                  {t(`workflow.logic.${operator}`)}
                </option>
              ),
            )}
          </select>
        </label>
        <label>
          <span>{t('field.jsonPath')}</span>
          <input
            value={node.logic.jsonPath ?? ''}
            disabled={node.logic.operator === 'success'}
            onChange={event =>
              onChange({
                ...node,
                logic: {
                  ...node.logic,
                  jsonPath: event.target.value || undefined,
                },
              })
            }
          />
        </label>
        <label>
          <span>{t('field.matchValue')}</span>
          <input
            value={stringifyInputValue(node.logic.value)}
            disabled={
              node.logic.operator === 'success' ||
              node.logic.operator === 'truthy'
            }
            onChange={event =>
              onChange({
                ...node,
                logic: {
                  ...node.logic,
                  value: parseLooseValue(event.target.value),
                },
              })
            }
          />
        </label>
      </div>
    </fieldset>
  );
}

interface ExpressionPreviewItem {
  path: string;
  ok: boolean;
  message: string;
}

function actionExpressionPreview(
  spec: WorkflowActionSpec,
  action: ActionConfig | undefined,
  context: WorkflowExpressionContext,
): {items: ExpressionPreviewItem[]} {
  if (spec.type !== 'reference' || !action) return {items: []};
  const items: ExpressionPreviewItem[] = [];
  const bindingDiagnostics = inspectWorkflowExpressions(
    spec.with ?? {},
    context,
  );
  for (const diagnostic of bindingDiagnostics) {
    const fallback = Object.hasOwn(diagnostic, 'fallback');
    items.push({
      path: diagnostic.path,
      ok: diagnostic.found || fallback,
      message: diagnostic.error
        ? diagnostic.error
        : diagnostic.found
          ? formatExpressionPreviewValue(diagnostic.value)
          : fallback
            ? formatExpressionPreviewValue(diagnostic.fallback)
            : 'Missing value',
    });
  }
  try {
    const inputs = resolveWorkflowExpressions(spec.with ?? {}, context, {
      onMissing: spec.onMissing ?? action.expressionPolicy ?? 'error',
    });
    const actionContext = {...context, inputs};
    const actionDiagnostics = inspectWorkflowExpressions(action, actionContext);
    for (const diagnostic of actionDiagnostics) {
      const fallback = Object.hasOwn(diagnostic, 'fallback');
      items.push({
        path: diagnostic.path,
        ok: diagnostic.found || fallback,
        message: diagnostic.error
          ? diagnostic.error
          : diagnostic.found
            ? formatExpressionPreviewValue(diagnostic.value)
            : fallback
              ? formatExpressionPreviewValue(diagnostic.fallback)
              : 'Missing value',
      });
    }
    const resolved = resolveWorkflowExpressions(action, actionContext, {
      onMissing: spec.onMissing ?? action.expressionPolicy ?? 'error',
    });
    const validated = actionConfigSchema.safeParse(resolved);
    if (!validated.success) {
      for (const issue of validated.error.issues) {
        items.push({
          path: issue.path.join('.'),
          ok: false,
          message: issue.message,
        });
      }
    }
  } catch (error) {
    items.push({
      path: '',
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    });
  }
  return {items};
}

function formatExpressionPreviewValue(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value ?? null);
}

function latestWorkflowRun(
  ruleId: string | null,
  activeRuns: ActionResult[],
  runs: ActionResult[],
): ActionResult | undefined {
  if (!ruleId) return undefined;
  return [...activeRuns, ...runs].find(
    run => run.ruleId === ruleId && workflowRunDetail(run) !== undefined,
  );
}

function workflowRunDetail(
  run: ActionResult | undefined,
): WorkflowRunDetail | undefined {
  const detail = run?.detail;
  if (
    detail?.kind !== 'workflow' ||
    !Array.isArray(detail.timeline) ||
    !Array.isArray(detail.currentNodeIds)
  ) {
    return undefined;
  }
  return detail as WorkflowRunDetail;
}

function workflowNodeRuntimeStatus(
  detail: WorkflowRunDetail | undefined,
  nodeId: string,
): WorkflowNodeExecutionStatus | undefined {
  if (detail?.currentNodeIds.includes(nodeId)) return 'running';
  return [...(detail?.timeline ?? [])]
    .reverse()
    .find(entry => entry.nodeId === nodeId)?.status;
}

function createExpressionPreviewContext(
  rule: RuleConfig | null,
  testedEvent: EventEnvelope | undefined,
  testText: string,
  run: ActionResult | undefined,
  detail: WorkflowRunDetail | undefined,
): WorkflowExpressionContext {
  const trigger = testedEvent ?? parsePreviewEvent(testText);
  return {
    trigger,
    inputs: detail?.context?.inputs ?? {},
    nodes: detail?.context?.nodes ?? {},
    last: detail?.context?.last ?? {},
    workflow: {
      id: rule?.id ?? 'preview',
      runId: run?.id ?? 'preview-run',
      traceId: run?.traceId ?? trigger.traceId,
      startedAt: run?.startedAt ?? run?.queuedAt ?? new Date().toISOString(),
    },
  };
}

function parsePreviewEvent(value: string): EventEnvelope {
  try {
    const input = JSON.parse(value) as Partial<EventEnvelope>;
    return {
      id: input.id ?? 'preview-event',
      traceId: input.traceId ?? 'preview-trace',
      time: input.time ?? new Date().toISOString(),
      source: input.source ?? 'test.event',
      kind: input.kind ?? 'http.request',
      body: input.body,
      meta: input.meta ?? {},
    };
  } catch {
    return {
      id: 'preview-event',
      traceId: 'preview-trace',
      time: new Date().toISOString(),
      source: 'test.event',
      kind: 'http.request',
      body: {},
      meta: {},
    };
  }
}

function ensureWorkflow(
  rule: RuleConfig,
  actions: ActionConfig[],
  t: Translator,
): RuleConfig {
  if (rule.workflow) {
    const cloned = structuredClone(rule);
    if (cloned.workflow) {
      cloned.workflow.nodes = cloned.workflow.nodes.map(node =>
        node.type === 'trigger'
          ? {
              ...node,
              trigger: normalizeWorkflowTrigger(
                node.trigger as WorkflowTrigger | WorkflowEventFilter,
              ),
            }
          : node,
      );
    }
    return cloned;
  }
  const trigger: WorkflowNode = {
    id: 'trigger',
    type: 'trigger',
    label: t('workflow.default.trigger'),
    position: {x: 40, y: 150},
    trigger: {
      type: 'event',
      event: rule.when ?? {anySource: true},
    },
  };
  const actionNodes: WorkflowNode[] = (rule.then ?? []).map((step, index) => ({
    id: uniqueId(`action-${index + 1}`, []),
    type: 'action',
    label: step.action,
    position: {x: 330, y: 55 + index * 125},
    action: {
      type: 'reference',
      actionId:
        actions.find(action => action.id === step.action)?.id ?? step.action,
    },
  }));
  const end: WorkflowNode = {
    id: 'end',
    type: 'end',
    label: t('workflow.default.end'),
    position: {x: 650, y: 150},
    end: {status: 'completed'},
  };
  const nodes = [trigger, ...actionNodes, end];
  const edges: WorkflowEdge[] =
    actionNodes.length > 0
      ? actionNodes.flatMap((node, index) => [
          {
            id: `edge-trigger-${index + 1}`,
            from: trigger.id,
            to: node.id,
            outcome: 'always' as const,
          },
          {
            id: `edge-end-${index + 1}`,
            from: node.id,
            to: end.id,
            outcome: 'success' as const,
          },
        ])
      : [
          {
            id: 'edge-trigger-end',
            from: trigger.id,
            to: end.id,
            outcome: 'always',
          },
        ];
  return {
    id: rule.id,
    enabled: rule.enabled,
    description: rule.description,
    workflow: {
      version: '1.0',
      startNodeId: trigger.id,
      nodes,
      edges,
    },
  };
}

function createWorkflowRule(
  rules: RuleConfig[],
  actions: ActionConfig[],
  t: Translator,
): RuleConfig {
  const id = uniqueId(
    'automation',
    rules.map(rule => rule.id),
  );
  return ensureWorkflow(
    {
      id,
      enabled: true,
      description: t('workflow.default.description'),
      when: {anySource: true},
      then: [],
    },
    actions,
    t,
  );
}

function createNode(
  type: 'action' | 'logic' | 'end',
  workflow: WorkflowGraph,
  actions: ActionConfig[],
  t: Translator,
): WorkflowNode {
  const id = uniqueId(
    type,
    workflow.nodes.map(node => node.id),
  );
  const position = {x: 330 + workflow.nodes.length * 25, y: 75};
  if (type === 'action') {
    return {
      id,
      type,
      label: t('workflow.default.action'),
      position,
      action: createActionSpec(actions),
    };
  }
  if (type === 'logic') {
    return {
      id,
      type,
      label: t('workflow.default.logic'),
      position,
      logic: {
        input: 'lastResult',
        operator: 'success',
      },
    };
  }
  return {
    id,
    type,
    label: t('workflow.default.end'),
    position,
    end: {status: 'completed'},
  };
}

function createActionSpec(actions: ActionConfig[]): WorkflowActionSpec {
  return {type: 'reference', actionId: actions[0]?.id ?? ''};
}

function workflowSummary(rule: RuleConfig, t: Translator): string {
  if (!rule.workflow) {
    const source = rule.when?.anySource
      ? t('rule.anySource')
      : rule.when?.source || t('rule.anySource');
    return t('workflow.summary.legacy', {
      source,
      count: (rule.then ?? []).length,
    });
  }
  const trigger = rule.workflow.nodes.find(node => node.type === 'trigger');
  const source =
    trigger?.type === 'trigger'
      ? workflowTriggerSummary(trigger.trigger, t)
      : t('rule.anySource');
  return t('workflow.summary.graph', {
    source,
    count: rule.workflow.nodes.length,
  });
}

function workflowNodeCount(rule: RuleConfig): string {
  return String(rule.workflow?.nodes.length ?? (rule.then ?? []).length + 2);
}

function nodeSummary(node: WorkflowNode, t: Translator): string {
  switch (node.type) {
    case 'trigger':
      return workflowTriggerSummary(node.trigger, t);
    case 'action':
      return node.action.type === 'reference'
        ? node.action.actionId || t('workflow.selectAction')
        : t(`workflow.action.${node.action.type}`);
    case 'logic':
      return t(`workflow.logic.${node.logic.operator}`);
    case 'end':
      return t(`run.${node.end.status}`);
  }
}

function nodeIcon(node: WorkflowNode) {
  if (node.type === 'trigger') return Zap;
  if (node.type === 'logic') return Split;
  if (node.type === 'end') return Flag;
  switch (node.action.type) {
    case 'command':
      return Terminal;
    case 'script':
      return FileCode2;
    case 'notification':
      return Bell;
    case 'prompt':
      return MessageSquare;
    case 'send_http':
      return Webhook;
    case 'send_ws':
      return Send;
    case 'wait_event':
      return Clock3;
    default:
      return Code2;
  }
}

function defaultPosition(node: WorkflowNode, index: number) {
  if (node.type === 'trigger') return {x: 40, y: 150};
  if (node.type === 'end') return {x: 700, y: 150};
  return {x: 320 + (index % 2) * 220, y: 45 + index * 95};
}

function edgeOutcomes(node: WorkflowNode): WorkflowEdgeOutcome[] {
  if (node.type === 'logic') return ['true', 'false', 'always'];
  if (node.type === 'action') return ['success', 'failure', 'always'];
  return ['always'];
}

function matchConditions(match: MatchConfig | undefined): MatchCondition[] {
  if (!match) return [];
  const root = hasConditionOperator(match) ? [match] : [];
  return [...root, ...(match.all ?? [])].map(condition => ({...condition}));
}

function conditionsToMatch(
  conditions: MatchCondition[],
): MatchConfig | undefined {
  return conditions.length > 0 ? {all: conditions} : undefined;
}

function hasConditionOperator(condition: MatchCondition): boolean {
  return (
    Object.hasOwn(condition, 'equals') ||
    condition.contains !== undefined ||
    condition.regex !== undefined
  );
}

function conditionOperator(
  condition: MatchCondition,
): 'equals' | 'contains' | 'regex' {
  if (condition.contains !== undefined) return 'contains';
  if (condition.regex !== undefined) return 'regex';
  return 'equals';
}

function conditionValue(condition: MatchCondition): unknown {
  if (condition.contains !== undefined) return condition.contains;
  if (condition.regex !== undefined) return condition.regex;
  return condition.equals;
}

function buildCondition(
  jsonPath: string | undefined,
  operator: 'equals' | 'contains' | 'regex',
  value: unknown,
): MatchCondition {
  if (operator === 'contains') {
    return {jsonPath, contains: String(value ?? '')};
  }
  if (operator === 'regex') return {jsonPath, regex: String(value ?? '')};
  return {jsonPath, equals: value};
}

function templateFieldPath(field: MessageTemplateField): string {
  return `$.meta.decoded.values["${field.key}"]`;
}

function eventSources(endpoints: EndpointsConfig): string[] {
  return [
    ...endpoints.httpServers.map(endpoint => `http.server.${endpoint.id}`),
    ...endpoints.wsServers.map(endpoint => `ws.server.${endpoint.id}`),
    ...endpoints.wsClients.map(endpoint => `ws.client.${endpoint.id}`),
    'ui.manual',
  ];
}

function uniqueId(base: string, existing: string[]): string {
  if (!existing.includes(base)) return base;
  let index = 2;
  while (existing.includes(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

function parseLooseValue(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function stringifyInputValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value ?? '');
}

function createWorkflowTrigger(value: string): WorkflowTrigger {
  if (value === 'once') {
    return {
      type: 'time',
      schedule: {
        mode: 'once',
        at: formatDateTimeLocal(new Date(Date.now() + 60 * 60 * 1000)),
        misfirePolicy: 'skip',
      },
    };
  }
  if (value === 'interval') {
    return {
      type: 'time',
      schedule: {mode: 'interval', everyMs: 60000, misfirePolicy: 'skip'},
    };
  }
  if (value === 'daily') {
    return {
      type: 'time',
      schedule: {
        mode: 'daily',
        time: '09:00:00',
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        misfirePolicy: 'skip',
      },
    };
  }
  return {type: 'event', event: {anySource: true}};
}

function setMisfirePolicy(
  schedule: WorkflowSchedule,
  misfirePolicy: 'skip' | 'runOnce',
): WorkflowSchedule {
  switch (schedule.mode) {
    case 'once':
      return {...schedule, misfirePolicy};
    case 'interval':
      return {...schedule, misfirePolicy};
    case 'daily':
      return {...schedule, misfirePolicy};
  }
}

function normalizeWorkflowTrigger(
  trigger: WorkflowTrigger | WorkflowEventFilter,
): WorkflowTrigger {
  return 'type' in trigger ? trigger : {type: 'event', event: trigger};
}

function workflowTriggerSummary(
  trigger: WorkflowTrigger,
  t: Translator,
): string {
  if (trigger.type === 'event') {
    return trigger.event.anySource
      ? t('rule.anySource')
      : trigger.event.source || t('workflow.selectSource');
  }
  if (trigger.schedule.mode === 'once') {
    return t('workflow.summary.once', {
      time: new Date(trigger.schedule.at).toLocaleString(),
    });
  }
  if (trigger.schedule.mode === 'interval') {
    return t('workflow.summary.interval', {
      seconds: trigger.schedule.everyMs / 1000,
    });
  }
  return t('workflow.summary.daily', {time: trigger.schedule.time});
}

function formatDateTimeLocal(value: Date): string {
  const part = (number: number) => String(number).padStart(2, '0');
  return `${value.getFullYear()}-${part(value.getMonth() + 1)}-${part(
    value.getDate(),
  )}T${part(value.getHours())}:${part(value.getMinutes())}`;
}
