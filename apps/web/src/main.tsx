import React from 'react';
import ReactDOM from 'react-dom/client';
import {
  Activity,
  Bug,
  CircleDot,
  GitBranch,
  LayoutList,
  ListChecks,
  Network,
  Pause,
  Play,
  Plus,
  PlugZap,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  ScrollText,
  Settings2,
  SlidersHorizontal,
  Terminal,
  TestTube2,
  Trash2,
  XCircle,
} from 'lucide-react';
import type {
  ActionConfig,
  ActionResult,
  EventEnvelope,
  LoadedConfig,
  MatchCondition as CoreMatchCondition,
  MessageTemplateField as CoreMessageTemplateField,
} from '@las/core';
import {translate, type Locale} from './i18n';
import './styles.css';

type AppConfig = LoadedConfig;
type AppAction = ActionConfig;
type MatchCondition = CoreMatchCondition;

interface Health {
  ok: boolean;
  time: string;
  ws: Array<{target: string; clients: number}>;
  listeners?: Array<{
    host: string;
    port: number;
    kind: 'control' | 'endpoint';
    httpRoutes: string[];
    wsRoutes: string[];
  }>;
}

interface RawConfig {
  app: string;
  endpoints: string;
  rules: string;
  actions: string;
}

type EventRow = EventEnvelope;
type RunRow = ActionResult;
interface UnifiedLogItem {
  id: string;
  traceId: string;
  time: string;
  category: 'event' | 'run';
  direction: 'inbound' | 'outbound' | 'local';
  status: 'ok' | 'failed' | 'active';
  title: string;
  summary: string;
  source: string;
  raw: EventRow | RunRow;
}

interface QueueSnapshot {
  maxConcurrent: number;
  queued: RunRow[];
  running: RunRow[];
  recent: RunRow[];
}

interface RuleTestResult {
  event: EventRow;
  matches: Array<{
    ruleId: string;
    matched: boolean;
    actions: string[];
    description?: string;
    checks: Array<{
      field: 'enabled' | 'source' | 'kind' | 'equals' | 'contains' | 'regex';
      matched: boolean;
      expected?: unknown;
      actual?: unknown;
      path?: string;
    }>;
  }>;
}
interface RuleDraft {
  index: number;
  id: string;
  enabled: boolean;
  description: string;
  anySource: boolean;
  source: string;
  kind: string;
  operator: 'none' | 'equals' | 'contains' | 'regex';
  jsonPath: string;
  matchValue: string;
  template: string;
  templateConditions: TemplateConditionDraft[];
  actions: string[];
}
interface TemplateConditionDraft {
  id: string;
  label: string;
  path: string;
  operator: 'equals' | 'contains' | 'regex';
  value: string;
}
type RuleInspectorMode = 'config' | 'test';
type RuleStatusFilter = 'all' | 'enabled' | 'disabled';
type ActionKind = AppAction['type'];
type OverviewRange = '1h' | '1d' | '7d' | 'all';
interface ActionDraft {
  index: number;
  id: string;
  type: ActionKind;
  description: string;
  cwd: string;
  command: string;
  argsText: string;
  timeoutMs: string;
  allowConcurrent: boolean;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  headersText: string;
  bodyText: string;
  template: string;
  templateValues: Record<string, string>;
  target: string;
}
type ActionInspectorMode = 'config' | 'trial';
type ActionTypeFilter = 'all' | ActionKind;

type Translator = (
  key: string,
  values?: Record<string, string | number>,
) => string;
type EndpointKind = 'httpServer' | 'wsServer' | 'httpClient' | 'wsClient';
interface EndpointDraft {
  kind: EndpointKind;
  index: number;
  id: string;
  enabled: boolean;
  description: string;
  host: string;
  port: string;
  path: string;
  baseUrl: string;
  url: string;
  template: string;
  templateFields: string[];
  templateValues: Record<string, string>;
  headersText: string;
}
interface EndpointDisplay {
  kind: EndpointKind;
  index: number;
  raw:
    | AppConfig['endpoints']['httpServers'][number]
    | AppConfig['endpoints']['wsServers'][number]
    | AppConfig['endpoints']['httpClients'][number]
    | AppConfig['endpoints']['wsClients'][number];
  id: string;
  key: string;
  color: string;
  enabled: boolean;
  type: string;
  fields: string[][];
}
interface MessageTemplateSummary {
  name: string;
  id: string;
  templateVersion: '2.0';
  displayName: string;
  description: string;
  contentType: 'application/json';
  capabilities: {receive: boolean; send: boolean; match: boolean};
  minimum: {body: unknown; pruneEmpty: boolean};
  fields: MessageTemplateField[];
  constraints: Array<{kind: 'atLeastOne'; paths: string[]; message: string}>;
  examples: Array<{name: string; description: string; body: unknown}>;
  notes: string[];
}
type MessageTemplateField = CoreMessageTemplateField;
interface DecodedMessage {
  template: string;
  templateId?: string;
  matched: boolean;
  displayItems?: Array<{
    label: string;
    path: string;
    value: unknown;
  }>;
  values?: Record<string, unknown>;
  errors?: Array<{
    path: string;
    message: string;
  }>;
  error?: string;
}
interface EndpointTestResult {
  ok: boolean;
  kind: EndpointKind;
  id: string;
  target?: string;
  statusCode?: number;
  responseBody?: string;
  durationMs: number;
  message: string;
}
interface EndpointTestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path?: string;
  body?: unknown;
  useTemplate?: boolean;
}
interface EndpointLogEntry {
  id: string;
  time: string;
  endpointKey: string;
  endpointId: string;
  color: string;
  level: 'ok' | 'failed' | 'info';
  type: 'test' | 'event' | 'info';
  message: string;
  detail?: string;
  decoded?: DecodedMessage;
}
type EndpointViewMode = 'graph' | 'config';
type EndpointInspectorMode = 'config' | 'test';
type EndpointProtocolFilter = 'all' | 'http' | 'ws';
type EndpointRoleFilter = 'all' | 'server' | 'client';
type ActionViewMode = 'graph' | 'config';
type LogViewMode = 'entries' | 'console';
type ApiFailureKind = 'network' | 'http' | 'parse' | 'unknown';
interface ApiFailure {
  id: string;
  label: string;
  url: string;
  reason: string;
  kind: ApiFailureKind;
  status?: number;
}
type ApiResult<T> =
  | {ok: true; id: string; value: T}
  | {ok: false; id: string; failure: ApiFailure};

const API_BASE = import.meta.env.VITE_API_BASE ?? defaultApiBase();
const AUTO_REFRESH_INTERVAL_MS = 5000;

function defaultApiBase(): string {
  const saved = localStorage.getItem('las-api-base');
  if (saved) {
    return saved;
  }
  const {protocol, port, origin} = window.location;
  if (port === '5277' || port === '5278' || protocol === 'file:') {
    return 'http://127.0.0.1:4789';
  }
  return origin;
}

const nav = [
  {id: 'dashboard', labelKey: 'nav.dashboard', icon: Activity},
  {id: 'endpoints', labelKey: 'nav.endpoints', icon: PlugZap},
  {id: 'rules', labelKey: 'nav.rules', icon: ListChecks},
  {id: 'actions', labelKey: 'nav.actions', icon: Play},
  {id: 'logs', labelKey: 'nav.logs', icon: ScrollText},
] as const;

