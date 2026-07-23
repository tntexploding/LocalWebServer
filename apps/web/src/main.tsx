import React from 'react';
import ReactDOM from 'react-dom/client';
import {
  Activity,
  Bell,
  Bug,
  CircleDot,
  Code2,
  History,
  LayoutList,
  ListChecks,
  MessageSquare,
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
  ShieldCheck,
  SlidersHorizontal,
  Terminal,
  TestTube2,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import type {
  ActionConfig,
  ActionResult,
  ConfigRevision,
  EventEnvelope,
  LoadedConfig,
  MatchConfig,
  MessageTemplateField as CoreMessageTemplateField,
  UserInteraction,
  WorkflowRunDetail,
} from '@las/core';
import {translate, type Locale} from './i18n';
import {EndpointSplitLayout} from './EndpointSplitLayout';
import {LocaleContext, ResizablePanel} from './ResizablePanel';
import {ActionSplitLayout} from './ActionSplitLayout';
import {WorkflowWorkspace} from './WorkflowWorkspace';
import './styles.css';

type AppConfig = LoadedConfig;
type AppAction = ActionConfig;
interface Health {
  ok: boolean;
  time: string;
  ws: Array<{
    target: string;
    role: 'server' | 'client';
    clients: number;
    state: string;
    url?: string;
    reconnectAttempt?: number;
    lastConnectedAt?: string;
    lastMessageAt?: string;
    error?: string;
  }>;
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
  schedules: Array<{
    ruleId: string;
    mode: 'once' | 'interval' | 'daily';
    nextRunAt: string;
    lastRunAt?: string;
    timeZone?: string;
  }>;
}

interface RuleTestResult {
  event: EventRow;
  matches: Array<{
    ruleId: string;
    matched: boolean;
    actions: string[];
    description?: string;
    checks: Array<{
      field:
        | 'enabled'
        | 'source'
        | 'kind'
        | 'template'
        | 'equals'
        | 'contains'
        | 'regex';
      matched: boolean;
      expected?: unknown;
      actual?: unknown;
      path?: string;
    }>;
  }>;
}
type ActionKind = AppAction['type'];
const actionKinds: ActionKind[] = [
  'command',
  'script',
  'send_http',
  'send_ws',
  'notification',
  'prompt',
  'wait_event',
];
type OverviewRange = '1h' | '1d' | '7d' | 'all';
interface ActionDraft {
  index: number;
  id: string;
  type: ActionKind;
  description: string;
  cwd: string;
  command: string;
  interpreter: string;
  script: string;
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
  title: string;
  message: string;
  optionsText: string;
  anySource: boolean;
  source: string;
  eventKind: EventEnvelope['kind'] | '';
  matchText: string;
  expressionPolicy: 'error' | 'empty' | 'preserve';
  retryMaxAttempts: string;
  retryInitialDelayMs: string;
  retryBackoffMultiplier: string;
  retryMaxDelayMs: string;
  idempotencyKey: string;
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
  reconnectEnabled: boolean;
  reconnectInitialDelayMs: string;
  reconnectMaxDelayMs: string;
  reconnectBackoffMultiplier: string;
  heartbeatIntervalMs: string;
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
  type: 'test' | 'event';
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
type ApiFailureKind = 'network' | 'auth' | 'http' | 'parse' | 'unknown';
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

const API_BASE = resolveApiBase();
const AUTO_REFRESH_INTERVAL_MS = 5000;

function resolveApiBase(): string {
  const configured = import.meta.env.VITE_API_BASE?.trim();
  if (configured) return configured.replace(/\/+$/u, '');
  return ['http:', 'https:'].includes(window.location.protocol)
    ? window.location.origin
    : '';
}

function apiAuthority(): string {
  try {
    return new URL(API_BASE).host;
  } catch {
    return window.location.host || '-';
  }
}

function initialApiToken(): string {
  const sessionToken = sessionStorage.getItem('las-token');
  if (sessionToken) return sessionToken;
  const legacyToken = localStorage.getItem('las-token');
  if (!legacyToken) return '';
  localStorage.removeItem('las-token');
  sessionStorage.setItem('las-token', legacyToken);
  return legacyToken;
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
  token?: string,
): Promise<ApiResult<T>> {
  const url = `${API_BASE}${path}`;
  try {
    const response = await fetch(url, {
      headers: token ? {'x-las-token': token} : undefined,
    });
    if (!response.ok) {
      return {
        ok: false,
        id,
        failure: {
          id,
          label,
          url,
          kind:
            response.status === 401 || response.status === 403
              ? 'auth'
              : 'http',
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

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}

function App() {
  const savedLocale = localStorage.getItem('las-locale') as Locale | null;
  const [locale, setLocale] = React.useState<Locale>(savedLocale ?? 'zh-CN');
  const t = React.useCallback<Translator>(
    (key, values) => translate(locale, key, values),
    [locale],
  );
  React.useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dataset.arkTheme = 'ark';
    document.documentElement.dataset.arkDepth = 'complex';
  }, [locale]);
  const [active, setActive] =
    React.useState<(typeof nav)[number]['id']>('dashboard');
  const [token, setToken] = React.useState(initialApiToken);
  const [config, setConfig] = React.useState<AppConfig | null>(null);
  const [raw, setRaw] = React.useState<RawConfig | null>(null);
  const [health, setHealth] = React.useState<Health | null>(null);
  const [events, setEvents] = React.useState<EventRow[]>([]);
  const [runs, setRuns] = React.useState<RunRow[]>([]);
  const [queue, setQueue] = React.useState<QueueSnapshot | null>(null);
  const [interactions, setInteractions] = React.useState<UserInteraction[]>([]);
  const [templates, setTemplates] = React.useState<MessageTemplateSummary[]>(
    [],
  );
  const [apiFailures, setApiFailures] = React.useState<ApiFailure[]>([]);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [configHistory, setConfigHistory] = React.useState<ConfigRevision[]>(
    [],
  );
  const [status, setStatus] = React.useState(t('status.ready'));

  const refresh = React.useCallback(async () => {
    const rawRequest = token.trim()
      ? fetchJson<RawConfig>(
          'raw',
          'GET /api/config/raw',
          '/api/config/raw',
          token,
        )
      : Promise.resolve<ApiResult<RawConfig | null>>({
          ok: true,
          id: 'raw',
          value: null,
        });
    const results = await Promise.all([
      fetchJson<Health>('health', 'GET /api/health', '/api/health', token),
      fetchJson<AppConfig>('config', 'GET /api/config', '/api/config', token),
      rawRequest,
      fetchJson<MessageTemplateSummary[]>(
        'templates',
        'GET /api/templates',
        '/api/templates',
        token,
      ),
      fetchJson<EventRow[]>(
        'events',
        'GET /api/events',
        '/api/events?limit=80',
        token,
      ),
      fetchJson<RunRow[]>('runs', 'GET /api/runs', '/api/runs?limit=80', token),
      fetchJson<QueueSnapshot>('queue', 'GET /api/queue', '/api/queue', token),
      fetchJson<UserInteraction[]>(
        'interactions',
        'GET /api/interactions',
        '/api/interactions',
        token,
      ),
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
      if (result.id === 'raw' && result.value !== null) {
        setRaw(result.value as RawConfig);
      }
      if (result.id === 'templates')
        setTemplates(result.value as MessageTemplateSummary[]);
      if (result.id === 'events') setEvents(result.value as EventRow[]);
      if (result.id === 'runs') setRuns(result.value as RunRow[]);
      if (result.id === 'queue') setQueue(result.value as QueueSnapshot);
      if (result.id === 'interactions')
        setInteractions(result.value as UserInteraction[]);
    }

    if (failures.length === 0) {
      setStatus(t('status.updated'));
    } else if (failures.some(failure => failure.id === 'health')) {
      setStatus(t('status.backendOffline'));
    } else if (failures.some(failure => failure.kind === 'auth')) {
      setStatus(t('status.authorizationRequired'));
    } else {
      setStatus(t('status.partialFailure'));
    }
  }, [t, token]);
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
    if (next) sessionStorage.setItem('las-token', next);
    else sessionStorage.removeItem('las-token');
  }

  async function openConfigHistory() {
    const response = await fetch(`${API_BASE}/api/config/history`, {
      headers: {'x-las-token': token},
    });
    if (!response.ok) throw new Error(await response.text());
    setConfigHistory((await response.json()) as ConfigRevision[]);
    setHistoryOpen(true);
  }

  async function restoreConfigRevision(revision: ConfigRevision) {
    if (!window.confirm(t('config.historyConfirm', {name: revision.name}))) {
      return;
    }
    const response = await fetch(
      `${API_BASE}/api/config/history/${revision.name}/${encodeURIComponent(revision.id)}/restore`,
      {method: 'POST', headers: {'x-las-token': token}},
    );
    if (!response.ok) throw new Error(await response.text());
    setStatus(t('config.historyRestored', {name: revision.name}));
    setHistoryOpen(false);
    await refresh();
    queueFollowupRefresh();
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

  async function respondToInteraction(id: string, value: string) {
    const response = await fetch(
      `${API_BASE}/api/interactions/${encodeURIComponent(id)}/respond`,
      {
        method: 'POST',
        headers: {'content-type': 'application/json', 'x-las-token': token},
        body: JSON.stringify({value}),
      },
    );
    if (!response.ok) throw new Error(await response.text());
    await refresh();
    queueFollowupRefresh();
  }

  async function dismissInteraction(id: string) {
    const response = await fetch(
      `${API_BASE}/api/interactions/${encodeURIComponent(id)}`,
      {method: 'DELETE', headers: {'x-las-token': token}},
    );
    if (!response.ok) throw new Error(await response.text());
    await refresh();
    queueFollowupRefresh();
  }

  const activeNav = nav.find(item => item.id === active);
  const activeIndex = Math.max(
    0,
    nav.findIndex(item => item.id === active),
  );
  const activeSectionCode = `${String(activeIndex + 1).padStart(2, '0')} / ${String(nav.length).padStart(2, '0')}`;

  return (
    <LocaleContext.Provider value={locale}>
      <div
        className="shell"
        data-page={active}
        data-connection={health?.ok ? 'online' : 'offline'}
      >
        <aside className="sidebar">
          <div className="brand">
            <div className="mark" aria-hidden="true">
              <span>LAS</span>
            </div>
            <div>
              <strong>{t('app.name')}</strong>
              <span className="brandEndpoint">API / {apiAuthority()}</span>
            </div>
          </div>
          <nav>
            {nav.map((item, index) => {
              const Icon = item.icon;
              const label = t(item.labelKey);
              return (
                <button
                  key={item.id}
                  className={active === item.id ? 'active' : ''}
                  onClick={() => setActive(item.id)}
                  title={label}
                  aria-current={active === item.id ? 'page' : undefined}
                >
                  <small>{String(index + 1).padStart(2, '0')}</small>
                  <Icon size={18} />
                  <span className="navLabel">
                    <strong>{label}</strong>
                    <em>{item.id}</em>
                  </span>
                </button>
              );
            })}
          </nav>
          <div
            className="sidebarFoot"
            data-state={health?.ok ? 'online' : 'offline'}
          >
            <CircleDot size={14} />
            <span>
              <small>CORE LINK</small>
              <strong>
                {health?.ok
                  ? t('status.backendOnline')
                  : t('status.backendOffline')}
              </strong>
            </span>
          </div>
        </aside>

        <main
          className="appStage"
          data-section={activeNav?.id.toUpperCase() ?? ''}
          data-section-index={activeSectionCode}
        >
          <div className="stageInstrumentation" aria-hidden="true">
            <span className="stageAxis" />
            <span className="stageSector" />
            <span className="stageIndex">{activeSectionCode}</span>
          </div>
          <header className="topbar">
            <div className="pageIdentity">
              <div className="pageIdentityMeta">
                <span>{t('app.console')}</span>
                <code>{activeSectionCode}</code>
              </div>
              <h1>{activeNav ? t(activeNav.labelKey) : ''}</h1>
              <p aria-live="polite">{status}</p>
            </div>
            <div className="topControls">
              <button
                className="configHistoryButton"
                title={t('config.historyHelp')}
                onClick={() =>
                  void openConfigHistory().catch(error =>
                    setStatus(errorMessage(error)),
                  )
                }
              >
                <History size={17} />
                <span>{t('config.history')}</span>
              </button>
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
              <div className="tokenBox" title={t('field.apiTokenHelp')}>
                <ShieldCheck size={17} />
                <label>
                  <span>{t('field.apiToken')}</span>
                  <input
                    type="password"
                    value={token}
                    onChange={event => saveToken(event.target.value)}
                    placeholder={t('field.apiTokenPlaceholder')}
                    aria-label={t('field.apiToken')}
                    autoComplete="off"
                  />
                </label>
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
          {active === 'endpoints' && config && (
            <EndpointsPanel
              config={config}
              raw={raw?.endpoints ?? ''}
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
          {active === 'rules' && config && (
            <WorkflowWorkspace
              raw={raw?.rules ?? ''}
              rules={config.rules}
              actions={config.actions}
              endpoints={config.endpoints}
              templates={templates}
              runs={runs}
              activeRuns={[...(queue?.running ?? []), ...(queue?.queued ?? [])]}
              t={t}
              onSaveRules={(rules, id) => saveRuleSetup(rules, id)}
              onSaveRaw={content => saveConfig('rules', content)}
              onTest={eventText => testRules(eventText)}
            />
          )}
          {active === 'actions' && config && (
            <ActionsPanel
              raw={raw?.actions ?? ''}
              actions={config.actions}
              endpoints={config.endpoints}
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
      <InteractionCenter
        interactions={interactions}
        t={t}
        onRespond={(id, value) =>
          respondToInteraction(id, value).catch(error =>
            setStatus(errorMessage(error)),
          )
        }
        onDismiss={id =>
          dismissInteraction(id).catch(error => setStatus(errorMessage(error)))
        }
      />
      {historyOpen && (
        <ConfigHistoryDialog
          revisions={configHistory}
          t={t}
          onClose={() => setHistoryOpen(false)}
          onRestore={revision =>
            void restoreConfigRevision(revision).catch(error =>
              setStatus(errorMessage(error)),
            )
          }
        />
      )}
    </LocaleContext.Provider>
  );
}

function ConfigHistoryDialog({
  revisions,
  t,
  onClose,
  onRestore,
}: {
  revisions: ConfigRevision[];
  t: Translator;
  onClose: () => void;
  onRestore: (revision: ConfigRevision) => void;
}) {
  return (
    <div className="interactionBackdrop" role="presentation">
      <section
        className="configHistoryDialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="config-history-title"
      >
        <header>
          <div>
            <span>{t('config.historyDescription')}</span>
            <strong id="config-history-title">{t('config.history')}</strong>
          </div>
          <button title={t('common.close')} onClick={onClose}>
            <X size={17} />
          </button>
        </header>
        <div className="configHistoryList">
          {revisions.length === 0 ? (
            <p className="emptyState">{t('config.historyEmpty')}</p>
          ) : (
            revisions.map(revision => (
              <article key={`${revision.name}-${revision.id}`}>
                <div>
                  <strong>{revision.name}.yaml</strong>
                  <span>
                    {new Date(revision.createdAt).toLocaleString()} ·{' '}
                    {t(`config.historyReason.${revision.reason}`)} ·{' '}
                    {formatBytes(revision.size)}
                  </span>
                  <code>{revision.sha256.slice(0, 16)}</code>
                </div>
                <button
                  className="secondaryButton"
                  onClick={() => onRestore(revision)}
                >
                  <RotateCcw size={15} />
                  {t('config.restore')}
                </button>
              </article>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function InteractionCenter({
  interactions,
  t,
  onRespond,
  onDismiss,
}: {
  interactions: UserInteraction[];
  t: Translator;
  onRespond: (id: string, value: string) => void;
  onDismiss: (id: string) => void;
}) {
  const prompt = interactions.find(item => item.type === 'prompt');
  const notifications = interactions.filter(
    item => item.type === 'notification',
  );
  const announcedNotifications = React.useRef(new Set<string>());
  React.useEffect(() => {
    if (!('Notification' in window) || Notification.permission !== 'granted')
      return;
    for (const item of notifications) {
      if (announcedNotifications.current.has(item.id)) continue;
      announcedNotifications.current.add(item.id);
      new Notification(item.title, {body: item.message, tag: item.id});
    }
  }, [notifications]);
  return (
    <>
      {notifications.length > 0 && (
        <aside className="interactionNotifications" aria-live="polite">
          {notifications.map(item => (
            <article key={item.id}>
              <Bell size={17} />
              <div>
                <strong>{item.title}</strong>
                <p>{item.message}</p>
                <time>{new Date(item.createdAt).toLocaleTimeString()}</time>
              </div>
              <button
                title={t('interaction.dismiss')}
                onClick={() => onDismiss(item.id)}
              >
                <X size={15} />
              </button>
            </article>
          ))}
        </aside>
      )}
      {prompt && (
        <div className="interactionBackdrop" role="presentation">
          <section
            className="interactionPrompt"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`interaction-title-${prompt.id}`}
          >
            <header>
              <MessageSquare size={18} />
              <div>
                <span>{t('interaction.choiceRequired')}</span>
                <strong id={`interaction-title-${prompt.id}`}>
                  {prompt.title}
                </strong>
              </div>
              <button
                title={t('interaction.dismiss')}
                onClick={() => onDismiss(prompt.id)}
              >
                <X size={16} />
              </button>
            </header>
            <p>{prompt.message}</p>
            {prompt.expiresAt && (
              <small>
                {t('interaction.expiresAt', {
                  time: new Date(prompt.expiresAt).toLocaleTimeString(),
                })}
              </small>
            )}
            <footer>
              {prompt.options.map(option => (
                <button
                  className="primaryButton"
                  key={option}
                  onClick={() => onRespond(prompt.id, option)}
                >
                  {option}
                </button>
              ))}
            </footer>
          </section>
        </div>
      )}
    </>
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
  const endpointStates = config
    ? [
        ...config.endpoints.httpServers.map(endpoint => ({
          id: endpoint.id,
          enabled: endpoint.enabled,
          type: t('endpoint.httpServer'),
          target: `http://${formatUrlHost(endpoint.host ?? config.app.server.host)}:${endpoint.port ?? config.app.server.port}${endpoint.path}`,
        })),
        ...config.endpoints.wsServers.map(endpoint => ({
          id: endpoint.id,
          enabled: endpoint.enabled,
          type: t('endpoint.wsServer'),
          target: `ws://${formatUrlHost(endpoint.host ?? config.app.server.host)}:${endpoint.port ?? config.app.server.port}${endpoint.path}`,
        })),
        ...config.endpoints.httpClients.map(endpoint => ({
          id: endpoint.id,
          enabled: endpoint.enabled,
          type: t('endpoint.httpClient'),
          target: endpoint.baseUrl,
        })),
        ...config.endpoints.wsClients.map(endpoint => ({
          id: endpoint.id,
          enabled: endpoint.enabled,
          type: t('endpoint.wsClient'),
          target: endpoint.url,
        })),
      ]
    : [];
  const endpointCount = endpointStates.filter(
    endpoint => endpoint.enabled,
  ).length;
  const activeAutomations =
    config?.rules.filter(rule => rule.enabled).length ?? 0;
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
  const settledRuns = periodRuns.filter(run =>
    ['completed', 'failed', 'cancelled'].includes(run.status),
  );
  const successfulRuns = settledRuns.filter(
    run => run.status === 'completed' && run.ok !== false,
  ).length;
  const successRate = settledRuns.length
    ? Math.round((successfulRuns / settledRuns.length) * 100)
    : 100;
  const failedRuns = periodRuns
    .filter(run => run.status === 'failed' || run.ok === false)
    .slice(0, 6);
  const upcomingActions = [
    ...(queue?.queued ?? []),
    ...(queue?.running ?? []),
  ].slice(0, 8);
  const scheduledAutomations = (queue?.schedules ?? []).slice(0, 8);
  const trafficBuckets = buildTrafficBuckets(periodEvents, periodRuns, range);
  const peakTraffic = Math.max(
    1,
    ...trafficBuckets.map(bucket => bucket.received + bucket.sent),
  );
  const latestActivity = latestActivityTime(events, runs);

  return (
    <section className="overviewPage">
      <div className="overviewTop">
        <ResizablePanel
          storageKey="overview-identity"
          className="projectIntro"
          resetLabel={t('common.resetPanelSize')}
        >
          <div className="projectLogoPlaceholder">LAS</div>
          <div className="overviewIdentity">
            <span>{t('overview.projectCategory')}</span>
            <h2>{t('overview.projectName')}</h2>
            <p>{t('overview.projectDescription')}</p>
            <div className="statusRibbon">
              <span className={health?.ok ? 'online' : 'offline'}>
                <CircleDot size={13} />
                {health?.ok
                  ? t('status.backendOnline')
                  : t('status.backendOffline')}
              </span>
              <span>
                <RefreshCw size={13} />
                {t('overview.autoRefresh')}
              </span>
              <span>
                <Activity size={13} />
                {latestActivity
                  ? t('overview.lastActivityAt', {
                      time: new Date(latestActivity).toLocaleTimeString(),
                    })
                  : t('overview.noActivity')}
              </span>
            </div>
          </div>
        </ResizablePanel>
        <ResizablePanel
          storageKey="overview-service"
          className="serviceOverview"
          resetLabel={t('common.resetPanelSize')}
        >
          <div className="overviewSectionHead">
            <div>
              <span>{t('overview.serviceOverview')}</span>
              <strong>{t('overview.liveSnapshot')}</strong>
            </div>
            <Activity size={18} />
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
              <strong>{activeAutomations}</strong>
            </div>
            <div>
              <span>{t('overview.listeners')}</span>
              <strong>{health?.listeners?.length ?? 0}</strong>
            </div>
          </div>
        </ResizablePanel>
      </div>
      <div className="overviewMetricStrip">
        {[
          [t('overview.receivedMessages'), receivedMessages],
          [t('overview.sentMessages'), sentMessages],
          [t('overview.automationActions'), automationActions],
          [t('overview.completedRules'), completedRules],
          [t('overview.successRate'), `${successRate}%`],
        ].map(([label, value], index) => (
          <ResizablePanel
            storageKey={`overview-metric-${index}`}
            className="runtimeMetric"
            resetLabel={t('common.resetPanelSize')}
            key={String(label)}
          >
            <span>{label}</span>
            <strong>{value}</strong>
          </ResizablePanel>
        ))}
      </div>
      <div className="overviewOperationsGrid">
        <div className="overviewMonitorColumn">
          <ResizablePanel
            storageKey="overview-traffic"
            className="monitorModule trafficModule"
            resetLabel={t('common.resetPanelSize')}
          >
            <div className="monitoringHead">
              <div>
                <span>{t('overview.trafficDescription')}</span>
                <strong>{t('overview.traffic')}</strong>
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
            <div className="trafficLegend">
              <span className="received">{t('overview.received')}</span>
              <span className="sent">{t('overview.sent')}</span>
            </div>
            <div className="trafficChart">
              {trafficBuckets.map((bucket, index) => (
                <div
                  className="trafficColumn"
                  title={`${bucket.label}: ${t('overview.received')} ${bucket.received}, ${t('overview.sent')} ${bucket.sent}`}
                  key={`${bucket.label}-${index}`}
                >
                  <div className="trafficBars">
                    <i
                      className="received"
                      style={{
                        height: `${(bucket.received / peakTraffic) * 100}%`,
                      }}
                    />
                    <i
                      className="sent"
                      style={{height: `${(bucket.sent / peakTraffic) * 100}%`}}
                    />
                  </div>
                  <small>{bucket.label}</small>
                </div>
              ))}
            </div>
          </ResizablePanel>
          <ResizablePanel
            storageKey="overview-queue"
            className="upcomingActions"
            resetLabel={t('common.resetPanelSize')}
          >
            <div className="moduleHead">
              <div>
                <span>{t('overview.queueDescription')}</span>
                <strong>{t('overview.upcomingActions')}</strong>
              </div>
              <code>
                {upcomingActions.length + scheduledAutomations.length}
              </code>
            </div>
            <div className="overviewActionList">
              {upcomingActions.length === 0 &&
                scheduledAutomations.length === 0 && (
                  <div className="empty">{t('overview.noUpcomingActions')}</div>
                )}
              {scheduledAutomations.map(schedule => (
                <details
                  className="actionCard queued"
                  key={`${schedule.ruleId}-${schedule.nextRunAt}`}
                >
                  <summary>
                    <div>
                      <strong>{schedule.ruleId}</strong>
                      <span>{t(`overview.schedule.${schedule.mode}`)}</span>
                    </div>
                    <code>{new Date(schedule.nextRunAt).toLocaleString()}</code>
                  </summary>
                  <pre>{JSON.stringify(schedule, null, 2)}</pre>
                </details>
              ))}
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
            </div>
          </ResizablePanel>
        </div>
        <div className="overviewMonitorColumn">
          <ResizablePanel
            storageKey="overview-endpoints"
            className="monitorModule endpointHealthModule"
            resetLabel={t('common.resetPanelSize')}
          >
            <div className="moduleHead">
              <div>
                <span>{t('overview.endpointHealthDescription')}</span>
                <strong>{t('overview.endpointHealth')}</strong>
              </div>
              <code>
                {endpointCount}/{endpointStates.length}
              </code>
            </div>
            <div className="overviewEndpointList">
              {endpointStates.slice(0, 8).map(endpoint => (
                <div
                  className={endpoint.enabled ? '' : 'disabled'}
                  key={`${endpoint.type}-${endpoint.id}`}
                >
                  <i />
                  <span>
                    <strong>{endpoint.id}</strong>
                    <small>{endpoint.type}</small>
                  </span>
                  <code>{endpoint.target}</code>
                  <em>
                    {t(endpoint.enabled ? 'common.enabled' : 'common.disabled')}
                  </em>
                </div>
              ))}
              {endpointStates.length === 0 && (
                <div className="empty">{t('overview.noEndpoints')}</div>
              )}
            </div>
          </ResizablePanel>
          <ResizablePanel
            storageKey="overview-failures"
            className="monitorModule failureModule"
            resetLabel={t('common.resetPanelSize')}
          >
            <div className="moduleHead">
              <div>
                <span>{t('overview.failureDescription')}</span>
                <strong>{t('overview.recentFailures')}</strong>
              </div>
              <code>{failedRuns.length}</code>
            </div>
            <div className="overviewFailureList">
              {failedRuns.length === 0 && (
                <div className="empty healthy">{t('overview.noFailures')}</div>
              )}
              {failedRuns.map(run => (
                <div key={run.id}>
                  <XCircle size={15} />
                  <span>
                    <strong>{run.actionId}</strong>
                    <small>{run.error ?? t(`run.${run.status}`)}</small>
                  </span>
                  <time>
                    {formatOptionalTime(
                      run.finishedAt ?? run.startedAt ?? run.queuedAt,
                    )}
                  </time>
                </div>
              ))}
            </div>
          </ResizablePanel>
        </div>
      </div>
    </section>
  );
}

interface TrafficBucket {
  label: string;
  received: number;
  sent: number;
}

function buildTrafficBuckets(
  events: EventRow[],
  runs: RunRow[],
  range: OverviewRange,
): TrafficBucket[] {
  const now = Date.now();
  const configuredSpan =
    range === '1h'
      ? 60 * 60 * 1000
      : range === '1d'
        ? 24 * 60 * 60 * 1000
        : range === '7d'
          ? 7 * 24 * 60 * 60 * 1000
          : 0;
  const timestamps = [
    ...events.map(event => new Date(event.time).getTime()),
    ...runs.map(run =>
      new Date(run.finishedAt ?? run.startedAt ?? run.queuedAt ?? '').getTime(),
    ),
  ].filter(Number.isFinite);
  const earliest = timestamps.length ? Math.min(...timestamps) : now;
  const span = configuredSpan || Math.max(now - earliest, 60 * 60 * 1000);
  const count = range === '7d' ? 14 : 12;
  const step = span / count;
  const start = now - span;
  const buckets = Array.from({length: count}, (_, index): TrafficBucket => {
    const bucketStart = start + index * step;
    return {
      label:
        range === '7d' || range === 'all'
          ? new Date(bucketStart).toLocaleDateString(undefined, {
              month: 'numeric',
              day: 'numeric',
            })
          : new Date(bucketStart).toLocaleTimeString(undefined, {
              hour: '2-digit',
              minute: '2-digit',
            }),
      received: 0,
      sent: 0,
    };
  });
  const bucketIndex = (timestamp: number) =>
    Math.min(count - 1, Math.max(0, Math.floor((timestamp - start) / step)));
  for (const event of events) {
    const timestamp = new Date(event.time).getTime();
    if (Number.isFinite(timestamp) && timestamp >= start)
      buckets[bucketIndex(timestamp)].received += 1;
  }
  for (const run of runs) {
    if (
      run.actionType !== 'send_http' &&
      run.actionType !== 'send_ws' &&
      run.detail?.direction !== 'outbound'
    ) {
      continue;
    }
    const timestamp = new Date(
      run.finishedAt ?? run.startedAt ?? run.queuedAt ?? '',
    ).getTime();
    if (Number.isFinite(timestamp) && timestamp >= start)
      buckets[bucketIndex(timestamp)].sent += 1;
  }
  return buckets;
}

function latestActivityTime(events: EventRow[], runs: RunRow[]): string {
  return (
    [
      ...events.map(event => event.time),
      ...runs.map(run => run.finishedAt ?? run.startedAt ?? run.queuedAt ?? ''),
    ]
      .filter(Boolean)
      .sort((left, right) => right.localeCompare(left))[0] ?? ''
  );
}

function formatOptionalTime(value: string | undefined): string {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleTimeString() : '-';
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
        {t('diagnostics.checkCommand', {url: `${API_BASE}/api/health`})}
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
  const host = config.app.server.host;
  const port = config.app.server.port;
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
          `http://${endpoint.host ?? host}:${endpoint.port ?? port}${endpoint.path}`,
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
        description: emptyToUndefined(draft.description),
        reconnect: {
          enabled: draft.reconnectEnabled,
          initialDelayMs: Number(draft.reconnectInitialDelayMs),
          maxDelayMs: Number(draft.reconnectMaxDelayMs),
          backoffMultiplier: Number(draft.reconnectBackoffMultiplier),
        },
        heartbeatIntervalMs: draft.heartbeatIntervalMs
          ? Number(draft.heartbeatIntervalMs)
          : undefined,
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
        <EndpointSplitLayout
          resizeRegistryLabel={t('endpoint.resizeRegistry')}
          resizeInspectorLabel={t('endpoint.resizeInspector')}
          registry={
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
          }
          inspector={
            editing ? (
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
            )
          }
          logs={
            <EndpointLogPanel
              logs={selectedLogs}
              t={t}
              title={
                selectedEndpoint
                  ? t('endpoint.selectedActivity', {id: selectedEndpoint.id})
                  : t('panel.endpointLogs')
              }
            />
          }
        />
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
    <div className="connectionTable">
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
      <div className="connectionRows">
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
    </div>
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
            <label>
              <span>{t('field.url')}</span>
              <input
                value={draft.baseUrl}
                onChange={event => update({baseUrl: event.target.value})}
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
            <label>
              <span>{t('field.path')}</span>
              <input
                value={draft.path}
                onChange={event => update({path: event.target.value})}
              />
            </label>
          )}
          {draft.kind === 'httpServer' && (
            <>
              <label>
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
              <label>
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
            <>
              <label className="wideLabel">
                <span>{t('field.url')}</span>
                <input
                  value={draft.url}
                  onChange={event => update({url: event.target.value})}
                />
              </label>
              <fieldset className="actionReliabilityFields wideLabel">
                <legend>{t('endpoint.connectionReliability')}</legend>
                <label className="checkLabel">
                  <input
                    type="checkbox"
                    checked={draft.reconnectEnabled}
                    onChange={event =>
                      update({reconnectEnabled: event.target.checked})
                    }
                  />
                  <span>{t('endpoint.autoReconnect')}</span>
                </label>
                <label>
                  <span>{t('endpoint.reconnectInitialDelay')}</span>
                  <input
                    type="number"
                    min={100}
                    value={draft.reconnectInitialDelayMs}
                    onChange={event =>
                      update({reconnectInitialDelayMs: event.target.value})
                    }
                  />
                </label>
                <label>
                  <span>{t('endpoint.reconnectMaxDelay')}</span>
                  <input
                    type="number"
                    min={100}
                    value={draft.reconnectMaxDelayMs}
                    onChange={event =>
                      update({reconnectMaxDelayMs: event.target.value})
                    }
                  />
                </label>
                <label>
                  <span>{t('endpoint.reconnectMultiplier')}</span>
                  <input
                    type="number"
                    min={1}
                    step="0.1"
                    value={draft.reconnectBackoffMultiplier}
                    onChange={event =>
                      update({
                        reconnectBackoffMultiplier: event.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  <span>{t('endpoint.heartbeatInterval')}</span>
                  <input
                    type="number"
                    min={1000}
                    value={draft.heartbeatIntervalMs}
                    onChange={event =>
                      update({heartbeatIntervalMs: event.target.value})
                    }
                  />
                </label>
              </fieldset>
            </>
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
      : config.app.server.host;
  const port =
    'port' in endpoint && endpoint.port
      ? endpoint.port
      : config.app.server.port;
  return {
    kind,
    index,
    id: endpoint.id,
    enabled: endpoint.enabled,
    description: 'description' in endpoint ? (endpoint.description ?? '') : '',
    host,
    port: String(port),
    path: 'path' in endpoint ? endpoint.path : '',
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
    reconnectEnabled:
      'reconnect' in endpoint ? (endpoint.reconnect?.enabled ?? true) : true,
    reconnectInitialDelayMs:
      'reconnect' in endpoint
        ? String(endpoint.reconnect?.initialDelayMs ?? 1000)
        : '1000',
    reconnectMaxDelayMs:
      'reconnect' in endpoint
        ? String(endpoint.reconnect?.maxDelayMs ?? 30000)
        : '30000',
    reconnectBackoffMultiplier:
      'reconnect' in endpoint
        ? String(endpoint.reconnect?.backoffMultiplier ?? 2)
        : '2',
    heartbeatIntervalMs:
      'heartbeatIntervalMs' in endpoint
        ? String(endpoint.heartbeatIntervalMs ?? '')
        : '',
  };
}

function createNewEndpointDraft(
  kind: EndpointKind,
  config: AppConfig,
): EndpointDraft {
  const id = nextEndpointId(kind, config.endpoints);
  const baseUrl = `http://${formatUrlHost(config.app.server.host)}:${config.app.server.port}`;
  return {
    kind,
    index: -1,
    id,
    enabled: false,
    description: '',
    host: config.app.server.host,
    port: String(config.app.server.port),
    path: kind === 'httpServer' || kind === 'wsServer' ? `/${id}` : '',
    baseUrl: kind === 'httpServer' ? baseUrl : '',
    url: '',
    template: '',
    templateFields: [],
    templateValues: {},
    headersText: '{}',
    reconnectEnabled: true,
    reconnectInitialDelayMs: '1000',
    reconnectMaxDelayMs: '30000',
    reconnectBackoffMultiplier: '2',
    heartbeatIntervalMs: '30000',
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
  return `${protocol}://${formatUrlHost(draft.host)}:${draft.port}${draft.path}`;
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
  if (kind === 'auth') return t('diagnostics.auth');
  if (kind === 'http') return t('diagnostics.http');
  if (kind === 'parse') return t('diagnostics.parse');
  return t('diagnostics.unknown');
}

function ActionsPanel({
  raw,
  actions,
  endpoints,
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
  endpoints: AppConfig['endpoints'];
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
              {actionKinds.map(kind => (
                <option value={kind} key={kind}>
                  {actionTypeLabel(kind, t)}
                </option>
              ))}
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
                {actionKinds.map(kind => (
                  <option value={kind} key={kind}>
                    {actionTypeLabel(kind, t)}
                  </option>
                ))}
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
        <ActionSplitLayout
          resizeColumnLabel={t('action.resizeList')}
          resizeRowLabel={t('action.resizeDetails')}
          registry={
            <section className="actionLibraryList">
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
          }
          runtime={
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
          }
          inspector={
            <section className="actionInspector">
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
                      endpoints={endpoints}
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
            </section>
          }
        />
      )}
    </section>
  );
}

function ActionEditor({
  draft,
  endpoints,
  templates,
  t,
  error,
  onChange,
  onSave,
}: {
  draft: ActionDraft;
  endpoints: AppConfig['endpoints'];
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
        <label>
          <span>{t('field.type')}</span>
          <select
            value={draft.type}
            onChange={event => update({type: event.target.value as ActionKind})}
          >
            {actionKinds.map(kind => (
              <option value={kind} key={kind}>
                {actionTypeLabel(kind, t)}
              </option>
            ))}
          </select>
        </label>
        <label>
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
        <label>
          <span>{t('action.expressionPolicy')}</span>
          <select
            value={draft.expressionPolicy}
            onChange={event =>
              update({
                expressionPolicy: event.target
                  .value as ActionDraft['expressionPolicy'],
              })
            }
          >
            <option value="error">{t('action.expressionPolicy.error')}</option>
            <option value="empty">{t('action.expressionPolicy.empty')}</option>
            <option value="preserve">
              {t('action.expressionPolicy.preserve')}
            </option>
          </select>
        </label>
        <div className="actionExpressionHint wideLabel">
          <Code2 size={16} />
          <span>{t('action.expressionHint')}</span>
        </div>
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
            <label>
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
            <label>
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
        {(draft.type === 'send_http' || draft.type === 'send_ws') && (
          <fieldset className="actionReliabilityFields wideLabel">
            <legend>{t('action.reliability')}</legend>
            <label>
              <span>{t('action.timeout')}</span>
              <input
                type="number"
                min={1}
                value={draft.timeoutMs}
                onChange={event => update({timeoutMs: event.target.value})}
              />
            </label>
            <label>
              <span>{t('action.retryMaxAttempts')}</span>
              <input
                type="number"
                min={1}
                max={8}
                value={draft.retryMaxAttempts}
                onChange={event =>
                  update({retryMaxAttempts: event.target.value})
                }
              />
            </label>
            <label>
              <span>{t('action.retryInitialDelay')}</span>
              <input
                type="number"
                min={0}
                value={draft.retryInitialDelayMs}
                onChange={event =>
                  update({retryInitialDelayMs: event.target.value})
                }
              />
            </label>
            <label>
              <span>{t('action.retryMultiplier')}</span>
              <input
                type="number"
                min={1}
                step="0.1"
                value={draft.retryBackoffMultiplier}
                onChange={event =>
                  update({retryBackoffMultiplier: event.target.value})
                }
              />
            </label>
            <label>
              <span>{t('action.retryMaxDelay')}</span>
              <input
                type="number"
                min={0}
                value={draft.retryMaxDelayMs}
                onChange={event =>
                  update({retryMaxDelayMs: event.target.value})
                }
              />
            </label>
            {draft.type === 'send_http' && (
              <label>
                <span>{t('action.idempotencyKey')}</span>
                <input
                  value={draft.idempotencyKey}
                  onChange={event =>
                    update({idempotencyKey: event.target.value})
                  }
                />
              </label>
            )}
          </fieldset>
        )}
        {(draft.type === 'command' || draft.type === 'script') && (
          <>
            <div className="actionSecurityNotice wideLabel">
              <Terminal size={17} />
              <span>{t('action.commandSecurity')}</span>
            </div>
            <label>
              <span>{t('action.cwd')}</span>
              <input
                value={draft.cwd}
                onChange={event => update({cwd: event.target.value})}
              />
            </label>
            {draft.type === 'command' ? (
              <label>
                <span>{t('action.commandExecutable')}</span>
                <input
                  value={draft.command}
                  onChange={event => update({command: event.target.value})}
                />
              </label>
            ) : (
              <>
                <label>
                  <span>{t('action.interpreter')}</span>
                  <input
                    value={draft.interpreter}
                    onChange={event =>
                      update({interpreter: event.target.value})
                    }
                  />
                </label>
                <label className="wideLabel">
                  <span>{t('action.scriptPath')}</span>
                  <input
                    value={draft.script}
                    onChange={event => update({script: event.target.value})}
                  />
                </label>
              </>
            )}
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
            {draft.type === 'command' && (
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
            )}
          </>
        )}
        {(draft.type === 'notification' || draft.type === 'prompt') && (
          <>
            <label>
              <span>{t('action.interactionTitle')}</span>
              <input
                value={draft.title}
                onChange={event => update({title: event.target.value})}
              />
            </label>
            <label className="wideLabel">
              <span>{t('action.interactionMessage')}</span>
              <textarea
                className="formTextarea actionJsonEditor"
                value={draft.message}
                onChange={event => update({message: event.target.value})}
              />
            </label>
            {draft.type === 'prompt' && (
              <>
                <label className="wideLabel">
                  <span>{t('action.promptOptions')}</span>
                  <textarea
                    className="formTextarea actionJsonEditor"
                    value={draft.optionsText}
                    onChange={event =>
                      update({optionsText: event.target.value})
                    }
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
              </>
            )}
          </>
        )}
        {draft.type === 'wait_event' && (
          <>
            <label className="checkLabel">
              <input
                type="checkbox"
                checked={draft.anySource}
                onChange={event => update({anySource: event.target.checked})}
              />
              <span>{t('rule.anySource')}</span>
            </label>
            <label>
              <span>{t('field.source')}</span>
              <select
                disabled={draft.anySource}
                value={draft.source}
                onChange={event => update({source: event.target.value})}
              >
                <option value="">{t('workflow.selectSource')}</option>
                {actionEventSources(endpoints).map(source => (
                  <option value={source} key={source}>
                    {source}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>{t('field.eventKind')}</span>
              <select
                value={draft.eventKind}
                onChange={event =>
                  update({
                    eventKind: event.target.value as ActionDraft['eventKind'],
                  })
                }
              >
                <option value="">{t('rule.anyKind')}</option>
                <option value="http.request">http.request</option>
                <option value="http.response">http.response</option>
                <option value="ws.message">ws.message</option>
                <option value="action.result">action.result</option>
                <option value="timer.trigger">timer.trigger</option>
              </select>
            </label>
            <label>
              <span>{t('field.messageTemplate')}</span>
              <select
                value={draft.template}
                onChange={event => update({template: event.target.value})}
              >
                <option value="">{t('template.none')}</option>
                {templates
                  .filter(
                    template =>
                      template.capabilities.receive ||
                      template.capabilities.match,
                  )
                  .map(template => (
                    <option value={template.name} key={template.name}>
                      {template.displayName}
                    </option>
                  ))}
              </select>
            </label>
            <label className="wideLabel">
              <span>{t('action.matchConfiguration')}</span>
              <textarea
                className="formTextarea actionJsonEditor"
                value={draft.matchText}
                onChange={event => update({matchText: event.target.value})}
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
  const isProcess = action.type === 'command' || action.type === 'script';
  return {
    index,
    id: action.id,
    type: action.type,
    description: action.description ?? '',
    cwd: isProcess ? action.cwd : '',
    command: action.type === 'command' ? action.command : '',
    interpreter: action.type === 'script' ? action.interpreter : 'node',
    script: action.type === 'script' ? action.script : '',
    argsText: isProcess ? JSON.stringify(action.args ?? [], null, 2) : '[]',
    timeoutMs:
      action.type === 'command' || action.type === 'script'
        ? String(action.timeoutMs ?? 30000)
        : action.type === 'send_http' || action.type === 'send_ws'
          ? String(
              action.timeoutMs ?? (action.type === 'send_http' ? 15000 : 10000),
            )
          : action.type === 'prompt' || action.type === 'wait_event'
            ? String(action.timeoutMs ?? 300000)
            : '30000',
    allowConcurrent:
      action.type === 'command' ? (action.allowConcurrent ?? false) : false,
    method: action.type === 'send_http' ? action.method : 'POST',
    url: action.type === 'send_http' ? action.url : '',
    headersText:
      action.type === 'send_http'
        ? JSON.stringify(action.headers ?? {}, null, 2)
        : '{}',
    bodyText:
      action.type === 'send_http' || action.type === 'send_ws'
        ? JSON.stringify(action.body ?? {}, null, 2)
        : '{}',
    template:
      action.type === 'send_http' || action.type === 'wait_event'
        ? (action.template ?? '')
        : '',
    templateValues:
      action.type === 'send_http'
        ? stringifyTemplateValues(action.templateValues ?? {})
        : {},
    target: action.type === 'send_ws' ? action.target : '',
    title:
      action.type === 'notification' || action.type === 'prompt'
        ? action.title
        : 'LAS',
    message:
      action.type === 'notification' || action.type === 'prompt'
        ? action.message
        : '',
    optionsText:
      action.type === 'prompt'
        ? JSON.stringify(action.options, null, 2)
        : '["Confirm", "Cancel"]',
    anySource:
      action.type === 'wait_event' ? (action.anySource ?? false) : true,
    source: action.type === 'wait_event' ? (action.source ?? '') : '',
    eventKind: action.type === 'wait_event' ? (action.kind ?? '') : '',
    matchText:
      action.type === 'wait_event'
        ? JSON.stringify(action.match ?? {}, null, 2)
        : '{}',
    expressionPolicy: action.expressionPolicy ?? 'error',
    retryMaxAttempts:
      action.type === 'send_http' || action.type === 'send_ws'
        ? String(action.retry?.maxAttempts ?? 1)
        : '1',
    retryInitialDelayMs:
      action.type === 'send_http' || action.type === 'send_ws'
        ? String(action.retry?.initialDelayMs ?? 500)
        : '500',
    retryBackoffMultiplier:
      action.type === 'send_http' || action.type === 'send_ws'
        ? String(action.retry?.backoffMultiplier ?? 2)
        : '2',
    retryMaxDelayMs:
      action.type === 'send_http' || action.type === 'send_ws'
        ? String(action.retry?.maxDelayMs ?? 30000)
        : '30000',
    idempotencyKey:
      action.type === 'send_http' ? (action.idempotencyKey ?? '') : '',
  };
}

function createNewActionDraft(
  kind: ActionKind,
  actions: AppAction[],
): ActionDraft {
  const prefixes: Record<ActionKind, string> = {
    command: 'command',
    script: 'script',
    send_http: 'send-http',
    send_ws: 'send-ws',
    notification: 'notification',
    prompt: 'prompt',
    wait_event: 'wait-event',
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
    interpreter: 'node',
    script: '',
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
    title: 'LAS',
    message: '',
    optionsText: '["Confirm", "Cancel"]',
    anySource: true,
    source: '',
    eventKind: '',
    matchText: '{}',
    expressionPolicy: 'error',
    retryMaxAttempts: '1',
    retryInitialDelayMs: '500',
    retryBackoffMultiplier: '2',
    retryMaxDelayMs: '30000',
    idempotencyKey: '',
  };
}

function actionFromDraft(draft: ActionDraft): AppAction {
  const base = {
    id: draft.id.trim(),
    description: emptyToUndefined(draft.description),
    expressionPolicy: draft.expressionPolicy,
  };
  if (draft.type === 'command') {
    const args = parseStringArray(draft.argsText, 'Command arguments');
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
  if (draft.type === 'script') {
    return {
      ...base,
      type: 'script',
      cwd: draft.cwd.trim(),
      interpreter: draft.interpreter.trim(),
      script: draft.script.trim(),
      args: parseStringArray(draft.argsText, 'Script arguments'),
      timeoutMs: Number(draft.timeoutMs),
    };
  }
  if (draft.type === 'send_http') {
    return {
      ...base,
      type: 'send_http',
      method: draft.method,
      url: draft.url.trim(),
      headers: parseHeaders(draft.headersText),
      timeoutMs: Number(draft.timeoutMs),
      retry: retryPolicyFromDraft(draft),
      idempotencyKey: emptyToUndefined(draft.idempotencyKey),
      ...(draft.template
        ? {
            template: draft.template,
            templateValues: cleanTemplateValues(draft.templateValues),
          }
        : {body: parseOptionalJson(draft.bodyText)}),
    };
  }
  if (draft.type === 'send_ws') {
    return {
      ...base,
      type: 'send_ws',
      target: draft.target.trim(),
      body: parseOptionalJson(draft.bodyText),
      timeoutMs: Number(draft.timeoutMs),
      retry: retryPolicyFromDraft(draft),
    };
  }
  if (draft.type === 'notification') {
    return {
      ...base,
      type: 'notification',
      title: draft.title.trim(),
      message: draft.message,
    };
  }
  if (draft.type === 'prompt') {
    return {
      ...base,
      type: 'prompt',
      title: draft.title.trim(),
      message: draft.message,
      options: parseStringArray(draft.optionsText, 'Prompt options'),
      timeoutMs: Number(draft.timeoutMs),
    };
  }
  return {
    ...base,
    type: 'wait_event',
    anySource: draft.anySource,
    source: draft.anySource ? undefined : emptyToUndefined(draft.source),
    kind: draft.eventKind || undefined,
    template: emptyToUndefined(draft.template),
    match: parseMatchConfig(draft.matchText),
    timeoutMs: Number(draft.timeoutMs),
  };
}

function retryPolicyFromDraft(draft: ActionDraft) {
  return {
    maxAttempts: Number(draft.retryMaxAttempts),
    initialDelayMs: Number(draft.retryInitialDelayMs),
    backoffMultiplier: Number(draft.retryBackoffMultiplier),
    maxDelayMs: Number(draft.retryMaxDelayMs),
  };
}

function parseStringArray(value: string, label: string): string[] {
  const parsed = JSON.parse(value || '[]') as unknown;
  if (!Array.isArray(parsed) || parsed.some(item => typeof item !== 'string')) {
    throw new Error(`${label} must be a JSON string array.`);
  }
  return parsed;
}

function parseMatchConfig(value: string): MatchConfig | undefined {
  const parsed = parseOptionalJson(value);
  if (parsed === undefined) return undefined;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Match configuration must be a JSON object.');
  }
  return parsed as MatchConfig;
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
  if (action.type === 'script') return `${action.interpreter} ${action.script}`;
  if (action.type === 'send_http') return `${action.method} ${action.url}`;
  if (action.type === 'send_ws') return action.target;
  if (action.type === 'wait_event') return action.source ?? '*';
  return action.title;
}

function actionTypeLabel(type: ActionKind, t: Translator): string {
  const keys: Record<ActionKind, string> = {
    command: 'action.command',
    script: 'action.script',
    send_http: 'action.sendHttp',
    send_ws: 'action.sendWs',
    notification: 'action.notification',
    prompt: 'action.prompt',
    wait_event: 'action.waitEvent',
  };
  return t(keys[type]);
}

function actionEventSources(endpoints: AppConfig['endpoints']): string[] {
  return [
    ...endpoints.httpServers.map(endpoint => `http.server.${endpoint.id}`),
    ...endpoints.wsServers.map(endpoint => `ws.server.${endpoint.id}`),
    ...endpoints.wsClients.map(endpoint => `ws.client.${endpoint.id}`),
    'ui.manual',
  ];
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

  const allItems = unifiedLogItems(snapshot.events, snapshot.runs, t);
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
        <ResizablePanel
          storageKey="logs-stream"
          className="logCenter"
          resetLabel={t('common.resetPanelSize')}
        >
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
        </ResizablePanel>
        <ResizablePanel
          storageKey="logs-trace"
          className="traceInspector"
          resetLabel={t('common.resetPanelSize')}
        >
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
        </ResizablePanel>
      </div>
    </section>
  );
}

function unifiedLogItems(
  events: EventRow[],
  runs: RunRow[],
  t: Translator,
): UnifiedLogItem[] {
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
      summary: runLogSummary(run, t),
      source: run.ruleId ?? 'manual',
      raw: run,
    })),
  ].sort((a, b) => b.time.localeCompare(a.time));
}

function runLogSummary(run: RunRow, t: Translator): string {
  const summary = run.output ?? run.error ?? run.target ?? run.status;
  return run.attempts && run.attempts > 1
    ? `${summary} · ${t('logs.attempts', {count: run.attempts})}`
    : summary;
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
      const workflow = workflowRunTimeline(run);
      for (const node of workflow) {
        steps.push({
          time: node.finishedAt ?? node.startedAt,
          title: `${node.nodeId} · ${t(`workflow.node.${node.nodeType}`)}`,
          detail: [
            t(`workflow.runtime.${node.status}`),
            node.outcome ? t(`workflow.outcome.${node.outcome}`) : '',
            node.error ?? '',
          ]
            .filter(Boolean)
            .join(' · '),
          status:
            node.status === 'failed' || node.status === 'cancelled'
              ? 'failed'
              : node.status === 'running'
                ? 'active'
                : 'ok',
        });
      }
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

function workflowRunTimeline(run: RunRow): WorkflowRunDetail['timeline'] {
  const detail = run.detail as Partial<WorkflowRunDetail> | undefined;
  return detail?.kind === 'workflow' && Array.isArray(detail.timeline)
    ? detail.timeline
    : [];
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
      resizableKey={`yaml-${name}`}
      resetLabel={t('common.resetPanelSize')}
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
  resizableKey,
  resetLabel,
}: React.PropsWithChildren<{
  title: string;
  actions?: React.ReactNode;
  resizableKey?: string;
  resetLabel?: string;
}>) {
  const content = (
    <>
      <div className="panelHead">
        <h2>{title}</h2>
        {actions}
      </div>
      {children}
    </>
  );
  return resizableKey && resetLabel ? (
    <ResizablePanel
      storageKey={resizableKey}
      className="panel"
      resetLabel={resetLabel}
    >
      {content}
    </ResizablePanel>
  ) : (
    <section className="panel">{content}</section>
  );
}

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Missing #root application container.');
const reactRoot =
  import.meta.hot?.data.reactRoot ?? ReactDOM.createRoot(rootElement);
if (import.meta.hot) import.meta.hot.data.reactRoot = reactRoot;
reactRoot.render(<App />);