async function fetchJson<T>(
  id: string,
  label: string,
  path: string,
): Promise<ApiResult<T>> {
  const url = `${API_BASE}${path}`;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return {
        ok: false,
        id,
        failure: {
          id,
          label,
          url,
          kind: 'http',
          status: response.status,
          reason: `${response.status} ${response.statusText}`,
        },
      };
    }

    try {
      return {ok: true, id, value: (await response.json()) as T};
    } catch (error) {
      return {
        ok: false,
        id,
        failure: {
          id,
          label,
          url,
          kind: 'parse',
          reason: errorMessage(error),
        },
      };
    }
  } catch (error) {
    return {
      ok: false,
      id,
      failure: {
        id,
        label,
        url,
        kind: error instanceof TypeError ? 'network' : 'unknown',
        reason: errorMessage(error),
      },
    };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function App() {
  const savedLocale = localStorage.getItem('las-locale') as Locale | null;
  const [locale, setLocale] = React.useState<Locale>(savedLocale ?? 'zh-CN');
  const t = React.useCallback<Translator>(
    (key, values) => translate(locale, key, values),
    [locale],
  );
  const [active, setActive] =
    React.useState<(typeof nav)[number]['id']>('dashboard');
  const [token, setToken] = React.useState(
    localStorage.getItem('las-token') ?? '',
  );
  const [config, setConfig] = React.useState<AppConfig | null>(null);
  const [raw, setRaw] = React.useState<RawConfig | null>(null);
  const [health, setHealth] = React.useState<Health | null>(null);
  const [events, setEvents] = React.useState<EventRow[]>([]);
  const [runs, setRuns] = React.useState<RunRow[]>([]);
  const [queue, setQueue] = React.useState<QueueSnapshot | null>(null);
  const [templates, setTemplates] = React.useState<MessageTemplateSummary[]>(
    [],
  );
  const [apiFailures, setApiFailures] = React.useState<ApiFailure[]>([]);
  const [status, setStatus] = React.useState(t('status.ready'));

  const refresh = React.useCallback(async () => {
    const results = await Promise.all([
      fetchJson<Health>('health', 'GET /api/health', '/api/health'),
      fetchJson<AppConfig>('config', 'GET /api/config', '/api/config'),
      fetchJson<RawConfig>('raw', 'GET /api/config/raw', '/api/config/raw'),
      fetchJson<MessageTemplateSummary[]>(
        'templates',
        'GET /api/templates',
        '/api/templates',
      ),
      fetchJson<EventRow[]>(
        'events',
        'GET /api/events',
        '/api/events?limit=80',
      ),
      fetchJson<RunRow[]>('runs', 'GET /api/runs', '/api/runs?limit=80'),
      fetchJson<QueueSnapshot>('queue', 'GET /api/queue', '/api/queue'),
    ]);

    const failures = results
      .filter(
        (result): result is Extract<typeof result, {ok: false}> => !result.ok,
      )
      .map(result => result.failure);
    setApiFailures(failures);

    for (const result of results) {
      if (!result.ok) {
        continue;
      }
      if (result.id === 'health') setHealth(result.value as Health);
      if (result.id === 'config') setConfig(result.value as AppConfig);
      if (result.id === 'raw') setRaw(result.value as RawConfig);
      if (result.id === 'templates')
        setTemplates(result.value as MessageTemplateSummary[]);
      if (result.id === 'events') setEvents(result.value as EventRow[]);
      if (result.id === 'runs') setRuns(result.value as RunRow[]);
      if (result.id === 'queue') setQueue(result.value as QueueSnapshot);
    }

    if (failures.length === 0) {
      setStatus(t('status.updated'));
    } else if (failures.some(failure => failure.id === 'health')) {
      setStatus(t('status.backendOffline'));
    } else {
      setStatus(t('status.partialFailure'));
    }
  }, [t]);
  const refreshRef = React.useRef(refresh);

  React.useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  function queueFollowupRefresh() {
    for (const delay of [500, 1500, 3000]) {
      window.setTimeout(() => {
        void refreshRef.current();
      }, delay);
    }
  }

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  React.useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void refreshRef.current();
      }
    }, AUTO_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, []);

  function saveLocale(next: Locale) {
    setLocale(next);
    localStorage.setItem('las-locale', next);
  }

  function saveToken(next: string) {
    setToken(next);
    localStorage.setItem('las-token', next);
  }

  async function saveConfig(name: keyof RawConfig, content: string) {
    setStatus(t('status.saving', {name}));
    const response = await fetch(`${API_BASE}/api/config/raw/${name}`, {
      method: 'PUT',
      headers: {'content-type': 'application/json', 'x-las-token': token},
      body: JSON.stringify({content}),
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }
    await refresh();
    queueFollowupRefresh();
  }

  async function saveEndpointSetup(
    endpoints: AppConfig['endpoints'],
    id: string,
  ) {
    setStatus(t('status.savingEndpoint', {id}));
    const endpointResponse = await fetch(`${API_BASE}/api/endpoints`, {
      method: 'PUT',
      headers: {'content-type': 'application/json', 'x-las-token': token},
      body: JSON.stringify(endpoints),
    });
    if (!endpointResponse.ok) {
      throw new Error(await endpointResponse.text());
    }
    await refresh();
    queueFollowupRefresh();
  }

  async function saveRuleSetup(rules: AppConfig['rules'], id: string) {
    setStatus(t('status.savingRule', {id}));
    const response = await fetch(`${API_BASE}/api/rules`, {
      method: 'PUT',
      headers: {'content-type': 'application/json', 'x-las-token': token},
      body: JSON.stringify(rules),
    });
    if (!response.ok) throw new Error(await response.text());
    await refresh();
    queueFollowupRefresh();
  }

  async function saveActionSetup(actions: AppConfig['actions'], id: string) {
    setStatus(t('status.savingAction', {id}));
    const response = await fetch(`${API_BASE}/api/actions`, {
      method: 'PUT',
      headers: {'content-type': 'application/json', 'x-las-token': token},
      body: JSON.stringify(actions),
    });
    if (!response.ok) throw new Error(await response.text());
    await refresh();
    queueFollowupRefresh();
  }

  async function testEndpoint(
    kind: EndpointKind,
    id: string,
    options: EndpointTestOptions = {},
  ): Promise<EndpointTestResult> {
    setStatus(t('status.testingEndpoint', {id}));
    const response = await fetch(`${API_BASE}/api/endpoints/test`, {
      method: 'POST',
      headers: {'content-type': 'application/json', 'x-las-token': token},
      body: JSON.stringify({kind, id, ...options}),
    });
    const result = (await response.json()) as EndpointTestResult;
    setStatus(
      t(result.ok ? 'status.endpointTestOk' : 'status.endpointTestFailed', {
        id,
      }),
    );
    queueFollowupRefresh();
    return result;
  }

  async function runAction(id: string) {
    setStatus(t('status.queued', {id}));
    const response = await fetch(`${API_BASE}/api/actions/${id}/run`, {
      method: 'POST',
      headers: {'x-las-token': token},
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }
    await refresh();
    queueFollowupRefresh();
  }

  async function cancelRun(id: string) {
    setStatus(t('status.cancelling', {id}));
    const response = await fetch(`${API_BASE}/api/queue/${id}/cancel`, {
      method: 'POST',
      headers: {'x-las-token': token},
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }
    await refresh();
    queueFollowupRefresh();
  }

  async function replayEvent(id: string) {
    setStatus(t('status.replaying', {id}));
    const response = await fetch(`${API_BASE}/api/events/${id}/replay`, {
      method: 'POST',
      headers: {'x-las-token': token},
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }
    await refresh();
    queueFollowupRefresh();
  }

  async function testRules(eventText: string): Promise<RuleTestResult> {
    setStatus(t('status.testingRules'));
    const parsed = JSON.parse(eventText);
    const response = await fetch(`${API_BASE}/api/rules/test`, {
      method: 'POST',
      headers: {'content-type': 'application/json', 'x-las-token': token},
      body: JSON.stringify(parsed),
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }
    setStatus(t('status.ruleTestComplete'));
    queueFollowupRefresh();
    return response.json();
  }

  const activeNav = nav.find(item => item.id === active);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="mark">LAS</div>
          <div>
            <strong>{t('app.name')}</strong>
            <span>127.0.0.1:{health ? new URL(API_BASE).port : '4789'}</span>
          </div>
        </div>
        <nav>
          {nav.map(item => {
            const Icon = item.icon;
            const label = t(item.labelKey);
            return (
              <button
                key={item.id}
                className={active === item.id ? 'active' : ''}
                onClick={() => setActive(item.id)}
                title={label}
              >
                <Icon size={18} />
                <span>{label}</span>
              </button>
            );
          })}
        </nav>
        <div className="sidebarFoot">
          <CircleDot size={14} />
          <span>
            {health?.ok
              ? t('status.backendOnline')
              : t('status.backendOffline')}
          </span>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div className="pageIdentity">
            <span>{t('app.console')}</span>
            <h1>{activeNav ? t(activeNav.labelKey) : ''}</h1>
            <p>{status}</p>
          </div>
          <div className="topControls">
            <div className="languageSwitch">
              <button
                className={locale === 'zh-CN' ? 'active' : ''}
                onClick={() => saveLocale('zh-CN')}
              >
                {t('lang.zh')}
              </button>
              <button
                className={locale === 'en-US' ? 'active' : ''}
                onClick={() => saveLocale('en-US')}
              >
                {t('lang.en')}
              </button>
            </div>
            <div className="tokenBox">
              <input
                value={token}
                onChange={event => saveToken(event.target.value)}
                aria-label={t('field.apiToken')}
              />
              <button
                onClick={() => void refresh()}
                title={t('common.refresh')}
              >
                <RefreshCw size={18} />
              </button>
            </div>
          </div>
        </header>

        {apiFailures.length > 0 && (
          <DiagnosticsBanner
            failures={apiFailures}
            t={t}
            onRetry={() => void refresh()}
          />
        )}

        {active === 'dashboard' && (
          <Dashboard
            config={config}
            health={health}
            events={events}
            runs={runs}
            queue={queue}
            t={t}
          />
        )}
        {active === 'endpoints' && raw && config && (
          <EndpointsPanel
            config={config}
            raw={raw.endpoints}
            events={events}
            templates={templates}
            t={t}
            onSaveEndpoints={(endpoints, id) =>
              saveEndpointSetup(endpoints, id)
            }
            onTestEndpoint={(kind, id, options) =>
              testEndpoint(kind, id, options)
            }
            onSave={content => saveConfig('endpoints', content)}
          />
        )}
        {active === 'rules' && raw && config && (
          <RulesPanel
            raw={raw.rules}
            rules={config.rules}
            actions={config.actions}
            templates={templates}
            t={t}
            onSaveRules={(rules, id) => saveRuleSetup(rules, id)}
            onSave={content => saveConfig('rules', content)}
            onTest={eventText => testRules(eventText)}
          />
        )}
        {active === 'actions' && raw && config && (
          <ActionsPanel
            raw={raw.actions}
            actions={config.actions}
            templates={templates}
            queue={queue}
            runs={runs}
            t={t}
            onSaveActions={(actions, id) => saveActionSetup(actions, id)}
            onSave={content => saveConfig('actions', content)}
            onRun={id => runAction(id)}
            onCancel={id =>
              cancelRun(id).catch(error => setStatus(error.message))
            }
          />
        )}
        {active === 'logs' && (
          <Logs
            events={events}
            runs={runs}
            t={t}
            onRefresh={() => void refresh()}
            onReplay={id =>
              replayEvent(id).catch(error => setStatus(error.message))
            }
          />
        )}
      </main>
    </div>
  );
}

function Dashboard({
  config,
  health,
  events,
  runs,
  queue,
  t,
}: {
  config: AppConfig | null;
  health: Health | null;
  events: EventRow[];
  runs: RunRow[];
  queue: QueueSnapshot | null;
  t: Translator;
}) {
  const [range, setRange] = React.useState<OverviewRange>('1h');
  const endpointCount = config
    ? [
        ...config.endpoints.httpServers,
        ...config.endpoints.wsServers,
        ...config.endpoints.httpClients,
        ...config.endpoints.wsClients,
      ].filter(endpoint => endpoint.enabled).length
    : 0;
  const activeJobs = (queue?.running.length ?? 0) + (queue?.queued.length ?? 0);
  const periodEvents = filterByOverviewRange(
    events,
    range,
    event => event.time,
  );
  const periodRuns = filterByOverviewRange(
    runs,
    range,
    run => run.finishedAt ?? run.startedAt ?? run.queuedAt ?? '',
  );
  const receivedMessages = periodEvents.filter(
    event =>
      event.kind === 'http.request' ||
      event.kind === 'ws.message' ||
      event.source.startsWith('http.server.') ||
      event.source.startsWith('ws.server.'),
  ).length;
  const sentMessages = periodRuns.filter(
    run =>
      run.actionType === 'send_http' ||
      run.actionType === 'send_ws' ||
      run.detail?.direction === 'outbound',
  ).length;
  const automationActions = periodRuns.length;
  const completedRules = countCompletedRuleExecutions(periodRuns);
  const upcomingActions = [
    ...(queue?.queued ?? []),
    ...(queue?.running ?? []),
  ].slice(0, 8);

  return (
    <section className="overviewPage">
      <div className="overviewTop">
        <section className="projectIntro">
          <div className="projectLogoPlaceholder">LAS</div>
          <div>
            <span>{t('overview.projectCategory')}</span>
            <h2>{t('overview.projectName')}</h2>
            <p>{t('overview.projectDescription')}</p>
            <div className="developmentProgress">
              <div>
                <span>{t('overview.developmentProgress')}</span>
                <strong>{t('overview.phase')}</strong>
              </div>
              <div className="progressTrack">
                <i />
              </div>
            </div>
          </div>
        </section>
        <section className="serviceOverview">
          <div className="overviewSectionHead">
            <div>
              <span>{t('overview.serviceOverview')}</span>
              <strong>
                {health?.ok
                  ? t('status.backendOnline')
                  : t('status.backendOffline')}
              </strong>
            </div>
            <CircleDot size={18} />
          </div>
          <div className="serviceMetrics">
            <div>
              <span>{t('overview.onlineEndpoints')}</span>
              <strong>{endpointCount}</strong>
            </div>
            <div>
              <span>{t('overview.messagesObserved')}</span>
              <strong>{events.length}</strong>
            </div>
            <div>
              <span>{t('overview.activeAutomation')}</span>
              <strong>{activeJobs}</strong>
            </div>
            <div>
              <span>{t('overview.listeners')}</span>
              <strong>{health?.listeners?.length ?? 0}</strong>
            </div>
          </div>
        </section>
      </div>
      <section className="overviewRangeBoard">
        <div className="monitoringHead">
          <div>
            <span>{t('overview.runtimeWindow')}</span>
            <strong>{t('overview.runtimeSummary')}</strong>
          </div>
          <div className="rangeSwitch">
            {(['1h', '1d', '7d', 'all'] as OverviewRange[]).map(item => (
              <button
                key={item}
                className={range === item ? 'active' : ''}
                onClick={() => setRange(item)}
              >
                {t(`overview.range.${item}`)}
              </button>
            ))}
          </div>
        </div>
        <div className="overviewRuntimeGrid">
          <div className="runtimeMetric">
            <span>{t('overview.receivedMessages')}</span>
            <strong>{receivedMessages}</strong>
          </div>
          <div className="runtimeMetric">
            <span>{t('overview.sentMessages')}</span>
            <strong>{sentMessages}</strong>
          </div>
          <div className="runtimeMetric">
            <span>{t('overview.automationActions')}</span>
            <strong>{automationActions}</strong>
          </div>
          <div className="runtimeMetric">
            <span>{t('overview.completedRules')}</span>
            <strong>{completedRules}</strong>
          </div>
          <section className="upcomingActions">
            <div className="moduleHead">
              <span>{t('overview.upcomingActions')}</span>
              <code>{upcomingActions.length}</code>
            </div>
            {upcomingActions.length === 0 && (
              <div className="empty">{t('overview.noUpcomingActions')}</div>
            )}
            {upcomingActions.map(run => (
              <details className={`actionCard ${run.status}`} key={run.id}>
                <summary>
                  <div>
                    <strong>{run.actionId}</strong>
                    <span>{t(`run.${run.status}`)}</span>
                  </div>
                  <code>
                    {run.queuedAt
                      ? new Date(run.queuedAt).toLocaleTimeString()
                      : t('common.notAvailable')}
                  </code>
                </summary>
                <pre>{JSON.stringify(run, null, 2)}</pre>
              </details>
            ))}
          </section>
        </div>
      </section>
    </section>
  );
}

function DiagnosticsBanner({
  failures,
  t,
  onRetry,
}: {
  failures: ApiFailure[];
  t: Translator;
  onRetry: () => void;
}) {
  return (
    <section className="diagnosticsPanel">
      <div className="diagnosticsHead">
        <div>
          <h2>{t('diagnostics.title')}</h2>
          <p>{t('diagnostics.summary')}</p>
        </div>
        <button onClick={onRetry}>{t('common.retry')}</button>
      </div>
      <div className="diagnosticsMeta">
        <span>{t('diagnostics.backend')}</span>
        <code>{API_BASE}</code>
      </div>
      <div className="diagnosticsList">
        {failures.map(failure => (
          <details key={`${failure.id}-${failure.url}`}>
            <summary>
              <span>{failure.label}</span>
              <code>
                {failure.status ? `HTTP ${failure.status}` : failure.kind}
              </code>
            </summary>
            <div className="diagnosticsDetails">
              <label>{t('diagnostics.failedEndpoint')}</label>
              <code>{failure.url}</code>
              <label>{t('diagnostics.reason')}</label>
              <span>{failure.reason}</span>
              <label>{t('diagnostics.suggestion')}</label>
              <span>{diagnosticSuggestion(failure.kind, t)}</span>
            </div>
          </details>
        ))}
      </div>
      <code className="diagnosticsCommand">
        {t('diagnostics.checkCommand')}
      </code>
    </section>
  );
}

function EndpointsPanel({
  config,
  raw,
  events,
  templates,
  t,
  onSaveEndpoints,
  onTestEndpoint,
  onSave,
}: {
  config: AppConfig;
  raw: string;
  events: EventRow[];
  templates: MessageTemplateSummary[];
  t: Translator;
  onSaveEndpoints: (
    endpoints: AppConfig['endpoints'],
    id: string,
  ) => Promise<void>;
  onTestEndpoint: (
    kind: EndpointKind,
    id: string,
    options?: EndpointTestOptions,
  ) => Promise<EndpointTestResult>;
  onSave: (content: string) => Promise<void>;
}) {
  const [editing, setEditing] = React.useState<EndpointDraft | null>(null);
  const [viewMode, setViewMode] = React.useState<EndpointViewMode>('graph');
  const [createKind, setCreateKind] =
    React.useState<EndpointKind>('httpServer');
  const [query, setQuery] = React.useState('');
  const [protocolFilter, setProtocolFilter] =
    React.useState<EndpointProtocolFilter>('all');
  const [roleFilter, setRoleFilter] = React.useState<EndpointRoleFilter>('all');
  const [inspectorMode, setInspectorMode] =
    React.useState<EndpointInspectorMode>('config');
  const [testLogs, setTestLogs] = React.useState<EndpointLogEntry[]>([]);
  const [colors, setColors] = React.useState<Record<string, string>>(() =>
    readEndpointColors(),
  );
  const host = config.app?.server?.host ?? '127.0.0.1';
  const port = config.app?.server?.port ?? Number(new URL(API_BASE).port);
  const endpoints: EndpointDisplay[] = [
    ...config.endpoints.httpServers.map((endpoint, index) => ({
      kind: 'httpServer' as const,
      index,
      raw: endpoint,
      id: endpoint.id,
      key: endpointKey('httpServer', endpoint.id),
      color: endpointColor(colors, 'httpServer', endpoint.id, 0),
      enabled: endpoint.enabled,
      type: t('endpoint.httpServer'),
      fields: [
        [
          t('field.url'),
          `http://${endpoint.host ?? host}:${endpoint.port ?? port}${endpoint.path ?? '/ingest'}`,
        ],
        [t('field.messageFormat'), t('format.json')],
        ...(endpoint.template
          ? [[t('field.messageTemplate'), endpoint.template]]
          : []),
      ],
    })),
    ...config.endpoints.wsServers.map((endpoint, index) => ({
      kind: 'wsServer' as const,
      index,
      raw: endpoint,
      id: endpoint.id,
      key: endpointKey('wsServer', endpoint.id),
      color: endpointColor(colors, 'wsServer', endpoint.id, 1),
      enabled: endpoint.enabled,
      type: t('endpoint.wsServer'),
      fields: [
        [
          t('field.url'),
          `ws://${endpoint.host ?? host}:${endpoint.port ?? port}${endpoint.path}`,
        ],
        [t('field.messageFormat'), t('format.json')],
      ],
    })),
    ...config.endpoints.httpClients.map((endpoint, index) => ({
      kind: 'httpClient' as const,
      index,
      raw: endpoint,
      id: endpoint.id,
      key: endpointKey('httpClient', endpoint.id),
      color: endpointColor(colors, 'httpClient', endpoint.id, 2),
      enabled: endpoint.enabled,
      type: t('endpoint.httpClient'),
      fields: [
        [t('field.url'), endpoint.baseUrl],
        [t('field.messageFormat'), t('format.json')],
        ...(endpoint.template
          ? [[t('field.messageTemplate'), endpoint.template]]
          : []),
      ],
    })),
    ...config.endpoints.wsClients.map((endpoint, index) => ({
      kind: 'wsClient' as const,
      index,
      raw: endpoint,
      id: endpoint.id,
      key: endpointKey('wsClient', endpoint.id),
      color: endpointColor(colors, 'wsClient', endpoint.id, 3),
      enabled: endpoint.enabled,
      type: t('endpoint.wsClient'),
      fields: [
        [t('field.url'), endpoint.url],
        [t('field.messageFormat'), t('format.json')],
      ],
    })),
  ];
  const filteredEndpoints = endpoints.filter(
    endpoint =>
      (protocolFilter === 'all' ||
        endpoint.kind.toLowerCase().startsWith(protocolFilter)) &&
      (roleFilter === 'all' ||
        endpoint.kind.toLowerCase().endsWith(roleFilter)) &&
      `${endpoint.id} ${endpoint.type} ${endpoint.fields.flat().join(' ')}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );

  React.useEffect(() => {
    if (!editing && endpoints.length > 0) {
      const endpoint = endpoints[0];
      setEditing(
        createEndpointDraft(
          endpoint.kind,
          endpoint.index,
          endpoint.raw,
          config,
        ),
      );
    }
  }, [config]);

  async function saveDraft(draft: EndpointDraft) {
    const next = structuredClone(config.endpoints);
    if (draft.kind === 'httpServer') {
      const listener = parseHttpListenerUrl(draft.baseUrl, t);
      const value = {
        id: draft.id.trim(),
        enabled: draft.enabled,
        host: listener.host,
        port: listener.port,
        path: parsePath(draft.path, t),
        description: emptyToUndefined(draft.description),
        template: emptyToUndefined(draft.template),
      };
      if (draft.index < 0) next.httpServers.push(value);
      else next.httpServers[draft.index] = value;
    }
    if (draft.kind === 'wsServer') {
      const value = {
        id: draft.id.trim(),
        enabled: draft.enabled,
        host: parseHost(draft.host, t),
        port: parsePort(draft.port, t),
        path: parsePath(draft.path, t),
        description: emptyToUndefined(draft.description),
      };
      if (draft.index < 0) next.wsServers.push(value);
      else next.wsServers[draft.index] = value;
    }
    if (draft.kind === 'httpClient') {
      const value = {
        id: draft.id.trim(),
        enabled: draft.enabled,
        description: emptyToUndefined(draft.description),
        baseUrl: draft.baseUrl.trim(),
        headers: parseHeaders(draft.headersText),
        template: emptyToUndefined(draft.template),
        templateFields: draft.template ? draft.templateFields : undefined,
        templateValues: draft.template
          ? cleanSelectedTemplateValues(
              draft.templateValues,
              draft.templateFields,
            )
          : undefined,
      };
      if (draft.index < 0) next.httpClients.push(value);
      else next.httpClients[draft.index] = value;
    }
    if (draft.kind === 'wsClient') {
      const value = {
        id: draft.id.trim(),
        enabled: draft.enabled,
        url: draft.url.trim(),
      };
      if (draft.index < 0) next.wsClients.push(value);
      else next.wsClients[draft.index] = value;
    }
    await onSaveEndpoints(next, draft.id);
    setEditing({
      ...draft,
      index: endpointIndexByKind(next, draft.kind, draft.id),
    });
  }

  async function runEndpointTest(
    kind: EndpointKind,
    id: string,
    options: EndpointTestOptions = {},
  ) {
    const result = await onTestEndpoint(kind, id, options);
    const key = endpointKey(kind, id);
    const entry: EndpointLogEntry = {
      id: `${Date.now()}-${key}`,
      time: new Date().toISOString(),
      endpointKey: key,
      endpointId: id,
      color: endpointColor(colors, kind, id, 0),
      level: result.ok ? 'ok' : 'failed',
      type: 'test',
      message: result.message,
      detail: [result.target, result.responseBody, `${result.durationMs}ms`]
        .filter(Boolean)
        .join('\n'),
    };
    setTestLogs(current => [entry, ...current].slice(0, 80));
    return result;
  }

  function updateColor(kind: EndpointKind, id: string, color: string) {
    const key = endpointKey(kind, id);
    const next = {...colors, [key]: color};
    setColors(next);
    localStorage.setItem('las-endpoint-colors', JSON.stringify(next));
  }

  async function deleteEndpoint(endpoint: EndpointDisplay) {
    if (!window.confirm(t('common.confirmDelete', {id: endpoint.id}))) return;
    const next = structuredClone(config.endpoints);
    if (endpoint.kind === 'httpServer')
      next.httpServers.splice(endpoint.index, 1);
    if (endpoint.kind === 'wsServer') next.wsServers.splice(endpoint.index, 1);
    if (endpoint.kind === 'httpClient')
      next.httpClients.splice(endpoint.index, 1);
    if (endpoint.kind === 'wsClient') next.wsClients.splice(endpoint.index, 1);
    const nextColors = {...colors};
    delete nextColors[endpoint.key];
    setColors(nextColors);
    localStorage.setItem('las-endpoint-colors', JSON.stringify(nextColors));
    setEditing(null);
    await onSaveEndpoints(next, endpoint.id);
  }

  const eventLogs = endpointEventLogs(events, endpoints, colors, t);
  const logs = [...testLogs, ...eventLogs]
    .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
    .slice(0, 120);
  const selectedEndpoint = editing
    ? endpoints.find(
        endpoint =>
          endpoint.kind === editing.kind && endpoint.index === editing.index,
      )
    : undefined;
  const selectedLogs = selectedEndpoint
    ? logs.filter(log => log.endpointKey === selectedEndpoint.key).slice(0, 80)
    : logs.slice(0, 80);

  return (
    <section className="endpointWorkspace">
      <div className="workspaceToolbar">
        <div className="endpointViewSwitch">
          <button
            className={viewMode === 'graph' ? 'active' : ''}
            onClick={() => setViewMode('graph')}
          >
            <Network size={15} />
            {t('common.workspaceView')}
          </button>
          <button
            className={viewMode === 'config' ? 'active' : ''}
            onClick={() => setViewMode('config')}
          >
            <Settings2 size={15} />
            {t('common.configView')}
          </button>
        </div>
        {viewMode === 'graph' && (
          <div className="endpointToolbarActions">
            <div className="endpointFilters" aria-label={t('endpoint.filters')}>
              <SlidersHorizontal size={15} />
              <select
                value={protocolFilter}
                onChange={event =>
                  setProtocolFilter(
                    event.target.value as EndpointProtocolFilter,
                  )
                }
              >
                <option value="all">{t('endpoint.allProtocols')}</option>
                <option value="http">HTTP</option>
                <option value="ws">WebSocket</option>
              </select>
              <select
                value={roleFilter}
                onChange={event =>
                  setRoleFilter(event.target.value as EndpointRoleFilter)
                }
              >
                <option value="all">{t('endpoint.allRoles')}</option>
                <option value="server">{t('endpoint.listeners')}</option>
                <option value="client">{t('endpoint.senders')}</option>
              </select>
            </div>
            <label className="endpointSearch">
              <Search size={15} />
              <input
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder={t('endpoint.search')}
              />
            </label>
            <EndpointCreateBar
              kind={createKind}
              t={t}
              onKindChange={setCreateKind}
              onCreate={() =>
                setEditing(createNewEndpointDraft(createKind, config))
              }
            />
          </div>
        )}
      </div>
      {viewMode === 'config' ? (
        <YamlEditor
          name="endpoints"
          title={t('panel.endpointConfig')}
          value={raw}
          t={t}
          onSave={onSave}
        />
      ) : (
        <div className="endpointWorkbench">
          <section className="endpointCenter">
            <EndpointConnectionTable
              endpoints={filteredEndpoints}
              allEndpoints={endpoints}
              editing={editing}
              logs={logs}
              t={t}
              onSelect={endpoint =>
                setEditing(
                  createEndpointDraft(
                    endpoint.kind,
                    endpoint.index,
                    endpoint.raw,
                    config,
                  ),
                )
              }
              onTest={endpoint => runEndpointTest(endpoint.kind, endpoint.id)}
              onColorChange={(endpoint, color) =>
                updateColor(endpoint.kind, endpoint.id, color)
              }
              onDelete={endpoint => void deleteEndpoint(endpoint)}
            />
          </section>
          <aside className="endpointInspector">
            {editing ? (
              <>
                <div className="inspectorTabs">
                  <button
                    className={inspectorMode === 'config' ? 'active' : ''}
                    onClick={() => setInspectorMode('config')}
                  >
                    <Settings2 size={15} />
                    {t('endpoint.configuration')}
                  </button>
                  <button
                    className={inspectorMode === 'test' ? 'active' : ''}
                    onClick={() => setInspectorMode('test')}
                  >
                    <TestTube2 size={15} />
                    {t('endpoint.testPanel')}
                  </button>
                </div>
                {inspectorMode === 'config' ? (
                  <EndpointEditor
                    draft={editing}
                    templates={templates}
                    t={t}
                    inline
                    onChange={setEditing}
                    onClose={() => setEditing(null)}
                    onSave={() => saveDraft(editing)}
                  />
                ) : (
                  <EndpointTestPanel
                    draft={editing}
                    t={t}
                    onTest={options =>
                      runEndpointTest(editing.kind, editing.id, options)
                    }
                  />
                )}
              </>
            ) : (
              <div className="inspectorEmpty">
                <Settings2 size={22} />
                <span>{t('endpoint.selectToInspect')}</span>
              </div>
            )}
          </aside>
          <aside className="endpointSelectedLogs">
            <EndpointLogPanel
              logs={selectedLogs}
              t={t}
              title={
                selectedEndpoint
                  ? t('endpoint.selectedActivity', {id: selectedEndpoint.id})
                  : t('panel.endpointLogs')
              }
            />
          </aside>
        </div>
      )}
    </section>
  );
}

function EndpointConnectionTable({
  endpoints,
  allEndpoints,
  editing,
  logs,
  t,
  onSelect,
  onTest,
  onColorChange,
  onDelete,
}: {
  endpoints: EndpointDisplay[];
  allEndpoints: EndpointDisplay[];
  editing: EndpointDraft | null;
  logs: EndpointLogEntry[];
  t: Translator;
  onSelect: (endpoint: EndpointDisplay) => void;
  onTest: (endpoint: EndpointDisplay) => void;
  onColorChange: (endpoint: EndpointDisplay, color: string) => void;
  onDelete: (endpoint: EndpointDisplay) => void;
}) {
  const selectedEndpoint = editing
    ? allEndpoints.find(
        endpoint =>
          endpoint.kind === editing.kind && endpoint.index === editing.index,
      )
    : undefined;
  const selectedKey = selectedEndpoint?.key ?? '';

  return (
    <>
      <div className="connectionSummary">
        <div>
          <span>{t('endpoint.registryDescription')}</span>
          <strong>{t('endpoint.registry')}</strong>
        </div>
        <div className="connectionStats">
          <span>
            <strong>
              {endpoints.length}/{allEndpoints.length}
            </strong>
            {t('endpoint.visible')}
          </span>
          <span>
            <strong>
              {allEndpoints.filter(endpoint => endpoint.enabled).length}
            </strong>
            {t('endpoint.active')}
          </span>
          <span>
            <strong>
              {
                allEndpoints.filter(endpoint =>
                  endpoint.kind.endsWith('Server'),
                ).length
              }
            </strong>
            {t('endpoint.listeners')}
          </span>
          <span>
            <strong>
              {
                allEndpoints.filter(endpoint =>
                  endpoint.kind.endsWith('Client'),
                ).length
              }
            </strong>
            {t('endpoint.senders')}
          </span>
        </div>
      </div>
      <div className="connectionTable">
        <div className="connectionTableHead">
          <span>{t('field.id')}</span>
          <span>{t('field.type')}</span>
          <span>{t('field.url')}</span>
          <span>{t('endpoint.lastActivity')}</span>
          <span />
        </div>
        {endpoints.map(endpoint => {
          const latest = logs.find(log => log.endpointKey === endpoint.key);
          return (
            <div
              role="button"
              tabIndex={0}
              className={`connectionRow${endpoint.key === selectedKey ? ' selected' : ''}${endpoint.enabled ? '' : ' disabled'}`}
              key={endpoint.key}
              onClick={() => onSelect(endpoint)}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ')
                  onSelect(endpoint);
              }}
            >
              <span className="connectionIdentity">
                <i
                  style={
                    endpoint.enabled ? {background: endpoint.color} : undefined
                  }
                />
                <strong>{endpoint.id}</strong>
                <small
                  className={
                    endpoint.enabled
                      ? 'statusBadge enabled'
                      : 'statusBadge disabled'
                  }
                >
                  {endpoint.enabled
                    ? t('common.enabled')
                    : t('common.disabled')}
                </small>
              </span>
              <code>{endpoint.type}</code>
              <span className="connectionUrl">
                {endpoint.fields[0]?.[1] ?? t('common.notAvailable')}
              </span>
              <em>
                {latest
                  ? new Date(latest.time).toLocaleTimeString()
                  : t('endpoint.noActivity')}
              </em>
              <span className="connectionActions">
                <label
                  className="colorPicker"
                  title={t('field.color')}
                  onClick={event => event.stopPropagation()}
                >
                  <span style={{background: endpoint.color}} />
                  <input
                    type="color"
                    value={endpoint.color}
                    onChange={event =>
                      onColorChange(endpoint, event.target.value)
                    }
                    aria-label={t('field.color')}
                  />
                </label>
                <button
                  onClick={event => {
                    event.stopPropagation();
                    onTest(endpoint);
                  }}
                  title={`${t('common.test')} ${endpoint.id}`}
                >
                  <Bug size={15} />
                </button>
                <button
                  className="dangerIconButton"
                  onClick={event => {
                    event.stopPropagation();
                    onDelete(endpoint);
                  }}
                  title={`${t('common.delete')} ${endpoint.id}`}
                >
                  <Trash2 size={15} />
                </button>
              </span>
            </div>
          );
        })}
        {endpoints.length === 0 && (
          <div className="connectionEmpty">
            <Search size={20} />
            <span>{t('endpoint.noMatches')}</span>
          </div>
        )}
      </div>
    </>
  );
}

function EndpointCreateBar({
  kind,
  t,
  onKindChange,
  onCreate,
}: {
  kind: EndpointKind;
  t: Translator;
  onKindChange: (kind: EndpointKind) => void;
  onCreate: () => void;
}) {
  return (
    <div className="createBar">
      <select
        value={kind}
        onChange={event => onKindChange(event.target.value as EndpointKind)}
        aria-label={t('endpoint.createKind')}
      >
        <option value="httpServer">{t('endpoint.httpServer')}</option>
        <option value="wsServer">{t('endpoint.wsServer')}</option>
        <option value="httpClient">{t('endpoint.httpClient')}</option>
        <option value="wsClient">{t('endpoint.wsClient')}</option>
      </select>
      <button onClick={onCreate} title={t('endpoint.create')}>
        <Plus size={16} />
        <span>{t('endpoint.create')}</span>
      </button>
    </div>
  );
}

function EndpointLogPanel({
  logs,
  t,
  title,
}: {
  logs: EndpointLogEntry[];
  t: Translator;
  title?: string;
}) {
  return (
    <Panel title={title ?? t('panel.endpointLogs')}>
      <EndpointLogList logs={logs} t={t} />
    </Panel>
  );
}

function EndpointLogList({
  logs,
  t,
  compact = false,
}: {
  logs: EndpointLogEntry[];
  t: Translator;
  compact?: boolean;
}) {
  return (
    <div className={compact ? 'endpointLogList compact' : 'endpointLogList'}>
      {logs.length === 0 && <div className="empty">{t('log.noEntries')}</div>}
      {logs.map(log => (
        <details
          className={`endpointLog ${log.level}`}
          key={log.id}
          style={{borderLeftColor: log.color}}
        >
          <summary className="endpointLogHead">
            <span>
              <small>{t('field.time')}</small>
              <strong>{new Date(log.time).toLocaleTimeString()}</strong>
            </span>
            <span>
              <small>{t('field.type')}</small>
              <code>{t(`log.${log.type}`)}</code>
            </span>
            <span>
              <small>{t('field.content')}</small>
              <strong>{endpointLogPreview(log)}</strong>
            </span>
            <span>
              <small>{t('field.source')}</small>
              <strong>{log.endpointId}</strong>
            </span>
          </summary>
          {log.decoded?.matched && (
            <div className="decodedItems">
              {log.decoded.displayItems?.map(item => (
                <div key={`${item.label}-${item.path}`}>
                  <span>{item.label}</span>
                  <strong>{formatLogValue(item.value)}</strong>
                </div>
              ))}
            </div>
          )}
          {log.decoded && !log.decoded.matched && (
            <small className="templateMismatch">
              {t('log.templateMismatch', {template: log.decoded.template})}
              {formatTemplateErrors(log.decoded)}
            </small>
          )}
          {endpointLogImageUrl(log) && (
            <a
              className="endpointImageUrl"
              href={endpointLogImageUrl(log)}
              target="_blank"
              rel="noreferrer"
            >
              {endpointLogImageUrl(log)}
            </a>
          )}
          {log.detail && <small>{log.detail}</small>}
          <pre className="endpointRawJson">{formatExpandedLog(log)}</pre>
        </details>
      ))}
    </div>
  );
}

function EndpointTestPanel({
  draft,
  t,
  onTest,
}: {
  draft: EndpointDraft;
  t: Translator;
  onTest: (options: EndpointTestOptions) => Promise<EndpointTestResult>;
}) {
  const isHttp = draft.kind === 'httpServer' || draft.kind === 'httpClient';
  const [method, setMethod] =
    React.useState<EndpointTestOptions['method']>('GET');
  const [path, setPath] = React.useState('/api/health');
  const [bodyText, setBodyText] = React.useState('');
  const [result, setResult] = React.useState<EndpointTestResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [running, setRunning] = React.useState(false);

  React.useEffect(() => {
    setMethod('GET');
    setPath('/api/health');
    setBodyText('');
    setResult(null);
    setError(null);
  }, [draft.kind, draft.id]);

  async function execute(custom: boolean) {
    setError(null);
    setRunning(true);
    try {
      const options: EndpointTestOptions = custom
        ? {
            ...(isHttp ? {method} : {}),
            ...(draft.kind === 'httpClient' ? {path} : {}),
            ...(draft.kind === 'httpClient' && draft.template
              ? {useTemplate: true}
              : {}),
            ...(bodyText.trim() ? {body: JSON.parse(bodyText)} : {}),
          }
        : {};
      setResult(await onTest(options));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="endpointTestPanel">
      <div className="modalHead">
        <div>
          <span>{t('endpoint.testPanel')}</span>
          <h2>{draft.id}</h2>
        </div>
      </div>
      <div className="testPanelBody">
        <div className="testTarget">
          <span>{t('endpoint.testTarget')}</span>
          <code>{endpointDraftUrl(draft)}</code>
        </div>
        {isHttp && (
          <label>
            <span>{t('endpoint.httpMethod')}</span>
            <select
              value={method}
              onChange={event =>
                setMethod(event.target.value as EndpointTestOptions['method'])
              }
            >
              {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(value => (
                <option value={value} key={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        )}
        {draft.kind === 'httpClient' && (
          <label>
            <span>{t('endpoint.relativePath')}</span>
            <input
              value={path}
              onChange={event => setPath(event.target.value)}
              placeholder="/api/health"
            />
          </label>
        )}
        <label>
          <span>{t('endpoint.testPayload')}</span>
          <textarea
            className="testPayload"
            value={bodyText}
            onChange={event => setBodyText(event.target.value)}
            placeholder={'{\n  "command": "hello"\n}'}
            spellCheck={false}
          />
        </label>
        <p className="formHint">
          {t(isHttp ? 'endpoint.httpTestHint' : 'endpoint.wsTestHint')}
        </p>
        {error && <div className="formError">{error}</div>}
        {result && (
          <div className={result.ok ? 'testResult ok' : 'testResult failed'}>
            <div>
              <strong>{result.ok ? t('common.ok') : t('common.failed')}</strong>
              <span>{result.durationMs} ms</span>
            </div>
            <span>{result.message}</span>
            {result.target && <code>{result.target}</code>}
            {result.responseBody && <pre>{result.responseBody}</pre>}
          </div>
        )}
      </div>
      <div className="modalActions">
        <button disabled={running} onClick={() => void execute(false)}>
          <Bug size={15} />
          {t('endpoint.quickProbe')}
        </button>
        <button
          className="primaryButton"
          disabled={running}
          onClick={() => void execute(true)}
        >
          <Play size={15} />
          {t('endpoint.sendTest')}
        </button>
      </div>
    </section>
  );
}

function EndpointEditor({
  draft,
  templates,
  t,
  inline = false,
  onChange,
  onClose,
  onSave,
}: {
  draft: EndpointDraft;
  templates: MessageTemplateSummary[];
  t: Translator;
  inline?: boolean;
  onChange: (draft: EndpointDraft) => void;
  onClose: () => void;
  onSave: () => Promise<void>;
}) {
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const update = (patch: Partial<EndpointDraft>) =>
    onChange({...draft, ...patch});
  const isServer = draft.kind === 'httpServer' || draft.kind === 'wsServer';
  const selectedTemplate = templates.find(
    template => template.name === draft.template,
  );
  const clientTemplateFields =
    selectedTemplate?.fields.filter(field => field.roles.send) ?? [];

  function toggleTemplateField(field: MessageTemplateField, checked: boolean) {
    update({
      templateFields: checked
        ? [...new Set([...draft.templateFields, field.path])]
        : draft.templateFields.filter(pathValue => pathValue !== field.path),
      templateValues: checked
        ? draft.templateValues
        : Object.fromEntries(
            Object.entries(draft.templateValues).filter(
              ([pathValue]) => pathValue !== field.path,
            ),
          ),
    });
  }

  function updateTemplateFieldValue(
    field: MessageTemplateField,
    value: string,
  ) {
    update({
      templateFields: [...new Set([...draft.templateFields, field.path])],
      templateValues: {...draft.templateValues, [field.path]: value},
    });
  }

  async function handleSave() {
    setSaveError(null);
    try {
      await onSave();
    } catch (error) {
      setSaveError(errorMessage(error));
    }
  }

  return (
    <div className={inline ? 'inspectorEditor' : 'modalBackdrop'}>
      <section className={inline ? 'inspectorEditorPanel' : 'modalPanel'}>
        <div className="modalHead">
          <div>
            <span>{t('endpoint.inspector')}</span>
            <h2>{draft.id}</h2>
          </div>
          {!inline && (
            <button onClick={onClose} title={t('common.close')}>
              <XCircle size={17} />
            </button>
          )}
        </div>
        <div className="formGrid">
          {saveError && <div className="formError wideLabel">{saveError}</div>}
          <label>
            <span>{t('field.type')}</span>
            <input value={t(`endpoint.${draft.kind}`)} disabled />
          </label>
          <label>
            <span>{t('field.id')}</span>
            <input
              value={draft.id}
              onChange={event => update({id: event.target.value})}
            />
          </label>
          <label className="checkLabel">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={event => update({enabled: event.target.checked})}
            />
            <span>{t('field.enabled')}</span>
          </label>
          {(draft.kind === 'httpServer' ||
            draft.kind === 'httpClient' ||
            draft.kind === 'wsServer') && (
            <label className="wideLabel">
              <span>{t('field.description')}</span>
              <input
                value={draft.description}
                onChange={event => update({description: event.target.value})}
              />
            </label>
          )}
          {draft.kind === 'httpServer' && (
            <label className="wideLabel">
              <span>{t('field.url')}</span>
              <input
                value={draft.baseUrl}
                onChange={event => update({baseUrl: event.target.value})}
                placeholder="http://127.0.0.1:4789"
              />
            </label>
          )}
          {draft.kind === 'wsServer' && (
            <>
              <label>
                <span>{t('field.host')}</span>
                <input
                  value={draft.host}
                  onChange={event => update({host: event.target.value})}
                />
              </label>
              <label>
                <span>{t('field.port')}</span>
                <input
                  type="number"
                  min={1}
                  max={65535}
                  value={draft.port}
                  onChange={event => update({port: event.target.value})}
                />
              </label>
              <label className="wideLabel">
                <span>{t('field.url')}</span>
                <input value={endpointServerUrl(draft)} disabled />
              </label>
              <p className="formHint">{t('hint.endpointListenerRuntime')}</p>
            </>
          )}
          {isServer && (
            <label className="wideLabel">
              <span>{t('field.path')}</span>
              <input
                value={draft.path}
                onChange={event => update({path: event.target.value})}
              />
            </label>
          )}
          {draft.kind === 'httpServer' && (
            <>
              <label className="wideLabel">
                <span>{t('field.messageTemplate')}</span>
                <select
                  value={draft.template}
                  onChange={event => update({template: event.target.value})}
                >
                  <option value="">{t('common.noTemplate')}</option>
                  {templates
                    .filter(template => template.capabilities.receive)
                    .map(template => (
                      <option value={template.name} key={template.name}>
                        {template.displayName}
                      </option>
                    ))}
                </select>
              </label>
              <p className="formHint">{t('hint.messageTemplate')}</p>
            </>
          )}
          {draft.kind === 'httpClient' && (
            <>
              <label className="wideLabel">
                <span>{t('field.url')}</span>
                <input
                  value={draft.baseUrl}
                  onChange={event => update({baseUrl: event.target.value})}
                />
              </label>
              <label className="wideLabel">
                <span>{t('field.headers')}</span>
                <textarea
                  className="formTextarea"
                  value={draft.headersText}
                  onChange={event => update({headersText: event.target.value})}
                  spellCheck={false}
                />
              </label>
              <p className="formHint">{t('hint.headersJson')}</p>
              <label className="wideLabel">
                <span>{t('field.messageTemplate')}</span>
                <select
                  value={draft.template}
                  onChange={event =>
                    update({
                      template: event.target.value,
                      templateFields: [],
                      templateValues: {},
                    })
                  }
                >
                  <option value="">{t('common.noTemplate')}</option>
                  {templates
                    .filter(template => template.capabilities.send)
                    .map(template => (
                      <option value={template.name} key={template.name}>
                        {template.displayName}
                      </option>
                    ))}
                </select>
              </label>
              {selectedTemplate && (
                <fieldset className="templateFieldGrid wideLabel endpointTemplateFields">
                  <legend>{t('endpoint.templateFields')}</legend>
                  <p className="templateFieldHint">
                    {t('endpoint.clientTemplateHint')}
                  </p>
                  {clientTemplateFields.map(field => {
                    const selected =
                      field.required ||
                      draft.templateFields.includes(field.path);
                    return (
                      <div className="endpointTemplateField" key={field.key}>
                        <label className="checkLabel">
                          <input
                            type="checkbox"
                            checked={selected}
                            disabled={field.required}
                            onChange={event =>
                              toggleTemplateField(field, event.target.checked)
                            }
                          />
                          <span>
                            {field.label}
                            {field.required ? ' *' : ''}
                          </span>
                        </label>
                        {selected && (
                          <>
                            <TemplateFieldControl
                              field={field}
                              value={draft.templateValues[field.path] ?? ''}
                              onChange={value =>
                                updateTemplateFieldValue(field, value)
                              }
                            />
                            <small>{templateFieldConstraint(field)}</small>
                          </>
                        )}
                      </div>
                    );
                  })}
                </fieldset>
              )}
            </>
          )}
          {draft.kind === 'wsClient' && (
            <label className="wideLabel">
              <span>{t('field.url')}</span>
              <input
                value={draft.url}
                onChange={event => update({url: event.target.value})}
              />
            </label>
          )}
        </div>
        <div className="modalActions">
          {!inline && <button onClick={onClose}>{t('common.close')}</button>}
          <button className="primaryButton" onClick={() => void handleSave()}>
            {t('common.save')}
          </button>
        </div>
      </section>
    </div>
  );
}

function createEndpointDraft(
  kind: EndpointKind,
  index: number,
  endpoint:
    | AppConfig['endpoints']['httpServers'][number]
    | AppConfig['endpoints']['wsServers'][number]
    | AppConfig['endpoints']['httpClients'][number]
    | AppConfig['endpoints']['wsClients'][number],
  config: AppConfig,
): EndpointDraft {
  const host =
    'host' in endpoint && endpoint.host
      ? endpoint.host
      : (config.app?.server?.host ?? '127.0.0.1');
  const port =
    'port' in endpoint && endpoint.port
      ? endpoint.port
      : (config.app?.server?.port ?? Number(new URL(API_BASE).port));
  return {
    kind,
    index,
    id: endpoint.id,
    enabled: endpoint.enabled,
    description: 'description' in endpoint ? (endpoint.description ?? '') : '',
    host,
    port: String(port),
    path: 'path' in endpoint ? (endpoint.path ?? '/ingest') : '',
    baseUrl:
      'baseUrl' in endpoint
        ? endpoint.baseUrl
        : kind === 'httpServer'
          ? `http://${formatUrlHost(host)}:${port}`
          : '',
    url: 'url' in endpoint ? endpoint.url : '',
    template: 'template' in endpoint ? (endpoint.template ?? '') : '',
    templateFields:
      'templateFields' in endpoint ? (endpoint.templateFields ?? []) : [],
    templateValues:
      'templateValues' in endpoint
        ? stringifyTemplateValues(endpoint.templateValues ?? {})
        : {},
    headersText:
      'headers' in endpoint
        ? JSON.stringify(endpoint.headers ?? {}, null, 2)
        : '{}',
  };
}

function createNewEndpointDraft(
  kind: EndpointKind,
  config: AppConfig,
): EndpointDraft {
  const id = nextEndpointId(kind, config.endpoints);
  const baseUrl = `http://${config.app?.server?.host ?? '127.0.0.1'}:${config.app?.server?.port ?? Number(new URL(API_BASE).port)}`;
  return {
    kind,
    index: -1,
    id,
    enabled: true,
    description: '',
    host: config.app?.server?.host ?? '127.0.0.1',
    port: String(config.app?.server?.port ?? Number(new URL(API_BASE).port)),
    path:
      kind === 'httpServer'
        ? '/ingest'
        : kind === 'wsServer'
          ? `/ws/${id}`
          : '',
    baseUrl: kind === 'httpClient' || kind === 'httpServer' ? baseUrl : '',
    url:
      kind === 'wsClient' ? `${baseUrl.replace(/^http/, 'ws')}/ws/control` : '',
    template: '',
    templateFields: [],
    templateValues: {},
    headersText: '{}',
  };
}

function nextEndpointId(
  kind: EndpointKind,
  endpoints: AppConfig['endpoints'],
): string {
  const prefixes: Record<EndpointKind, string> = {
    httpServer: 'http-server',
    wsServer: 'ws-server',
    httpClient: 'http-client',
    wsClient: 'ws-client',
  };
  const used = new Set([
    ...endpoints.httpServers.map(endpoint => endpoint.id),
    ...endpoints.wsServers.map(endpoint => endpoint.id),
    ...endpoints.httpClients.map(endpoint => endpoint.id),
    ...endpoints.wsClients.map(endpoint => endpoint.id),
  ]);
  const prefix = prefixes[kind];
  let index = 1;
  while (used.has(`${prefix}-${index}`)) {
    index += 1;
  }
  return `${prefix}-${index}`;
}

function endpointIndexByKind(
  endpoints: AppConfig['endpoints'],
  kind: EndpointKind,
  id: string,
): number {
  if (kind === 'httpServer')
    return endpoints.httpServers.findIndex(endpoint => endpoint.id === id);
  if (kind === 'wsServer')
    return endpoints.wsServers.findIndex(endpoint => endpoint.id === id);
  if (kind === 'httpClient')
    return endpoints.httpClients.findIndex(endpoint => endpoint.id === id);
  return endpoints.wsClients.findIndex(endpoint => endpoint.id === id);
}

function endpointServerUrl(draft: EndpointDraft): string {
  if (draft.kind === 'httpServer') {
    return `${draft.baseUrl.replace(/\/$/u, '')}${draft.path || ''}`;
  }
  const protocol = draft.kind === 'wsServer' ? 'ws' : 'http';
  return `${protocol}://${formatUrlHost(draft.host || '127.0.0.1')}:${draft.port || ''}${draft.path || ''}`;
}

function parseHttpListenerUrl(
  value: string,
  t: Translator,
): {host: string; port: number} {
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== 'http:') throw new Error('protocol');
    if (parsed.pathname !== '/' || parsed.search || parsed.hash)
      throw new Error('path');
    return {
      host: parsed.hostname.replace(/^\[(.*)\]$/u, '$1'),
      port: parsed.port ? parsePort(parsed.port, t) : 80,
    };
  } catch {
    throw new Error(t('error.invalidHttpListenerUrl'));
  }
}

function formatUrlHost(host: string): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

function endpointDraftUrl(draft: EndpointDraft): string {
  if (draft.kind === 'httpClient') return draft.baseUrl;
  if (draft.kind === 'wsClient') return draft.url;
  return endpointServerUrl(draft);
}

function parseHost(value: string, t: Translator): string {
  const host = value.trim();
  if (!host) {
    throw new Error(t('error.invalidHost'));
  }
  return host;
}

function parsePort(value: string, t: Translator): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(t('error.invalidPort'));
  }
  return port;
}

function parsePath(value: string, t: Translator): string {
  const path = value.trim();
  if (!path.startsWith('/')) {
    throw new Error(t('error.invalidPath'));
  }
  return path;
}

function parseHeaders(text: string): Record<string, string> | undefined {
  const trimmed = text.trim();
  if (!trimmed || trimmed === '{}') {
    return undefined;
  }
  const parsed = JSON.parse(trimmed) as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(parsed).map(([key, value]) => [key, String(value)]),
  );
}

function emptyToUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function endpointKey(kind: EndpointKind, id: string): string {
  return `${kind}:${id}`;
}

function readEndpointColors(): Record<string, string> {
  try {
    return JSON.parse(
      localStorage.getItem('las-endpoint-colors') ?? '{}',
    ) as Record<string, string>;
  } catch {
    return {};
  }
}

function endpointColor(
  colors: Record<string, string>,
  kind: EndpointKind,
  id: string,
  index: number,
): string {
  const defaults = ['#2f7f8f', '#7d6bc4', '#c47a3a', '#3d8a5f', '#b94f6c'];
  return colors[endpointKey(kind, id)] ?? defaults[index % defaults.length];
}

function endpointEventLogs(
  events: EventRow[],
  endpoints: Array<{
    kind: EndpointKind;
    id: string;
    key: string;
    color: string;
  }>,
  colors: Record<string, string>,
  t: Translator,
): EndpointLogEntry[] {
  const candidates = endpoints.filter(
    endpoint => endpoint.kind === 'httpServer' || endpoint.kind === 'wsServer',
  );

  return events.flatMap(event => {
    const endpoint = candidates.find(candidate => {
      if (candidate.kind === 'httpServer') {
        return event.source === `http.server.${candidate.id}`;
      }
      return event.source === `ws.server.${candidate.id}`;
    });

    if (!endpoint) {
      return [];
    }

    const method =
      typeof event.meta?.method === 'string' ? event.meta.method : '';
    const path = typeof event.meta?.path === 'string' ? event.meta.path : '';
    const detail = [method, path].filter(Boolean).join(' ');
    const decoded = isDecodedMessage(event.meta?.decoded)
      ? event.meta.decoded
      : undefined;
    return [
      {
        id: event.id,
        time: event.time,
        endpointKey: endpoint.key,
        endpointId: endpoint.id,
        color: colors[endpoint.key] ?? endpoint.color,
        level: 'info' as const,
        type: 'event' as const,
        message: `${event.kind} ${detail}`.trim() || t('log.event'),
        detail: decoded?.matched ? undefined : JSON.stringify(event.body ?? {}),
        decoded,
      },
    ];
  });
}

function isDecodedMessage(value: unknown): value is DecodedMessage {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const decoded = value as Partial<DecodedMessage>;
  return (
    typeof decoded.template === 'string' && typeof decoded.matched === 'boolean'
  );
}

function formatLogValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  return JSON.stringify(value ?? null);
}

function formatTemplateErrors(decoded: DecodedMessage): string {
  if (decoded.error) {
    return ` ${decoded.error}`;
  }
  if (!decoded.errors?.length) {
    return '';
  }
  return ` ${decoded.errors.map(error => `${error.path}: ${error.message}`).join('; ')}`;
}

function endpointLogPreview(log: EndpointLogEntry): string {
  if (log.decoded?.matched && log.decoded.displayItems?.length) {
    return log.decoded.displayItems
      .map(item => `${item.label}: ${formatLogValue(item.value)}`)
      .join(' / ');
  }
  return log.message || log.detail || '';
}

function endpointLogImageUrl(log: EndpointLogEntry): string | undefined {
  const values = [
    ...(log.decoded?.displayItems?.map(item => item.value) ?? []),
    log.detail,
  ];
  const candidate = values.find(
    value =>
      typeof value === 'string' &&
      /^https?:\/\/.+\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/i.test(value),
  );
  return typeof candidate === 'string' ? candidate : undefined;
}

function formatExpandedLog(log: EndpointLogEntry): string {
  return JSON.stringify(
    {
      time: log.time,
      endpoint: log.endpointId,
      level: log.level,
      type: log.type,
      message: log.message,
      decoded: log.decoded,
      detail: log.detail,
    },
    null,
    2,
  );
}

function filterByOverviewRange<T>(
  rows: T[],
  range: OverviewRange,
  getTime: (row: T) => string,
): T[] {
  if (range === 'all') return rows;
  const windowMs =
    range === '1h'
      ? 60 * 60 * 1000
      : range === '1d'
        ? 24 * 60 * 60 * 1000
        : 7 * 24 * 60 * 60 * 1000;
  const start = Date.now() - windowMs;
  return rows.filter(row => {
    const time = getTime(row);
    if (!time) return false;
    const value = new Date(time).getTime();
    return Number.isFinite(value) && value >= start;
  });
}

function countCompletedRuleExecutions(runs: RunRow[]): number {
  const grouped = new Map<string, RunRow[]>();
  for (const run of runs) {
    if (!run.ruleId || !run.traceId) continue;
    const key = `${run.traceId}:${run.ruleId}`;
    grouped.set(key, [...(grouped.get(key) ?? []), run]);
  }
  let completed = 0;
  for (const group of grouped.values()) {
    if (
      group.length > 0 &&
      group.every(run => run.status === 'completed' && run.ok !== false)
    ) {
      completed += 1;
    }
  }
  return completed;
}

function diagnosticSuggestion(kind: ApiFailureKind, t: Translator): string {
  if (kind === 'network') return t('diagnostics.network');
  if (kind === 'http') return t('diagnostics.http');
  if (kind === 'parse') return t('diagnostics.parse');
  return t('diagnostics.unknown');
}

function ActionsPanel({
  raw,
  actions,
  templates,
  queue,
  runs,
  t,
  onSaveActions,
  onSave,
  onRun,
  onCancel,
}: {
  raw: string;
  actions: AppConfig['actions'];
  templates: MessageTemplateSummary[];
  queue: QueueSnapshot | null;
  runs: RunRow[];
  t: Translator;
  onSaveActions: (actions: AppConfig['actions'], id: string) => Promise<void>;
  onSave: (content: string) => Promise<void>;
  onRun: (id: string) => Promise<void>;
  onCancel: (id: string) => void;
}) {
  const [viewMode, setViewMode] = React.useState<ActionViewMode>('graph');
  const [query, setQuery] = React.useState('');
  const [typeFilter, setTypeFilter] = React.useState<ActionTypeFilter>('all');
  const [createKind, setCreateKind] = React.useState<ActionKind>('send_http');
  const [draft, setDraft] = React.useState<ActionDraft | null>(() =>
    actions[0] ? createActionDraft(actions[0], 0) : null,
  );
  const [inspectorMode, setInspectorMode] =
    React.useState<ActionInspectorMode>('config');
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [runError, setRunError] = React.useState<string | null>(null);
  const [runningTrial, setRunningTrial] = React.useState(false);
  const activeRuns = [...(queue?.running ?? []), ...(queue?.queued ?? [])];
  const filteredActions = actions.filter(
    action =>
      (typeFilter === 'all' || action.type === typeFilter) &&
      `${action.id} ${action.type} ${action.description ?? ''} ${actionTargetSummary(action)}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  const selectedAction =
    draft?.index === -1 ? undefined : actions[draft?.index ?? -1];
  const selectedRuns = runs
    .filter(run => run.actionId === draft?.id)
    .slice(0, 8);
  const selectedActiveRuns = activeRuns.filter(
    run => run.actionId === draft?.id,
  );

  React.useEffect(() => {
    if (!draft && actions[0]) setDraft(createActionDraft(actions[0], 0));
  }, [actions]);

  async function saveDraft() {
    if (!draft) return;
    setSaveError(null);
    try {
      const next = structuredClone(actions);
      const action = actionFromDraft(draft);
      if (draft.index < 0) next.push(action);
      else next[draft.index] = action;
      await onSaveActions(next, action.id);
      setDraft(
        createActionDraft(
          action,
          next.findIndex(item => item.id === action.id),
        ),
      );
    } catch (error) {
      setSaveError(errorMessage(error));
    }
  }

  async function runTrial() {
    if (!draft || draft.index < 0) return;
    setRunError(null);
    setRunningTrial(true);
    try {
      await onRun(draft.id);
    } catch (error) {
      setRunError(errorMessage(error));
    } finally {
      setRunningTrial(false);
    }
  }

  async function deleteAction(action: AppAction, index: number) {
    if (!window.confirm(t('common.confirmDelete', {id: action.id}))) return;
    const next = actions.filter((_, itemIndex) => itemIndex !== index);
    setDraft(null);
    await onSaveActions(next, action.id);
  }

  return (
    <section className="actionWorkspace">
      <div className="workspaceToolbar">
        <div className="endpointViewSwitch">
          <button
            className={viewMode === 'graph' ? 'active' : ''}
            onClick={() => setViewMode('graph')}
          >
            <Play size={15} />
            {t('action.management')}
          </button>
          <button
            className={viewMode === 'config' ? 'active' : ''}
            onClick={() => setViewMode('config')}
          >
            <Settings2 size={15} />
            {t('common.configView')}
          </button>
        </div>
        {viewMode === 'graph' && (
          <div className="actionToolbarActions">
            <select
              value={typeFilter}
              onChange={event =>
                setTypeFilter(event.target.value as ActionTypeFilter)
              }
            >
              <option value="all">{t('action.allTypes')}</option>
              <option value="send_http">{t('action.sendHttp')}</option>
              <option value="send_ws">{t('action.sendWs')}</option>
              <option value="command">{t('action.command')}</option>
            </select>
            <label className="endpointSearch">
              <Search size={15} />
              <input
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder={t('action.search')}
              />
            </label>
            <div className="createBar">
              <select
                value={createKind}
                onChange={event =>
                  setCreateKind(event.target.value as ActionKind)
                }
              >
                <option value="send_http">{t('action.sendHttp')}</option>
                <option value="send_ws">{t('action.sendWs')}</option>
                <option value="command">{t('action.command')}</option>
              </select>
              <button
                onClick={() => {
                  setDraft(createNewActionDraft(createKind, actions));
                  setInspectorMode('config');
                }}
              >
                <Plus size={16} />
                {t('action.create')}
              </button>
            </div>
          </div>
        )}
      </div>
      {viewMode === 'config' ? (
        <YamlEditor name="actions" value={raw} t={t} onSave={onSave} />
      ) : (
        <div className="actionResourceWorkbench">
          <section className="actionScheduleList">
            <div className="actionRegistry">
              <div className="actionRegistryHead">
                <div>
                  <span>{t('action.registryDescription')}</span>
                  <strong>{t('action.registry')}</strong>
                </div>
                <div>
                  <span>
                    <strong>
                      {filteredActions.length}/{actions.length}
                    </strong>
                    {t('action.visible')}
                  </span>
                  <span>
                    <strong>{activeRuns.length}</strong>
                    {t('action.activeRuns')}
                  </span>
                </div>
              </div>
              <div className="actionTableHead">
                <span>{t('field.id')}</span>
                <span>{t('field.type')}</span>
                <span>{t('action.target')}</span>
                <span>{t('action.lastRun')}</span>
                <span />
              </div>
              {filteredActions.map(action => {
                const index = actions.indexOf(action);
                const lastRun = runs.find(run => run.actionId === action.id);
                return (
                  <div
                    role="button"
                    tabIndex={0}
                    className={
                      draft?.index === index
                        ? 'actionResourceRow selected'
                        : 'actionResourceRow'
                    }
                    key={action.id}
                    onClick={() => setDraft(createActionDraft(action, index))}
                    onKeyDown={event => {
                      if (event.key === 'Enter' || event.key === ' ')
                        setDraft(createActionDraft(action, index));
                    }}
                  >
                    <span>
                      <i className={action.type} />
                      <strong>{action.id}</strong>
                    </span>
                    <code>{actionTypeLabel(action.type, t)}</code>
                    <span>{actionTargetSummary(action)}</span>
                    <em>
                      {lastRun
                        ? `${t(`run.${lastRun.status}`)}${lastRun.durationMs ? ` / ${lastRun.durationMs}ms` : ''}`
                        : t('action.neverRun')}
                    </em>
                    <span className="rowActions">
                      <button
                        className="dangerIconButton"
                        onClick={event => {
                          event.stopPropagation();
                          void deleteAction(action, index);
                        }}
                        title={`${t('common.delete')} ${action.id}`}
                      >
                        <Trash2 size={15} />
                      </button>
                    </span>
                  </div>
                );
              })}
              {filteredActions.length === 0 && (
                <div className="connectionEmpty">{t('action.noMatches')}</div>
              )}
            </div>
          </section>
          <section className="actionScheduleDetails">
            <section className="actionRuntimePanel">
              <div className="actionRegistryHead">
                <div>
                  <span>{t('action.runtimeDescription')}</span>
                  <strong>{t('action.runtime')}</strong>
                </div>
                <em>{t('panel.queue', {count: queue?.maxConcurrent ?? 0})}</em>
              </div>
              <div className="actionRuntimeColumns">
                <div>
                  <h3>{t('action.activeRuns')}</h3>
                  <ActionRunRows runs={activeRuns} t={t} onCancel={onCancel} />
                </div>
                <div>
                  <h3>{t('panel.recentRuns')}</h3>
                  <ActionRunRows runs={runs.slice(0, 10)} t={t} />
                </div>
              </div>
            </section>
            <aside className="actionInspector">
              {draft ? (
                <>
                  <div className="inspectorTabs">
                    <button
                      className={inspectorMode === 'config' ? 'active' : ''}
                      onClick={() => setInspectorMode('config')}
                    >
                      <Settings2 size={15} />
                      {t('action.configuration')}
                    </button>
                    <button
                      className={inspectorMode === 'trial' ? 'active' : ''}
                      onClick={() => setInspectorMode('trial')}
                    >
                      <TestTube2 size={15} />
                      {t('action.trial')}
                    </button>
                  </div>
                  {inspectorMode === 'config' ? (
                    <ActionEditor
                      draft={draft}
                      templates={templates}
                      t={t}
                      error={saveError}
                      onChange={setDraft}
                      onSave={() => void saveDraft()}
                    />
                  ) : (
                    <ActionTrial
                      action={selectedAction}
                      activeRuns={selectedActiveRuns}
                      runs={selectedRuns}
                      error={runError}
                      running={runningTrial}
                      t={t}
                      onRun={() => void runTrial()}
                      onCancel={onCancel}
                    />
                  )}
                </>
              ) : (
                <div className="inspectorEmpty">
                  <Play size={22} />
                  <span>{t('action.selectToInspect')}</span>
                </div>
              )}
            </aside>
          </section>
        </div>
      )}
    </section>
  );
}

function ActionEditor({
  draft,
  templates,
  t,
  error,
  onChange,
  onSave,
}: {
  draft: ActionDraft;
  templates: MessageTemplateSummary[];
  t: Translator;
  error: string | null;
  onChange: (draft: ActionDraft) => void;
  onSave: () => void;
}) {
  const update = (patch: Partial<ActionDraft>) =>
    onChange({...draft, ...patch});
  const selectedTemplate = templates.find(
    template => template.name === draft.template,
  );
  const updateTemplateValue = (pathValue: string, value: string) =>
    update({
      templateValues: {
        ...draft.templateValues,
        [pathValue]: value,
      },
    });
  return (
    <section className="actionEditor">
      <div className="modalHead">
        <div>
          <span>{t('action.configuration')}</span>
          <h2>{draft.id}</h2>
        </div>
      </div>
      <div className="formGrid">
        {error && <div className="formError wideLabel">{error}</div>}
        <label className="wideLabel">
          <span>{t('field.type')}</span>
          <select
            value={draft.type}
            onChange={event => update({type: event.target.value as ActionKind})}
          >
            <option value="send_http">{t('action.sendHttp')}</option>
            <option value="send_ws">{t('action.sendWs')}</option>
            <option value="command">{t('action.command')}</option>
          </select>
        </label>
        <label className="wideLabel">
          <span>{t('field.id')}</span>
          <input
            value={draft.id}
            onChange={event => update({id: event.target.value})}
          />
        </label>
        <label className="wideLabel">
          <span>{t('field.description')}</span>
          <input
            value={draft.description}
            onChange={event => update({description: event.target.value})}
          />
        </label>
        {draft.type === 'send_http' && (
          <>
            <label>
              <span>{t('action.httpMethod')}</span>
              <select
                value={draft.method}
                onChange={event =>
                  update({method: event.target.value as ActionDraft['method']})
                }
              >
                {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(method => (
                  <option value={method} key={method}>
                    {method}
                  </option>
                ))}
              </select>
            </label>
            <label className="wideLabel">
              <span>{t('field.url')}</span>
              <input
                value={draft.url}
                onChange={event => update({url: event.target.value})}
              />
            </label>
            <label className="wideLabel">
              <span>{t('field.headers')}</span>
              <textarea
                className="formTextarea actionJsonEditor"
                value={draft.headersText}
                onChange={event => update({headersText: event.target.value})}
                spellCheck={false}
              />
            </label>
            <label className="wideLabel">
              <span>{t('field.messageTemplate')}</span>
              <select
                value={draft.template}
                onChange={event =>
                  update({template: event.target.value, templateValues: {}})
                }
              >
                <option value="">{t('common.noTemplate')}</option>
                {templates
                  .filter(template => template.capabilities.send)
                  .map(template => (
                    <option value={template.name} key={template.name}>
                      {template.displayName}
                    </option>
                  ))}
              </select>
            </label>
            {selectedTemplate ? (
              <fieldset className="templateFieldGrid wideLabel">
                <legend>{t('action.templateFields')}</legend>
                <p className="templateFieldHint">
                  {t('action.templateOptionalHint')}
                </p>
                {selectedTemplate.fields
                  .filter(field => field.roles.send)
                  .map(field => (
                    <label key={field.key} title={field.description}>
                      <span>
                        {field.label}
                        {field.required ? ' *' : ''}
                      </span>
                      <TemplateFieldControl
                        field={field}
                        value={draft.templateValues[field.path] ?? ''}
                        onChange={value =>
                          updateTemplateValue(field.path, value)
                        }
                      />
                      <small>{templateFieldConstraint(field)}</small>
                    </label>
                  ))}
              </fieldset>
            ) : (
              <label className="wideLabel">
                <span>{t('action.body')}</span>
                <textarea
                  className="formTextarea actionJsonEditor"
                  value={draft.bodyText}
                  onChange={event => update({bodyText: event.target.value})}
                  spellCheck={false}
                />
              </label>
            )}
          </>
        )}
        {draft.type === 'send_ws' && (
          <>
            <label className="wideLabel">
              <span>{t('action.wsTarget')}</span>
              <input
                value={draft.target}
                onChange={event => update({target: event.target.value})}
              />
            </label>
            <label className="wideLabel">
              <span>{t('action.body')}</span>
              <textarea
                className="formTextarea actionJsonEditor"
                value={draft.bodyText}
                onChange={event => update({bodyText: event.target.value})}
                spellCheck={false}
              />
            </label>
          </>
        )}
        {draft.type === 'command' && (
          <>
            <div className="actionSecurityNotice wideLabel">
              <Terminal size={17} />
              <span>{t('action.commandSecurity')}</span>
            </div>
            <label className="wideLabel">
              <span>{t('action.cwd')}</span>
              <input
                value={draft.cwd}
                onChange={event => update({cwd: event.target.value})}
              />
            </label>
            <label className="wideLabel">
              <span>{t('action.commandExecutable')}</span>
              <input
                value={draft.command}
                onChange={event => update({command: event.target.value})}
              />
            </label>
            <label className="wideLabel">
              <span>{t('action.arguments')}</span>
              <textarea
                className="formTextarea actionJsonEditor"
                value={draft.argsText}
                onChange={event => update({argsText: event.target.value})}
                spellCheck={false}
              />
            </label>
            <label>
              <span>{t('action.timeout')}</span>
              <input
                type="number"
                min={1}
                value={draft.timeoutMs}
                onChange={event => update({timeoutMs: event.target.value})}
              />
            </label>
            <label className="checkLabel">
              <input
                type="checkbox"
                checked={draft.allowConcurrent}
                onChange={event =>
                  update({allowConcurrent: event.target.checked})
                }
              />
              <span>{t('action.allowConcurrent')}</span>
            </label>
          </>
        )}
      </div>
      <div className="modalActions">
        <button className="primaryButton" onClick={onSave}>
          <Save size={15} />
          {t('common.save')}
        </button>
      </div>
    </section>
  );
}

function ActionTrial({
  action,
  activeRuns,
  runs,
  error,
  running,
  t,
  onRun,
  onCancel,
}: {
  action?: AppAction;
  activeRuns: RunRow[];
  runs: RunRow[];
  error: string | null;
  running: boolean;
  t: Translator;
  onRun: () => void;
  onCancel: (id: string) => void;
}) {
  return (
    <section className="actionTrial">
      <div className="modalHead">
        <div>
          <span>{t('action.trial')}</span>
          <h2>{action?.id ?? t('action.unsaved')}</h2>
        </div>
      </div>
      <div className="actionTrialBody">
        {action ? (
          <>
            <div className="actionTrialSummary">
              <div>
                <span>{t('field.type')}</span>
                <strong>{actionTypeLabel(action.type, t)}</strong>
              </div>
              <div>
                <span>{t('action.target')}</span>
                <code>{actionTargetSummary(action)}</code>
              </div>
            </div>
            {action.type === 'command' && (
              <div className="actionSecurityNotice">
                <Terminal size={17} />
                <span>{t('action.commandTrialWarning')}</span>
              </div>
            )}
            {error && <div className="formError">{error}</div>}
            <div className="actionTrialRuns">
              <h3>{t('action.activeRuns')}</h3>
              <ActionRunRows runs={activeRuns} t={t} onCancel={onCancel} />
            </div>
            <div className="actionTrialRuns">
              <h3>{t('action.selectedHistory')}</h3>
              <ActionRunRows runs={runs} t={t} />
            </div>
          </>
        ) : (
          <div className="inspectorEmpty">{t('action.saveBeforeTrial')}</div>
        )}
      </div>
      <div className="modalActions">
        <button
          className="primaryButton"
          disabled={!action || running}
          onClick={onRun}
        >
          <Play size={15} />
          {t('action.runConfigured')}
        </button>
      </div>
    </section>
  );
}

function ActionRunRows({
  runs,
  t,
  onCancel,
}: {
  runs: RunRow[];
  t: Translator;
  onCancel?: (id: string) => void;
}) {
  return (
    <div className="actionList">
      {runs.length === 0 && <div className="empty">{t('common.noQueue')}</div>}
      {runs.map(run => (
        <details className={`actionCard ${run.status}`} key={run.id}>
          <summary>
            <div>
              <strong>{run.actionId}</strong>
              <span>
                {t(`run.${run.status}`)}
                {run.durationMs ? ` / ${run.durationMs}ms` : ''}
              </span>
            </div>
            {onCancel ? (
              <button
                onClick={event => {
                  event.preventDefault();
                  onCancel(run.id);
                }}
                title={`${t('common.cancel')} ${run.actionId}`}
              >
                <XCircle size={16} />
              </button>
            ) : (
              <code>
                {run.ok === false ? t('common.failed') : t('common.ok')}
              </code>
            )}
          </summary>
          {(run.output || run.error) && <pre>{run.output ?? run.error}</pre>}
        </details>
      ))}
    </div>
  );
}

function createActionDraft(action: AppAction, index: number): ActionDraft {
  return {
    index,
    id: action.id,
    type: action.type,
    description: action.description ?? '',
    cwd: action.type === 'command' ? action.cwd : '',
    command: action.type === 'command' ? action.command : '',
    argsText:
      action.type === 'command'
        ? JSON.stringify(action.args ?? [], null, 2)
        : '[]',
    timeoutMs:
      action.type === 'command' ? String(action.timeoutMs ?? 30000) : '30000',
    allowConcurrent:
      action.type === 'command' ? (action.allowConcurrent ?? false) : false,
    method: action.type === 'send_http' ? action.method : 'POST',
    url: action.type === 'send_http' ? action.url : '',
    headersText:
      action.type === 'send_http'
        ? JSON.stringify(action.headers ?? {}, null, 2)
        : '{}',
    bodyText:
      action.type === 'command'
        ? '{}'
        : JSON.stringify(action.body ?? {}, null, 2),
    template: action.type === 'send_http' ? (action.template ?? '') : '',
    templateValues:
      action.type === 'send_http'
        ? stringifyTemplateValues(action.templateValues ?? {})
        : {},
    target: action.type === 'send_ws' ? action.target : '',
  };
}

function createNewActionDraft(
  kind: ActionKind,
  actions: AppAction[],
): ActionDraft {
  const prefixes: Record<ActionKind, string> = {
    command: 'command',
    send_http: 'send-http',
    send_ws: 'send-ws',
  };
  const ids = new Set(actions.map(action => action.id));
  let index = 1;
  while (ids.has(`${prefixes[kind]}-${index}`)) index += 1;
  return {
    index: -1,
    id: `${prefixes[kind]}-${index}`,
    type: kind,
    description: '',
    cwd: '',
    command: '',
    argsText: '[]',
    timeoutMs: '30000',
    allowConcurrent: false,
    method: 'POST',
    url: '',
    headersText: '{}',
    bodyText: '{}',
    template: '',
    templateValues: {},
    target: '',
  };
}

function actionFromDraft(draft: ActionDraft): AppAction {
  const base = {
    id: draft.id.trim(),
    description: emptyToUndefined(draft.description),
  };
  if (draft.type === 'command') {
    const args = JSON.parse(draft.argsText || '[]') as unknown;
    if (!Array.isArray(args) || args.some(value => typeof value !== 'string')) {
      throw new Error('Command arguments must be a JSON string array.');
    }
    return {
      ...base,
      type: 'command',
      cwd: draft.cwd.trim(),
      command: draft.command.trim(),
      args,
      timeoutMs: Number(draft.timeoutMs),
      allowConcurrent: draft.allowConcurrent,
    };
  }
  if (draft.type === 'send_http') {
    return {
      ...base,
      type: 'send_http',
      method: draft.method,
      url: draft.url.trim(),
      headers: parseHeaders(draft.headersText),
      ...(draft.template
        ? {
            template: draft.template,
            templateValues: cleanTemplateValues(draft.templateValues),
          }
        : {body: parseOptionalJson(draft.bodyText)}),
    };
  }
  return {
    ...base,
    type: 'send_ws',
    target: draft.target.trim(),
    body: parseOptionalJson(draft.bodyText),
  };
}

function stringifyTemplateValues(
  values: Record<string, unknown>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      typeof value === 'string' ? value : JSON.stringify(value),
    ]),
  );
}

function TemplateFieldControl({
  field,
  value,
  onChange,
}: {
  field: MessageTemplateField;
  value: string;
  onChange: (value: string) => void;
}) {
  const choices =
    field.constValue !== undefined
      ? [field.constValue]
      : (field.allowedValues ??
        (field.valueType === 'boolean' ? [true, false] : undefined));
  if (choices) {
    return (
      <select value={value} onChange={event => onChange(event.target.value)}>
        <option value="">{templateFieldPlaceholder(field)}</option>
        {choices.map(choice => {
          const serialized = stringifyTemplateInputValue(choice);
          return (
            <option value={serialized} key={serialized}>
              {serialized}
            </option>
          );
        })}
      </select>
    );
  }
  if (
    field.input?.control === 'textarea' ||
    field.input?.control === 'json' ||
    field.valueType === 'object' ||
    field.valueType === 'array'
  ) {
    return (
      <textarea
        className="formTextarea templateValueEditor"
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={templateFieldPlaceholder(field)}
        spellCheck={false}
      />
    );
  }
  return (
    <input
      type={
        field.valueType === 'number' || field.valueType === 'integer'
          ? 'number'
          : 'text'
      }
      min={field.minimum}
      max={field.maximum}
      step={field.valueType === 'integer' ? 1 : undefined}
      value={value}
      onChange={event => onChange(event.target.value)}
      placeholder={templateFieldPlaceholder(field)}
    />
  );
}

function stringifyTemplateInputValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function templateFieldPlaceholder(field: {
  path: string;
  defaultValue?: unknown;
  input?: {placeholder?: string};
}): string {
  if (field.input?.placeholder) return field.input.placeholder;
  if (field.defaultValue === undefined) return field.path;
  const value = stringifyTemplateInputValue(field.defaultValue);
  return `${field.path} (${value})`;
}

function templateFieldConstraint(field: MessageTemplateField): string {
  const parts: string[] = [field.valueType];
  if (field.allowedValues)
    parts.push(
      field.allowedValues.map(stringifyTemplateInputValue).join(' | '),
    );
  if (field.constValue !== undefined)
    parts.push(`= ${stringifyTemplateInputValue(field.constValue)}`);
  if (field.format) parts.push(field.format);
  if (field.pattern) parts.push(`/${field.pattern}/`);
  if (field.minimum !== undefined || field.maximum !== undefined)
    parts.push(`${field.minimum ?? '-∞'}..${field.maximum ?? '∞'}`);
  if (field.minLength !== undefined || field.maxLength !== undefined)
    parts.push(`len ${field.minLength ?? 0}..${field.maxLength ?? '∞'}`);
  if (field.minItems !== undefined || field.maxItems !== undefined)
    parts.push(`items ${field.minItems ?? 0}..${field.maxItems ?? '∞'}`);
  return parts.join(' · ');
}

function cleanTemplateValues(
  values: Record<string, string>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values)
      .filter(([, value]) => value.trim() !== '')
      .map(([key, value]) => [key, parseTemplateFormValue(value)]),
  );
}

function cleanSelectedTemplateValues(
  values: Record<string, string>,
  selectedPaths: string[],
): Record<string, unknown> | undefined {
  const selected = new Set(selectedPaths);
  const cleaned = Object.fromEntries(
    Object.entries(cleanTemplateValues(values)).filter(([pathValue]) =>
      selected.has(pathValue),
    ),
  );
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}

function parseTemplateFormValue(value: string): unknown {
  const trimmed = value.trim();
  if (
    trimmed === 'true' ||
    trimmed === 'false' ||
    trimmed === 'null' ||
    trimmed.startsWith('{') ||
    trimmed.startsWith('[') ||
    trimmed.startsWith('"')
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return value;
    }
  }
  return value;
}

function parseOptionalJson(value: string): unknown {
  return value.trim() ? JSON.parse(value) : undefined;
}

function actionTargetSummary(action: AppAction): string {
  if (action.type === 'command')
    return `${action.command} ${action.args?.join(' ') ?? ''}`.trim();
  if (action.type === 'send_http') return `${action.method} ${action.url}`;
  return action.target;
}

function actionTypeLabel(type: ActionKind, t: Translator): string {
  if (type === 'command') return t('action.command');
  if (type === 'send_http') return t('action.sendHttp');
  return t('action.sendWs');
}

function RulesPanel({
  raw,
  rules,
  actions,
  templates,
  t,
  onSaveRules,
  onSave,
  onTest,
}: {
  raw: string;
  rules: AppConfig['rules'];
  actions: AppConfig['actions'];
  templates: MessageTemplateSummary[];
  t: Translator;
  onSaveRules: (rules: AppConfig['rules'], id: string) => Promise<void>;
  onSave: (content: string) => Promise<void>;
  onTest: (eventText: string) => Promise<RuleTestResult>;
}) {
  const [viewMode, setViewMode] = React.useState<EndpointViewMode>('graph');
  const [query, setQuery] = React.useState('');
  const [statusFilter, setStatusFilter] =
    React.useState<RuleStatusFilter>('all');
  const [draft, setDraft] = React.useState<RuleDraft | null>(() =>
    rules[0] ? createRuleDraft(rules[0], 0, templates) : null,
  );
  const [inspectorMode, setInspectorMode] =
    React.useState<RuleInspectorMode>('config');
  const [eventText, setEventText] = React.useState(
    JSON.stringify(
      {
        source: 'http.server.local-http',
        kind: 'http.request',
        body: {command: 'hello'},
        meta: {path: '/ingest', method: 'POST'},
      },
      null,
      2,
    ),
  );
  const [result, setResult] = React.useState<RuleTestResult | null>(null);
  const [testError, setTestError] = React.useState<string | null>(null);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const filteredRules = rules.filter(
    rule =>
      (statusFilter === 'all' ||
        (statusFilter === 'enabled' ? rule.enabled : !rule.enabled)) &&
      `${rule.id} ${rule.description ?? ''} ${rule.when.source ?? ''} ${rule.then.map(step => step.action).join(' ')}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  const selectedRule =
    draft?.index === -1 ? undefined : rules[draft?.index ?? -1];
  const selectedTest = result?.matches.find(
    match => match.ruleId === draft?.id,
  );

  React.useEffect(() => {
    if (!draft && rules[0]) setDraft(createRuleDraft(rules[0], 0, templates));
  }, [rules, templates]);

  async function saveDraft() {
    if (!draft) return;
    setSaveError(null);
    try {
      const next = structuredClone(rules);
      const rule = ruleFromDraft(draft);
      if (draft.index < 0) next.push(rule);
      else next[draft.index] = rule;
      await onSaveRules(next, rule.id);
      setDraft(
        createRuleDraft(
          rule,
          next.findIndex(item => item.id === rule.id),
          templates,
        ),
      );
    } catch (error) {
      setSaveError(errorMessage(error));
    }
  }

  async function runTest() {
    setTestError(null);
    try {
      setResult(await onTest(eventText));
    } catch (error) {
      setTestError(errorMessage(error));
    }
  }

  async function deleteRule(rule: AppConfig['rules'][number], index: number) {
    if (!window.confirm(t('common.confirmDelete', {id: rule.id}))) return;
    const next = rules.filter((_, itemIndex) => itemIndex !== index);
    setDraft(null);
    await onSaveRules(next, rule.id);
  }

  return (
    <section className="ruleWorkspace">
      <div className="workspaceToolbar">
        <div className="endpointViewSwitch">
          <button
            className={viewMode === 'graph' ? 'active' : ''}
            onClick={() => setViewMode('graph')}
          >
            <GitBranch size={15} />
            {t('rule.management')}
          </button>
          <button
            className={viewMode === 'config' ? 'active' : ''}
            onClick={() => setViewMode('config')}
          >
            <Settings2 size={15} />
            {t('common.configView')}
          </button>
        </div>
        {viewMode === 'graph' && (
          <div className="ruleToolbarActions">
            <select
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
                placeholder={t('rule.search')}
              />
            </label>
            <button
              onClick={() => {
                setDraft(createNewRuleDraft(rules));
                setInspectorMode('config');
              }}
            >
              <Plus size={16} />
              {t('rule.create')}
            </button>
          </div>
        )}
      </div>
      {viewMode === 'config' ? (
        <YamlEditor name="rules" value={raw} t={t} onSave={onSave} />
      ) : (
        <div className="ruleWorkbench">
          <section className="ruleCenter">
            <div className="ruleRegistry">
              <div className="ruleRegistryHead">
                <div>
                  <span>{t('rule.registryDescription')}</span>
                  <strong>{t('rule.registry')}</strong>
                </div>
                <div>
                  <span>
                    <strong>
                      {filteredRules.length}/{rules.length}
                    </strong>
                    {t('rule.visible')}
                  </span>
                  <span>
                    <strong>{rules.filter(rule => rule.enabled).length}</strong>
                    {t('rule.active')}
                  </span>
                </div>
              </div>
              <div className="ruleTableHead">
                <span>{t('field.id')}</span>
                <span>{t('rule.triggerSource')}</span>
                <span>{t('rule.condition')}</span>
                <span>{t('rule.actions')}</span>
                <span />
              </div>
              {filteredRules.map(rule => {
                const index = rules.indexOf(rule);
                return (
                  <div
                    role="button"
                    tabIndex={0}
                    className={`ruleRow${draft?.index === index ? ' selected' : ''}${rule.enabled ? '' : ' disabled'}`}
                    key={rule.id}
                    onClick={() =>
                      setDraft(createRuleDraft(rule, index, templates))
                    }
                    onKeyDown={event => {
                      if (event.key === 'Enter' || event.key === ' ')
                        setDraft(createRuleDraft(rule, index, templates));
                    }}
                  >
                    <span>
                      <i className={rule.enabled ? 'online' : ''} />
                      <strong>{rule.id}</strong>
                      <small
                        className={
                          rule.enabled
                            ? 'statusBadge enabled'
                            : 'statusBadge disabled'
                        }
                      >
                        {rule.enabled
                          ? t('common.enabled')
                          : t('common.disabled')}
                      </small>
                    </span>
                    <code>
                      {rule.when.anySource
                        ? t('rule.anySource')
                        : (rule.when.source ?? t('rule.anySource'))}
                    </code>
                    <span>{ruleConditionSummary(rule, t)}</span>
                    <em>
                      {rule.then.map(step => step.action).join(', ') ||
                        t('rule.noActions')}
                    </em>
                    <span className="rowActions">
                      <button
                        className="dangerIconButton"
                        onClick={event => {
                          event.stopPropagation();
                          void deleteRule(rule, index);
                        }}
                        title={`${t('common.delete')} ${rule.id}`}
                      >
                        <Trash2 size={15} />
                      </button>
                    </span>
                  </div>
                );
              })}
              {filteredRules.length === 0 && (
                <div className="connectionEmpty">{t('rule.noMatches')}</div>
              )}
            </div>
          </section>
          <aside className="ruleInspector">
            {draft ? (
              <>
                <div className="inspectorTabs">
                  <button
                    className={inspectorMode === 'config' ? 'active' : ''}
                    onClick={() => setInspectorMode('config')}
                  >
                    <Settings2 size={15} />
                    {t('rule.configuration')}
                  </button>
                  <button
                    className={inspectorMode === 'test' ? 'active' : ''}
                    onClick={() => setInspectorMode('test')}
                  >
                    <TestTube2 size={15} />
                    {t('rule.simulation')}
                  </button>
                </div>
                {inspectorMode === 'config' ? (
                  <RuleEditor
                    draft={draft}
                    actions={actions}
                    templates={templates}
                    t={t}
                    error={saveError}
                    onChange={setDraft}
                    onSave={() => void saveDraft()}
                  />
                ) : (
                  <RuleSimulator
                    eventText={eventText}
                    selectedTest={selectedTest}
                    error={testError}
                    t={t}
                    onChange={setEventText}
                    onTest={() => void runTest()}
                  />
                )}
              </>
            ) : (
              <div className="inspectorEmpty">
                <GitBranch size={22} />
                <span>{t('rule.selectToInspect')}</span>
              </div>
            )}
          </aside>
          <RuleFlow
            rule={selectedRule ?? (draft ? ruleFromDraft(draft) : undefined)}
            t={t}
          />
        </div>
      )}
    </section>
  );
}

function RuleFlow({
  rule,
  t,
}: {
  rule?: AppConfig['rules'][number];
  t: Translator;
}) {
  return (
    <section className="ruleFlowPanel">
      <div className="ruleFlowHead">
        <div>
          <span>{t('rule.flowDescription')}</span>
          <strong>{t('rule.executionFlow')}</strong>
        </div>
        <em>{rule?.id ?? t('rule.selectToInspect')}</em>
      </div>
      {rule ? (
        <div className="ruleFlow">
          <div>
            <CircleDot size={18} />
            <span>{t('rule.triggerSource')}</span>
            <strong>
              {rule.when.anySource
                ? t('rule.anySource')
                : (rule.when.source ?? t('rule.anySource'))}
            </strong>
          </div>
          <GitBranch size={18} />
          <div>
            <GitBranch size={18} />
            <span>{t('rule.condition')}</span>
            <strong>{ruleConditionSummary(rule, t)}</strong>
          </div>
          <GitBranch size={18} />
          <div>
            <Play size={18} />
            <span>{t('rule.actions')}</span>
            <strong>
              {rule.then.map(step => step.action).join(', ') ||
                t('rule.noActions')}
            </strong>
          </div>
        </div>
      ) : (
        <div className="connectionEmpty">{t('rule.selectToInspect')}</div>
      )}
    </section>
  );
}

function RuleEditor({
  draft,
  actions,
  templates,
  t,
  error,
  onChange,
  onSave,
}: {
  draft: RuleDraft;
  actions: AppConfig['actions'];
  templates: MessageTemplateSummary[];
  t: Translator;
  error: string | null;
  onChange: (draft: RuleDraft) => void;
  onSave: () => void;
}) {
  const update = (patch: Partial<RuleDraft>) => onChange({...draft, ...patch});
  const selectedTemplate = templates.find(
    template => template.name === draft.template,
  );
  const matchFields =
    selectedTemplate?.fields.filter(field => field.roles.match) ?? [];
  const updateTemplateCondition = (
    conditionId: string,
    patch: Partial<TemplateConditionDraft>,
  ) =>
    update({
      templateConditions: draft.templateConditions.map(condition =>
        condition.id === conditionId ? {...condition, ...patch} : condition,
      ),
    });
  const addTemplateCondition = () => {
    const firstField = matchFields[0];
    if (!firstField) return;
    update({
      templateConditions: [
        ...draft.templateConditions,
        {
          id: `template-condition-${Date.now()}`,
          label: firstField.label,
          path: templateFieldValuePath(firstField.key),
          operator: 'equals',
          value: '',
        },
      ],
    });
  };
  return (
    <section className="ruleEditor">
      <div className="modalHead">
        <div>
          <span>{t('rule.configuration')}</span>
          <h2>{draft.id}</h2>
        </div>
      </div>
      <div className="formGrid ruleConfigGrid">
        {error && <div className="formError wideLabel">{error}</div>}
        <label>
          <span>{t('field.id')}</span>
          <input
            value={draft.id}
            onChange={event => update({id: event.target.value})}
          />
        </label>
        <div className="ruleToggleRow">
          <label className="checkLabel">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={event => update({enabled: event.target.checked})}
            />
            <span>{t('field.enabled')}</span>
          </label>
          <label className="checkLabel">
            <input
              type="checkbox"
              checked={draft.anySource}
              onChange={event => update({anySource: event.target.checked})}
            />
            <span>{t('rule.anySource')}</span>
          </label>
        </div>
        <label className="wideLabel">
          <span>{t('field.description')}</span>
          <input
            value={draft.description}
            onChange={event => update({description: event.target.value})}
          />
        </label>
        {!draft.anySource && (
          <label>
            <span>{t('rule.triggerSource')}</span>
            <input
              value={draft.source}
              onChange={event => update({source: event.target.value})}
            />
          </label>
        )}
        <label>
          <span>{t('rule.eventKind')}</span>
          <select
            value={draft.kind}
            onChange={event => update({kind: event.target.value})}
          >
            <option value="">{t('rule.anyKind')}</option>
            {[
              'http.request',
              'http.response',
              'ws.message',
              'action.result',
            ].map(kind => (
              <option value={kind} key={kind}>
                {kind}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{t('rule.operator')}</span>
          <select
            value={draft.operator}
            onChange={event =>
              update({operator: event.target.value as RuleDraft['operator']})
            }
          >
            <option value="none">{t('rule.noCondition')}</option>
            <option value="equals">{t('rule.equals')}</option>
            <option value="contains">{t('rule.contains')}</option>
            <option value="regex">{t('rule.regex')}</option>
          </select>
        </label>
        {draft.operator !== 'none' && (
          <>
            <label>
              <span>JSONPath</span>
              <input
                value={draft.jsonPath}
                onChange={event => update({jsonPath: event.target.value})}
                placeholder="$.body.command"
              />
            </label>
            <label>
              <span>{t('rule.expectedValue')}</span>
              <input
                value={draft.matchValue}
                onChange={event => update({matchValue: event.target.value})}
              />
            </label>
          </>
        )}
        <fieldset className="templateConditionPanel wideLabel">
          <legend>{t('rule.templateMatching')}</legend>
          <label>
            <span>{t('field.messageTemplate')}</span>
            <select
              value={draft.template}
              onChange={event =>
                update({template: event.target.value, templateConditions: []})
              }
            >
              <option value="">{t('common.noTemplate')}</option>
              {templates
                .filter(template => template.capabilities.match)
                .map(template => (
                  <option value={template.name} key={template.name}>
                    {template.displayName}
                  </option>
                ))}
            </select>
          </label>
          {selectedTemplate && (
            <>
              <div className="templateConditionList">
                {draft.templateConditions.map(condition => (
                  <div className="templateConditionRow" key={condition.id}>
                    <select
                      value={condition.path}
                      onChange={event => {
                        const item = matchFields.find(
                          field =>
                            templateFieldValuePath(field.key) ===
                            event.target.value,
                        );
                        updateTemplateCondition(condition.id, {
                          label: item?.label ?? event.target.value,
                          path: event.target.value,
                        });
                      }}
                    >
                      {matchFields.map(item => (
                        <option
                          value={templateFieldValuePath(item.key)}
                          key={item.key}
                        >
                          {item.label} · {item.valueType}
                        </option>
                      ))}
                    </select>
                    <select
                      value={condition.operator}
                      onChange={event =>
                        updateTemplateCondition(condition.id, {
                          operator: event.target
                            .value as TemplateConditionDraft['operator'],
                        })
                      }
                    >
                      <option value="equals">{t('rule.equals')}</option>
                      <option value="contains">{t('rule.contains')}</option>
                      <option value="regex">{t('rule.regex')}</option>
                    </select>
                    <input
                      value={condition.value}
                      onChange={event =>
                        updateTemplateCondition(condition.id, {
                          value: event.target.value,
                        })
                      }
                      placeholder={t('rule.expectedValue')}
                    />
                    <button
                      className="dangerIconButton"
                      onClick={() =>
                        update({
                          templateConditions: draft.templateConditions.filter(
                            item => item.id !== condition.id,
                          ),
                        })
                      }
                      title={t('common.delete')}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
              <button type="button" onClick={addTemplateCondition}>
                <Plus size={15} />
                {t('rule.addTemplateCondition')}
              </button>
            </>
          )}
        </fieldset>
        <fieldset className="ruleActionPicker">
          <legend>{t('rule.actions')}</legend>
          {actions.map(action => (
            <label key={action.id}>
              <input
                type="checkbox"
                checked={draft.actions.includes(action.id)}
                onChange={event =>
                  update({
                    actions: event.target.checked
                      ? [...draft.actions, action.id]
                      : draft.actions.filter(id => id !== action.id),
                  })
                }
              />
              <span>
                <strong>{action.id}</strong>
                <small>{action.type}</small>
              </span>
            </label>
          ))}
        </fieldset>
      </div>
      <div className="modalActions">
        <button className="primaryButton" onClick={onSave}>
          <Save size={15} />
          {t('common.save')}
        </button>
      </div>
    </section>
  );
}

function RuleSimulator({
  eventText,
  selectedTest,
  error,
  t,
  onChange,
  onTest,
}: {
  eventText: string;
  selectedTest?: RuleTestResult['matches'][number];
  error: string | null;
  t: Translator;
  onChange: (value: string) => void;
  onTest: () => void;
}) {
  return (
    <section className="ruleSimulator">
      <div className="modalHead">
        <div>
          <span>{t('rule.simulation')}</span>
          <h2>{t('panel.ruleTester')}</h2>
        </div>
      </div>
      <div className="ruleSimulatorBody">
        <label>
          <span>{t('rule.testEvent')}</span>
          <textarea
            className="ruleEventEditor"
            value={eventText}
            onChange={event => onChange(event.target.value)}
            spellCheck={false}
          />
        </label>
        {error && <div className="formError">{error}</div>}
        {selectedTest && (
          <div
            className={
              selectedTest.matched
                ? 'ruleTestSummary matched'
                : 'ruleTestSummary'
            }
          >
            <strong>
              {selectedTest.matched ? t('rule.matched') : t('rule.missed')}
            </strong>
            <span>
              {selectedTest.actions.join(', ') || t('rule.noActions')}
            </span>
          </div>
        )}
        <div className="ruleChecks">
          {(selectedTest?.checks ?? []).map((check, index) => (
            <div
              className={check.matched ? 'matched' : 'failed'}
              key={`${check.field}-${index}`}
            >
              <span>{t(`rule.check.${check.field}`)}</span>
              <strong>
                {check.matched ? t('rule.matched') : t('rule.missed')}
              </strong>
              <small>{formatRuleCheck(check)}</small>
            </div>
          ))}
        </div>
      </div>
      <div className="modalActions">
        <button className="primaryButton" onClick={onTest}>
          <TestTube2 size={15} />
          {t('common.test')}
        </button>
      </div>
    </section>
  );
}

function createRuleDraft(
  rule: AppConfig['rules'][number],
  index: number,
  templates: MessageTemplateSummary[],
): RuleDraft {
  const match = rule.when.match;
  const allConditions = match?.all ?? [];
  const template = allConditions.find(isTemplateNameCondition)?.equals;
  const selectedTemplate =
    typeof template === 'string'
      ? templates.find(item => item.name === template)
      : undefined;
  const baseCondition =
    match && hasConditionOperator(match)
      ? match
      : allConditions.find(
          condition =>
            !isTemplateNameCondition(condition) &&
            !templateFieldDraftFromMatch(condition, 0, selectedTemplate),
        );
  const operator: RuleDraft['operator'] = baseCondition
    ? Object.hasOwn(baseCondition, 'equals')
      ? 'equals'
      : baseCondition.contains
        ? 'contains'
        : baseCondition.regex
          ? 'regex'
          : 'none'
    : 'none';
  const rawValue =
    operator === 'equals'
      ? baseCondition?.equals
      : operator === 'contains'
        ? baseCondition?.contains
        : operator === 'regex'
          ? baseCondition?.regex
          : '';
  return {
    index,
    id: rule.id,
    enabled: rule.enabled,
    description: rule.description ?? '',
    anySource: rule.when.anySource ?? !rule.when.source,
    source: rule.when.source ?? '',
    kind: rule.when.kind ?? '',
    operator,
    jsonPath: baseCondition?.jsonPath ?? '$.body',
    matchValue:
      operator === 'equals' ? JSON.stringify(rawValue) : String(rawValue ?? ''),
    template: typeof template === 'string' ? template : '',
    templateConditions: allConditions
      .map((condition, conditionIndex) =>
        templateFieldDraftFromMatch(
          condition,
          conditionIndex,
          selectedTemplate,
        ),
      )
      .filter((condition): condition is TemplateConditionDraft =>
        Boolean(condition),
      ),
    actions: rule.then.map(step => step.action),
  };
}

function createNewRuleDraft(rules: AppConfig['rules']): RuleDraft {
  let index = 1;
  const ids = new Set(rules.map(rule => rule.id));
  while (ids.has(`rule-${index}`)) index += 1;
  return {
    index: -1,
    id: `rule-${index}`,
    enabled: true,
    description: '',
    anySource: true,
    source: '',
    kind: '',
    operator: 'none',
    jsonPath: '$.body',
    matchValue: '',
    template: '',
    templateConditions: [],
    actions: [],
  };
}

function ruleFromDraft(draft: RuleDraft): AppConfig['rules'][number] {
  const baseCondition =
    draft.operator === 'none'
      ? undefined
      : {
          jsonPath: draft.jsonPath.trim() || undefined,
          ...(draft.operator === 'equals'
            ? {equals: parseRuleValue(draft.matchValue)}
            : {}),
          ...(draft.operator === 'contains'
            ? {contains: draft.matchValue}
            : {}),
          ...(draft.operator === 'regex' ? {regex: draft.matchValue} : {}),
        };
  const templateConditions: MatchCondition[] = [
    ...(draft.template
      ? [{jsonPath: '$.meta.decoded.template', equals: draft.template}]
      : []),
    ...draft.templateConditions.map((condition): MatchCondition => ({
      jsonPath: condition.path,
      ...(condition.operator === 'equals'
        ? {equals: parseRuleValue(condition.value)}
        : {}),
      ...(condition.operator === 'contains' ? {contains: condition.value} : {}),
      ...(condition.operator === 'regex' ? {regex: condition.value} : {}),
    })),
  ];
  const match =
    templateConditions.length > 0
      ? {
          all: [
            ...(baseCondition ? [baseCondition] : []),
            ...templateConditions,
          ],
        }
      : baseCondition;
  return {
    id: draft.id.trim(),
    enabled: draft.enabled,
    description: emptyToUndefined(draft.description),
    when: {
      ...(draft.anySource ? {anySource: true} : {source: draft.source.trim()}),
      ...(draft.kind
        ? {kind: draft.kind as AppConfig['rules'][number]['when']['kind']}
        : {}),
      ...(match ? {match} : {}),
    },
    then: draft.actions.map(action => ({action})),
  };
}

function parseRuleValue(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function ruleConditionSummary(
  rule: AppConfig['rules'][number],
  t: Translator,
): string {
  const match = rule.when.match;
  if (!match) return rule.when.kind ?? t('rule.noCondition');
  if (match.all?.length) {
    return match.all
      .map(condition => conditionSummary(condition, t))
      .join(' + ');
  }
  return conditionSummary(match, t);
}

function conditionSummary(match: MatchCondition, t: Translator): string {
  const templateLabel = templateFieldLabelFromPath(match.jsonPath);
  if (
    match.jsonPath === '$.meta.decoded.template' &&
    Object.hasOwn(match, 'equals')
  )
    return `${t('field.messageTemplate')} = ${String(match.equals)}`;
  const pathLabel = templateLabel
    ? `${t('rule.templateField')} ${templateLabel}`
    : (match.jsonPath ?? '$.body');
  if (Object.hasOwn(match, 'equals'))
    return `${pathLabel} = ${formatLogValue(match.equals)}`;
  if (match.contains)
    return `${pathLabel} ${t('rule.contains')} ${match.contains}`;
  if (match.regex) return `${pathLabel} /${match.regex}/`;
  return t('rule.noCondition');
}

function hasConditionOperator(condition: MatchCondition): boolean {
  return (
    Object.hasOwn(condition, 'equals') ||
    Boolean(condition.contains) ||
    Boolean(condition.regex)
  );
}

function isTemplateNameCondition(
  condition: MatchCondition,
): condition is MatchCondition & {equals: string} {
  return (
    condition.jsonPath === '$.meta.decoded.template' &&
    typeof condition.equals === 'string'
  );
}

function templateFieldValuePath(key: string): string {
  return `$.meta.decoded.values[${JSON.stringify(key)}]`;
}

function templateFieldLabelFromPath(pathValue?: string): string | null {
  if (!pathValue) return null;
  const key = templateFieldKeyFromPath(pathValue);
  if (key) return key;
  const match =
    /^\$\.meta\.decoded\.displayItems\[\?\(@\.label==(.+)\)\]\.value$/.exec(
      pathValue,
    );
  if (!match) return null;
  try {
    return JSON.parse(match[1]) as string;
  } catch {
    return null;
  }
}

function templateFieldKeyFromPath(pathValue?: string): string | null {
  if (!pathValue) return null;
  const match = /^\$\.meta\.decoded\.values\[(.+)\]$/.exec(pathValue);
  if (!match) return null;
  try {
    const key = JSON.parse(match[1]) as unknown;
    return typeof key === 'string' ? key : null;
  } catch {
    return null;
  }
}

function templateFieldIndexFromPath(pathValue?: string): number | null {
  if (!pathValue) return null;
  const match = /^\$\.meta\.decoded\.displayItems\[(\d+)\]\.value$/.exec(
    pathValue,
  );
  return match ? Number(match[1]) : null;
}

function templateFieldDraftFromMatch(
  condition: MatchCondition,
  index: number,
  template?: MessageTemplateSummary,
): TemplateConditionDraft | null {
  const fieldKey = templateFieldKeyFromPath(condition.jsonPath);
  const fieldIndex = templateFieldIndexFromPath(condition.jsonPath);
  const legacyLabel = templateFieldLabelFromPath(condition.jsonPath);
  const legacyFields = templateLegacyDisplayFields(template);
  const field = fieldKey
    ? template?.fields.find(item => item.key === fieldKey)
    : fieldIndex !== null
      ? legacyFields[fieldIndex]
      : template?.fields.find(item => item.label === legacyLabel);
  const label = field?.label ?? fieldKey ?? legacyLabel;
  if (!label) return null;
  const operator: TemplateConditionDraft['operator'] = Object.hasOwn(
    condition,
    'equals',
  )
    ? 'equals'
    : condition.contains
      ? 'contains'
      : 'regex';
  const rawValue =
    operator === 'equals'
      ? condition.equals
      : operator === 'contains'
        ? condition.contains
        : condition.regex;
  return {
    id: `template-condition-${index}`,
    label,
    path: field
      ? templateFieldValuePath(field.key)
      : (condition.jsonPath ?? '$.body'),
    operator,
    value:
      operator === 'equals' ? JSON.stringify(rawValue) : String(rawValue ?? ''),
  };
}

function templateLegacyDisplayFields(
  template?: MessageTemplateSummary,
): MessageTemplateField[] {
  return (template?.fields ?? [])
    .filter(field => field.roles.display)
    .sort(
      (left, right) =>
        (left.displayOrder ?? Number.MAX_SAFE_INTEGER) -
        (right.displayOrder ?? Number.MAX_SAFE_INTEGER),
    );
}

function formatRuleCheck(
  check: RuleTestResult['matches'][number]['checks'][number],
): string {
  const path = check.path ? `${check.path}: ` : '';
  return `${path}${formatLogValue(check.actual)} / ${formatLogValue(check.expected)}`;
}

function Logs({
  events,
  runs,
  t,
  onRefresh,
  onReplay,
}: {
  events: EventRow[];
  runs: RunRow[];
  t: Translator;
  onRefresh: () => void;
  onReplay: (id: string) => void;
}) {
  const [viewMode, setViewMode] = React.useState<LogViewMode>('entries');
  const [paused, setPaused] = React.useState(false);
  const [snapshot, setSnapshot] = React.useState({events, runs});
  const [category, setCategory] = React.useState('all');
  const [direction, setDirection] = React.useState('all');
  const [status, setStatus] = React.useState('all');
  const [query, setQuery] = React.useState('');
  const [selectedTraceId, setSelectedTraceId] = React.useState<string | null>(
    null,
  );

  React.useEffect(() => {
    if (!paused) setSnapshot({events, runs});
  }, [events, runs, paused]);

  const allItems = unifiedLogItems(snapshot.events, snapshot.runs);
  const filtered = allItems.filter(
    item =>
      (category === 'all' || item.category === category) &&
      (direction === 'all' || item.direction === direction) &&
      (status === 'all' || item.status === status) &&
      `${item.title} ${item.summary} ${item.source} ${item.traceId}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  const selectedTrace = selectedTraceId ?? filtered[0]?.traceId ?? null;
  const traceItems = selectedTrace
    ? allItems
        .filter(item => item.traceId === selectedTrace)
        .sort((a, b) => a.time.localeCompare(b.time))
    : [];

  function clearFilters() {
    setCategory('all');
    setDirection('all');
    setStatus('all');
    setQuery('');
  }

  return (
    <section className="logWorkspace">
      <div className="workspaceToolbar logToolbar">
        <div className="endpointViewSwitch">
          <button
            className={viewMode === 'entries' ? 'active' : ''}
            onClick={() => setViewMode('entries')}
          >
            <LayoutList size={15} />
            {t('logs.entries')}
          </button>
          <button
            className={viewMode === 'console' ? 'active' : ''}
            onClick={() => setViewMode('console')}
          >
            <Terminal size={15} />
            {t('logs.console')}
          </button>
        </div>
        <div className="logToolbarActions">
          <select
            value={category}
            onChange={event => setCategory(event.target.value)}
          >
            <option value="all">{t('logs.allCategories')}</option>
            <option value="event">{t('logs.messages')}</option>
            <option value="run">{t('logs.actions')}</option>
          </select>
          <select
            value={direction}
            onChange={event => setDirection(event.target.value)}
          >
            <option value="all">{t('logs.allDirections')}</option>
            <option value="inbound">{t('logs.inbound')}</option>
            <option value="outbound">{t('logs.outbound')}</option>
            <option value="local">{t('logs.local')}</option>
          </select>
          <select
            value={status}
            onChange={event => setStatus(event.target.value)}
          >
            <option value="all">{t('logs.allStatuses')}</option>
            <option value="ok">{t('common.ok')}</option>
            <option value="failed">{t('common.failed')}</option>
            <option value="active">{t('logs.active')}</option>
          </select>
          <label className="endpointSearch">
            <Search size={15} />
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder={t('logs.search')}
            />
          </label>
          <button
            onClick={() => setPaused(value => !value)}
            title={paused ? t('logs.resume') : t('logs.pause')}
          >
            {paused ? <Play size={16} /> : <Pause size={16} />}
          </button>
          <button onClick={onRefresh} title={t('common.refresh')}>
            <RefreshCw size={16} />
          </button>
          <button onClick={clearFilters} title={t('logs.clearFilters')}>
            <XCircle size={16} />
          </button>
        </div>
      </div>
      <div className="logWorkbench">
        <section className="logCenter">
          <div className="logSummary">
            <div>
              <span>{t('logs.centerDescription')}</span>
              <strong>{t('logs.center')}</strong>
            </div>
            <div>
              <span>
                <strong>{filtered.length}</strong>
                {t('logs.visible')}
              </span>
              <span>
                <strong>
                  {new Set(filtered.map(item => item.traceId)).size}
                </strong>
                {t('logs.traces')}
              </span>
              <em>{paused ? t('logs.paused') : t('logs.live')}</em>
            </div>
          </div>
          {viewMode === 'entries' ? (
            <div className="unifiedLogList">
              {filtered.map(item => (
                <details
                  className={`unifiedLogEntry ${item.status} ${item.traceId === selectedTrace ? 'selected' : ''}`}
                  key={`${item.category}-${item.id}`}
                  onClick={() => setSelectedTraceId(item.traceId)}
                >
                  <summary className="unifiedLogSummary">
                    <span className={`logDirection ${item.direction}`} />
                    <span className="unifiedLogPrimary">
                      <strong>{item.title}</strong>
                      <small>{item.summary}</small>
                    </span>
                    <span className="unifiedLogField">
                      <small>{t('field.source')}</small>
                      <code>{item.source}</code>
                    </span>
                    <span className="unifiedLogField">
                      <small>{t('field.time')}</small>
                      <em>{new Date(item.time).toLocaleTimeString()}</em>
                    </span>
                    <code className={`logDirectionBadge ${item.direction}`}>
                      {t(`logs.${item.direction}`)}
                    </code>
                    {item.category === 'event' && (
                      <button
                        className="logReplayButton"
                        onClick={event => {
                          event.preventDefault();
                          event.stopPropagation();
                          onReplay(item.id);
                        }}
                        title={t('common.replay')}
                      >
                        <RotateCcw size={14} />
                      </button>
                    )}
                  </summary>
                  <pre>{JSON.stringify(item.raw, null, 2)}</pre>
                </details>
              ))}
              {filtered.length === 0 && (
                <div className="connectionEmpty">{t('logs.noMatches')}</div>
              )}
            </div>
          ) : (
            <pre className="logConsole">
              {filtered.map(formatUnifiedConsoleLine).join('\n') ||
                t('logs.noMatches')}
            </pre>
          )}
        </section>
        <aside className="traceInspector">
          <div className="traceHead">
            <span>{t('logs.traceDescription')}</span>
            <strong>{t('logs.trace')}</strong>
            <code>
              {selectedTrace
                ? shortTrace(selectedTrace)
                : t('common.notAvailable')}
            </code>
          </div>
          <div className="traceTimeline">
            {traceSteps(traceItems, t).map((step, index) => (
              <div
                className={`traceStep ${step.status}`}
                key={`${step.time}-${index}`}
              >
                <i />
                <span>{new Date(step.time).toLocaleTimeString()}</span>
                <strong>{step.title}</strong>
                <small>{step.detail}</small>
              </div>
            ))}
            {traceItems.length === 0 && (
              <div className="inspectorEmpty">{t('logs.selectTrace')}</div>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}

function unifiedLogItems(events: EventRow[], runs: RunRow[]): UnifiedLogItem[] {
  return [
    ...events.map((event): UnifiedLogItem => ({
      id: event.id,
      traceId: event.traceId ?? event.id,
      time: event.time,
      category: 'event',
      direction: 'inbound',
      status: 'ok',
      title: event.kind,
      summary: `${event.source}${event.meta?.path ? ` ${String(event.meta.path)}` : ''}`,
      source: event.source,
      raw: event,
    })),
    ...runs.map((run): UnifiedLogItem => ({
      id: run.id,
      traceId: run.traceId ?? run.eventId ?? run.id,
      time: run.finishedAt ?? run.startedAt ?? run.queuedAt ?? '',
      category: 'run',
      direction: run.detail?.direction === 'outbound' ? 'outbound' : 'local',
      status:
        run.status === 'failed' || run.status === 'cancelled'
          ? 'failed'
          : run.status === 'completed'
            ? 'ok'
            : 'active',
      title: run.actionId,
      summary: run.output ?? run.error ?? run.target ?? run.status,
      source: run.ruleId ?? 'manual',
      raw: run,
    })),
  ].sort((a, b) => b.time.localeCompare(a.time));
}

function traceSteps(
  items: UnifiedLogItem[],
  t: Translator,
): Array<{
  time: string;
  title: string;
  detail: string;
  status: UnifiedLogItem['status'];
}> {
  const steps: Array<{
    time: string;
    title: string;
    detail: string;
    status: UnifiedLogItem['status'];
  }> = [];
  for (const item of items) {
    if (item.category === 'run') {
      const run = item.raw as RunRow;
      if (run.queuedAt)
        steps.push({
          time: run.queuedAt,
          title: `${run.actionId} · ${t('run.queued')}`,
          detail: run.target ?? run.ruleId ?? '',
          status: 'active',
        });
      if (run.startedAt)
        steps.push({
          time: run.startedAt,
          title: `${run.actionId} · ${t('run.running')}`,
          detail: run.actionType ?? '',
          status: 'active',
        });
      steps.push({
        time: item.time,
        title: `${run.actionId} · ${t(`run.${run.status}`)}`,
        detail: item.summary,
        status: item.status,
      });
    } else {
      steps.push({
        time: item.time,
        title: item.title,
        detail: item.summary,
        status: item.status,
      });
    }
    if (item.category === 'event') {
      const evaluations = (item.raw as EventRow).meta?.ruleEvaluations;
      if (Array.isArray(evaluations)) {
        for (const evaluation of evaluations as Array<{
          ruleId?: string;
          matched?: boolean;
          actions?: string[];
        }>) {
          steps.push({
            time: item.time,
            title: `${t('logs.ruleEvaluation')}: ${evaluation.ruleId ?? 'unknown'}`,
            detail: evaluation.matched
              ? `${t('rule.matched')} → ${(evaluation.actions ?? []).join(', ') || t('rule.noActions')}`
              : t('rule.missed'),
            status: evaluation.matched ? 'ok' : 'active',
          });
        }
      }
    }
  }
  return steps.sort((a, b) => a.time.localeCompare(b.time));
}

function formatUnifiedConsoleLine(item: UnifiedLogItem): string {
  return `[${new Date(item.time).toLocaleTimeString()}] [${item.direction.toUpperCase()}] [${shortTrace(item.traceId)}] ${item.title} ${item.summary}`;
}

function shortTrace(traceId: string): string {
  return traceId.length > 12 ? traceId.slice(0, 8) : traceId;
}

function YamlEditor({
  name,
  title,
  value,
  t,
  onSave,
}: {
  name: string;
  title?: string;
  value: string;
  t: Translator;
  onSave: (content: string) => Promise<void>;
}) {
  const [draft, setDraft] = React.useState(value);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  React.useEffect(() => setDraft(value), [value]);

  async function handleSave() {
    setSaveError(null);
    try {
      await onSave(draft);
    } catch (error) {
      setSaveError(errorMessage(error));
    }
  }

  return (
    <Panel
      title={title ?? `${name}.yaml`}
      actions={
        <button
          onClick={() => void handleSave()}
          title={`${t('common.save')} ${name}.yaml`}
        >
          <Save size={17} />
        </button>
      }
    >
      {saveError && <div className="formError">{saveError}</div>}
      <textarea
        id={name === 'endpoints' ? 'endpoint-config-editor' : undefined}
        value={draft}
        onChange={event => setDraft(event.target.value)}
        spellCheck={false}
      />
    </Panel>
  );
}

function Panel({
  title,
  actions,
  children,
}: React.PropsWithChildren<{title: string; actions?: React.ReactNode}>) {
  return (
    <section className="panel">
      <div className="panelHead">
        <h2>{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
