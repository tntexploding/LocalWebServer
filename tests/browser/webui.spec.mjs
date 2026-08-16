import {expect, test} from '@playwright/test';
import {
  allocatePort,
  apiFetch,
  baseAppConfig,
  createTestProject,
  emptyEndpoints,
  startServer,
  testTokens,
} from '../support/testProject.mjs';

let baseUrl;
let project;
let runtime;

test.beforeAll(async () => {
  const controlPort = await allocatePort();
  const endpointPort = await allocatePort();
  const app = baseAppConfig(controlPort);
  app.security.requireTokenForRead = false;
  project = await createTestProject({
    app,
    endpoints: {
      ...emptyEndpoints(),
      httpServers: [
        {
          id: 'browser-http',
          enabled: true,
          host: '127.0.0.1',
          port: endpointPort,
          path: '/message',
        },
      ],
    },
    actions: {
      version: 1,
      actions: [
        {
          id: 'browser-notify',
          type: 'notification',
          title: 'Browser test',
          message: 'Notification action completed.',
        },
        {
          id: 'browser-command',
          type: 'command',
          cwd: '.',
          command: process.execPath,
          args: ['-e', 'process.exit(0)'],
          timeoutMs: 5000,
          allowConcurrent: true,
        },
      ],
    },
    rules: {
      version: 1,
      rules: [
        {
          id: 'browser-workflow',
          enabled: true,
          description: 'Browser workflow persistence test.',
          workflow: {
            version: '1.0',
            startNodeId: 'trigger',
            nodes: [
              {
                id: 'trigger',
                type: 'trigger',
                label: 'Browser trigger',
                trigger: {type: 'event', event: {anySource: true}},
              },
              {
                id: 'notify',
                type: 'action',
                label: 'Browser notification',
                action: {type: 'reference', actionId: 'browser-notify'},
              },
              {
                id: 'result-check',
                type: 'logic',
                label: 'Browser result check',
                logic: {input: 'lastResult', operator: 'success'},
              },
              {
                id: 'complete',
                type: 'end',
                label: 'Browser complete',
                end: {status: 'completed', message: 'Browser flow complete.'},
              },
            ],
            edges: [
              {
                id: 'trigger-notify',
                from: 'trigger',
                to: 'notify',
                outcome: 'always',
              },
              {
                id: 'notify-check',
                from: 'notify',
                to: 'result-check',
                outcome: 'success',
              },
              {
                id: 'notify-failed',
                from: 'notify',
                to: 'complete',
                outcome: 'failure',
              },
              {
                id: 'check-complete',
                from: 'result-check',
                to: 'complete',
                outcome: 'true',
              },
            ],
          },
        },
      ],
    },
  });
  runtime = await startServer(project.root, controlPort);
  baseUrl = runtime.baseUrl;
});

test.afterAll(async () => {
  await runtime?.stop();
  await project?.dispose();
});

test('authenticates, navigates, restores history view, and runs an action', async ({
  page,
}) => {
  const consoleErrors = [];
  page.on('console', message => {
    if (message.type() === 'error') {
      consoleErrors.push({
        text: message.text(),
        url: message.location().url,
      });
    }
  });

  await page.addInitScript(
    token => sessionStorage.setItem('las-token', token),
    testTokens.admin,
  );
  await page.goto(`${baseUrl}/ui/`);
  await expect(page.getByRole('heading', {name: '概览'})).toBeVisible();
  await expect(page.getByLabel('API 令牌')).toHaveValue(testTokens.admin);
  await page.getByTitle('刷新').click();
  await expect(page.getByRole('main').getByText('本地后端在线')).toBeVisible();

  await page.getByRole('button', {name: '配置历史'}).click();
  await expect(page.getByRole('dialog')).toContainText('配置历史');
  await page.getByRole('dialog').getByTitle('关闭').click();

  await page.getByRole('button', {name: '端点'}).click();
  await expect(
    page.getByRole('heading', {name: 'browser-http', exact: true}),
  ).toBeVisible();

  await page.getByRole('button', {name: '动作'}).click();
  await page.getByRole('button', {name: /^browser-notify /}).click();
  await page.getByRole('button', {name: '试运行'}).click();
  await page.getByRole('button', {name: '运行已保存动作'}).click();
  await expect(page.getByText('Notification action completed.')).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

test('keeps the read-only dashboard healthy without an admin token', async ({
  page,
}) => {
  await page.goto(`${baseUrl}/ui/`);
  await expect(page.getByRole('heading', {name: '概览'})).toBeVisible();
  await expect(page.getByLabel('API 令牌')).toHaveValue('');
  await expect(page.getByRole('main').getByText('本地后端在线')).toBeVisible();
  await expect(page.getByRole('heading', {name: '本地接口诊断'})).toHaveCount(
    0,
  );
  await page.getByRole('button', {name: '端点'}).click();
  await expect(
    page.getByRole('heading', {name: 'browser-http', exact: true}),
  ).toBeVisible();
});

test('adapts node tests and supports quick connection removal', async ({
  page,
}) => {
  await page.addInitScript(
    token => sessionStorage.setItem('las-token', token),
    testTokens.admin,
  );
  await page.goto(`${baseUrl}/ui/`);
  await page.getByRole('button', {name: '自动化'}).click();

  const canvas = page.locator('.workflowCanvasPanel .workflowCanvas');
  const trigger = canvas.locator('.workflowNode.trigger .workflowNodeBody');
  const action = canvas.locator('.workflowNode.action .workflowNodeBody');
  const logic = canvas.locator('.workflowNode.logic .workflowNodeBody');
  const end = canvas.locator('.workflowNode.end .workflowNodeBody');

  await trigger.click();
  await page
    .locator('.workflowInspector .workflowFilterEditor select')
    .first()
    .selectOption('interval');
  await page.getByRole('button', {name: '节点测试'}).click();
  await expect(page.getByText('时间触发器', {exact: true})).toBeVisible();
  await expect(page.getByText(/尚未注册/u)).toBeVisible();

  await action.click();
  await expect(page.getByText('动作试运行', {exact: true})).toBeVisible();
  await expect(page.getByText(/向本机 WebUI 真实发布一条通知/u)).toBeVisible();
  const actionResponse = page.waitForResponse(
    response =>
      response.url() === `${baseUrl}/api/actions/browser-notify/run` &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', {name: '试运行此动作'}).click();
  expect((await actionResponse).ok()).toBe(true);
  await expect(page.getByText('Notification action completed.')).toBeVisible();

  await logic.click();
  await expect(page.getByText('分支逻辑', {exact: true})).toBeVisible();
  await page.getByRole('button', {name: '计算分支'}).click();
  await expect(page.getByText(/结果将进入真分支/u)).toBeVisible();

  await end.click();
  await expect(page.getByText('结束点结果', {exact: true})).toBeVisible();
  await expect(page.getByText('Browser flow complete.')).toBeVisible();

  const edgeCount = await canvas.locator('.workflowEdges > g').count();
  await trigger.click();
  await page.getByRole('button', {name: '断开连接'}).click();
  await expect(canvas).toHaveClass(/disconnecting/u);
  await action.click();
  await expect(canvas.locator('.workflowEdges > g')).toHaveCount(edgeCount - 1);
  await expect(canvas).not.toHaveClass(/disconnecting/u);
});

test('persists a disabled automation after saving and reloading', async ({
  page,
}) => {
  let delayNextConfig = false;
  let rulePutAttempts = 0;
  let markStaleConfigCaptured;
  let releaseStaleConfig;
  const staleConfigCaptured = new Promise(resolve => {
    markStaleConfigCaptured = resolve;
  });
  const staleConfigGate = new Promise(resolve => {
    releaseStaleConfig = resolve;
  });
  await page.route(`${baseUrl}/api/config`, async route => {
    if (!delayNextConfig) {
      await route.continue();
      return;
    }
    delayNextConfig = false;
    const response = await route.fetch();
    markStaleConfigCaptured();
    await staleConfigGate;
    await route.fulfill({response});
  });
  await page.route(`${baseUrl}/api/rules`, async route => {
    if (route.request().method() === 'PUT') {
      rulePutAttempts += 1;
      if (rulePutAttempts === 1) {
        await route.abort('connectionreset');
        return;
      }
    }
    await route.continue();
  });
  await page.addInitScript(
    token => sessionStorage.setItem('las-token', token),
    testTokens.admin,
  );
  await page.goto(`${baseUrl}/ui/`);
  await page.getByRole('button', {name: '自动化'}).click();

  const editor = page.locator('.workflowInspector .inspectorEditorPanel');
  const enabled = editor.getByLabel('启用');
  await expect(enabled).toBeChecked();
  await expect(
    page.locator('.workflowCanvasPanel .workflowCanvas'),
  ).toBeVisible();

  delayNextConfig = true;
  await page.getByTitle('刷新').click();
  await staleConfigCaptured;
  await editor.locator('label.checkLabel', {hasText: '启用'}).click();
  await expect(enabled).not.toBeChecked();

  const saveResponse = page.waitForResponse(
    response =>
      response.url() === `${baseUrl}/api/rules` &&
      response.request().method() === 'PUT',
  );
  await editor.getByRole('button', {name: '保存'}).click();
  expect((await saveResponse).ok()).toBe(true);
  expect(rulePutAttempts).toBe(2);

  const configResponse = await apiFetch(baseUrl, '/api/config');
  expect(configResponse.ok).toBe(true);
  const config = await configResponse.json();
  expect(
    config.rules.find(rule => rule.id === 'browser-workflow')?.enabled,
  ).toBe(false);

  releaseStaleConfig();
  await page.waitForTimeout(100);
  const disabledRow = page
    .locator('.workflowConnectionTable .connectionRow.disabled')
    .filter({hasText: 'browser-workflow'});
  await expect(disabledRow).toHaveCount(1);
  await expect(disabledRow.getByText('已禁用')).toBeVisible();

  await page.reload();
  await page.getByRole('button', {name: '自动化'}).click();
  await expect(
    page.locator('.workflowInspector .inspectorEditorPanel').getByLabel('启用'),
  ).not.toBeChecked();
  await expect(
    page
      .locator('.workflowConnectionTable .connectionRow.disabled')
      .filter({hasText: 'browser-workflow'}),
  ).toHaveCount(1);
  await expect(
    page.locator('.workflowCanvasPanel .workflowCanvas'),
  ).toBeVisible();

  const restoredEnabled = page
    .locator('.workflowInspector .inspectorEditorPanel')
    .getByLabel('启用');
  await restoredEnabled.check();
  const restoreResponse = page.waitForResponse(
    response =>
      response.url() === `${baseUrl}/api/rules` &&
      response.request().method() === 'PUT',
  );
  await page
    .locator('.workflowInspector .inspectorEditorPanel')
    .getByRole('button', {name: '保存'})
    .click();
  expect((await restoreResponse).ok()).toBe(true);
});

test('keeps automation, endpoint, action, and log workspaces inside the desktop viewport', async ({
  page,
}) => {
  const logEvents = Array.from({length: 80}, (_, index) => ({
    id: `layout-event-${index}`,
    traceId: `layout-trace-${index}`,
    time: new Date(Date.now() - index * 1000).toISOString(),
    source: 'browser-http',
    kind: 'http.request',
    body: {index, message: `layout event ${index}`},
    meta: {path: '/message'},
  }));
  const logRuns = Array.from({length: 40}, (_, index) => ({
    id: `layout-run-${index}`,
    traceId: `layout-run-trace-${index}`,
    actionId: 'browser-notify',
    ruleId: 'browser-workflow',
    status: 'completed',
    queuedAt: new Date(Date.now() - (index + 80) * 1000).toISOString(),
    output: `layout run ${index}`,
  }));
  await page.route(/\/api\/events\?limit=80$/, route =>
    route.fulfill({json: logEvents}),
  );
  await page.route(/\/api\/runs\?limit=80$/, route =>
    route.fulfill({json: logRuns}),
  );
  await page.setViewportSize({width: 1600, height: 900});
  await page.addInitScript(token => {
    sessionStorage.setItem('las-token', token);
    localStorage.setItem(
      'las-panel-size:v2:logs-stream',
      JSON.stringify({width: 1500, height: 160}),
    );
    localStorage.setItem(
      'las-panel-size:v2:logs-trace',
      JSON.stringify({width: 980, height: 140}),
    );
  }, testTokens.admin);
  await page.goto(`${baseUrl}/ui/`);

  async function dragDivider(locator, deltaX, deltaY) {
    const bounds = await locator.boundingBox();
    if (!bounds) throw new Error('Split divider is not visible.');
    const x = bounds.x + bounds.width / 2;
    const y = bounds.y + bounds.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + deltaX, y + deltaY, {steps: 6});
    await page.mouse.up();
  }

  await page.getByRole('button', {name: '自动化'}).click();
  await page.waitForTimeout(550);
  const workflowLayout = await page.evaluate(() => {
    const rect = selector => {
      const bounds = document.querySelector(selector)?.getBoundingClientRect();
      return bounds
        ? {
            top: bounds.top,
            right: bounds.right,
            bottom: bounds.bottom,
            left: bounds.left,
            width: bounds.width,
            height: bounds.height,
          }
        : null;
    };
    return {
      viewportHeight: document.documentElement.clientHeight,
      workbench: rect('.workflowWorkbench'),
      sidebar: rect('.workflowSidebar'),
      registry: rect('.workflowRegistry'),
      inspector: rect('.workflowInspector'),
      canvas: rect('.workflowCanvasPanel'),
    };
  });
  expect(workflowLayout.workbench?.bottom).toBeLessThanOrEqual(
    workflowLayout.viewportHeight + 1,
  );
  expect(workflowLayout.registry?.left).toBeCloseTo(
    workflowLayout.inspector?.left ?? 0,
    0,
  );
  expect(workflowLayout.registry?.bottom).toBeLessThan(
    workflowLayout.inspector?.top ?? 0,
  );
  expect(workflowLayout.canvas?.left).toBeGreaterThan(
    workflowLayout.sidebar?.right ?? 0,
  );
  expect(workflowLayout.canvas?.height).toBeCloseTo(
    workflowLayout.sidebar?.height ?? 0,
    0,
  );
  const workflowRowDivider = page.locator(
    '.workflowRowDivider .splitDragHandle',
  );
  await dragDivider(workflowRowDivider, 0, -100);
  const resizedWorkflow = await page.evaluate(() => {
    const sidebar = document
      .querySelector('.workflowSidebar')
      ?.getBoundingClientRect();
    const registry = document
      .querySelector('.workflowRegistry')
      ?.getBoundingClientRect();
    const inspector = document
      .querySelector('.workflowInspector')
      ?.getBoundingClientRect();
    return {
      sidebarBottom: sidebar?.bottom ?? 0,
      registryHeight: registry?.height ?? 0,
      inspectorBottom: inspector?.bottom ?? 0,
    };
  });
  expect(resizedWorkflow.registryHeight).toBeLessThan(
    workflowLayout.registry?.height ?? Number.POSITIVE_INFINITY,
  );
  expect(resizedWorkflow.inspectorBottom).toBeCloseTo(
    resizedWorkflow.sidebarBottom,
    0,
  );
  await dragDivider(workflowRowDivider, 0, 80);
  const restoredWorkflow = await page.evaluate(() => ({
    sidebarBottom:
      document.querySelector('.workflowSidebar')?.getBoundingClientRect()
        .bottom ?? 0,
    registryHeight:
      document.querySelector('.workflowRegistry')?.getBoundingClientRect()
        .height ?? 0,
    inspectorBottom:
      document.querySelector('.workflowInspector')?.getBoundingClientRect()
        .bottom ?? 0,
  }));
  expect(restoredWorkflow.registryHeight).toBeGreaterThan(
    resizedWorkflow.registryHeight,
  );
  expect(restoredWorkflow.inspectorBottom).toBeCloseTo(
    restoredWorkflow.sidebarBottom,
    0,
  );
  const workflowSidebarWidthBefore = await page
    .locator('.workflowSidebar')
    .evaluate(element => element.getBoundingClientRect().width);
  await dragDivider(
    page.locator('.workflowColumnDivider .splitDragHandle'),
    -120,
    0,
  );
  await page.waitForTimeout(50);
  const narrowWorkflow = await page.evaluate(() => {
    const sidebar = document.querySelector('.workflowSidebar');
    const inspector = document.querySelector('.workflowInspector');
    const inspectorBounds = inspector?.getBoundingClientRect();
    const eventGrid = Array.from(
      document.querySelectorAll('.workflowCompactGrid'),
    ).find(
      element =>
        element.textContent?.includes('任意来源') &&
        element.textContent.includes('信息来源'),
    );
    const fields = Array.from(eventGrid?.children ?? [])
      .filter(element => element.matches('label'))
      .slice(0, 2)
      .map(element => element.getBoundingClientRect());
    const overflowingControls = inspector
      ? Array.from(
          inspector.querySelectorAll('input, select, textarea, button'),
        ).filter(
          element =>
            element.getBoundingClientRect().right >
            (inspectorBounds?.right ?? Number.POSITIVE_INFINITY) + 1,
        ).length
      : 0;
    return {
      sidebarWidth: sidebar?.getBoundingClientRect().width ?? 0,
      scrollWidth: inspector?.scrollWidth ?? 0,
      clientWidth: inspector?.clientWidth ?? 0,
      overflowingControls,
      firstFieldBottom: fields[0]?.bottom ?? 0,
      secondFieldTop: fields[1]?.top ?? 0,
    };
  });
  expect(narrowWorkflow.sidebarWidth).toBeLessThan(workflowSidebarWidthBefore);
  expect(narrowWorkflow.scrollWidth).toBeLessThanOrEqual(
    narrowWorkflow.clientWidth + 1,
  );
  expect(narrowWorkflow.overflowingControls).toBe(0);
  expect(narrowWorkflow.secondFieldTop).toBeGreaterThanOrEqual(
    narrowWorkflow.firstFieldBottom - 1,
  );

  await page.getByRole('button', {name: '端点'}).click();
  await page.waitForTimeout(550);
  const endpointLayout = await page.evaluate(() => {
    const workbench = document
      .querySelector('.endpointWorkbench')
      ?.getBoundingClientRect();
    const panels = [
      '.endpointCenter',
      '.endpointInspector',
      '.endpointSelectedLogs',
    ].map(selector => {
      const element = document.querySelector(selector);
      const rect = element?.getBoundingClientRect();
      return {
        bottom: rect?.bottom ?? 0,
        overflowY: element ? getComputedStyle(element).overflowY : '',
      };
    });
    return {
      viewportHeight: document.documentElement.clientHeight,
      bottom: workbench?.bottom ?? 0,
      panels,
    };
  });
  expect(endpointLayout.bottom).toBeLessThanOrEqual(
    endpointLayout.viewportHeight + 1,
  );
  expect(
    endpointLayout.panels.every(
      panel => panel.bottom <= endpointLayout.viewportHeight + 1,
    ),
  ).toBe(true);
  expect(endpointLayout.panels.map(panel => panel.overflowY)).toEqual([
    'hidden',
    'auto',
    'auto',
  ]);

  await page.getByRole('button', {name: '动作'}).click();
  await page.waitForTimeout(550);
  const actionInspectorHeightBefore = await page
    .locator('.actionInspectorSlot')
    .evaluate(element => element.getBoundingClientRect().height);
  await dragDivider(page.locator('.actionRowDivider .splitDragHandle'), 0, -80);
  const actionLayout = await page.evaluate(() => {
    const workbench = document
      .querySelector('.actionResourceWorkbench')
      ?.getBoundingClientRect();
    const registry = document.querySelector('.actionRegistry');
    const registrySlot = document
      .querySelector('.actionRegistrySlot')
      ?.getBoundingClientRect();
    const details = document
      .querySelector('.actionLibraryDetails')
      ?.getBoundingClientRect();
    const inspector = document
      .querySelector('.actionInspectorSlot')
      ?.getBoundingClientRect();
    const runtime = document
      .querySelector('.actionRuntimeSlot')
      ?.getBoundingClientRect();
    return {
      viewportHeight: document.documentElement.clientHeight,
      bottom: workbench?.bottom ?? 0,
      registryBottom: registrySlot?.bottom ?? 0,
      detailsBottom: details?.bottom ?? 0,
      inspectorHeight: inspector?.height ?? 0,
      inspectorBottom: inspector?.bottom ?? 0,
      runtimeTop: runtime?.top ?? 0,
      runtimeBottom: runtime?.bottom ?? 0,
      registryOverflow: registry ? getComputedStyle(registry).overflowY : '',
    };
  });
  expect(actionLayout.bottom).toBeLessThanOrEqual(
    actionLayout.viewportHeight + 1,
  );
  expect(actionLayout.registryOverflow).toBe('auto');
  expect(actionLayout.registryBottom).toBeCloseTo(actionLayout.bottom, 0);
  expect(actionLayout.detailsBottom).toBeCloseTo(actionLayout.bottom, 0);
  expect(actionLayout.runtimeBottom).toBeCloseTo(actionLayout.bottom, 0);
  expect(actionLayout.inspectorHeight).toBeLessThan(
    actionInspectorHeightBefore - 60,
  );
  expect(actionLayout.inspectorBottom).toBeLessThan(actionLayout.runtimeTop);

  await page.getByRole('button', {name: '日志'}).click();
  await page.waitForTimeout(550);
  await expect(page.locator('.logSummary')).toContainText('120');
  await dragDivider(page.locator('.logColumnDivider .splitDragHandle'), -80, 0);
  const logLayout = await page.evaluate(() => {
    const workbench = document
      .querySelector('.logWorkbench')
      ?.getBoundingClientRect();
    const stream = document
      .querySelector('.logStreamSlot')
      ?.getBoundingClientRect();
    const traceSlot = document
      .querySelector('.logTraceSlot')
      ?.getBoundingClientRect();
    const list = document.querySelector('.unifiedLogList');
    const trace = document.querySelector('.traceTimeline');
    const entryHeights = Array.from(
      document.querySelectorAll('.unifiedLogEntry'),
    )
      .slice(0, 8)
      .map(entry => entry.getBoundingClientRect().height);
    return {
      viewportHeight: document.documentElement.clientHeight,
      bottom: workbench?.bottom ?? 0,
      streamBottom: stream?.bottom ?? 0,
      traceBottom: traceSlot?.bottom ?? 0,
      listOverflow: list ? getComputedStyle(list).overflowY : '',
      listClientHeight: list?.clientHeight ?? 0,
      listScrollHeight: list?.scrollHeight ?? 0,
      traceOverflow: trace ? getComputedStyle(trace).overflowY : '',
      entryHeights,
      resizablePanels: document.querySelectorAll(
        '.logWorkbench > .resizablePanel',
      ).length,
      legacyStreamSize: localStorage.getItem('las-panel-size:v2:logs-stream'),
      legacyTraceSize: localStorage.getItem('las-panel-size:v2:logs-trace'),
    };
  });
  expect(logLayout.bottom).toBeLessThanOrEqual(logLayout.viewportHeight + 1);
  expect(logLayout.streamBottom).toBeCloseTo(logLayout.bottom, 0);
  expect(logLayout.traceBottom).toBeCloseTo(logLayout.bottom, 0);
  expect(logLayout.listOverflow).toBe('auto');
  expect(logLayout.listScrollHeight).toBeGreaterThan(
    logLayout.listClientHeight,
  );
  expect(logLayout.entryHeights.every(height => height >= 62)).toBe(true);
  expect(logLayout.traceOverflow).toBe('auto');
  expect(logLayout.resizablePanels).toBe(0);
  expect(logLayout.legacyStreamSize).toBeNull();
  expect(logLayout.legacyTraceSize).toBeNull();
});

test('persists a disabled endpoint after saving and reloading', async ({
  page,
}) => {
  await page.addInitScript(
    token => sessionStorage.setItem('las-token', token),
    testTokens.admin,
  );
  await page.goto(`${baseUrl}/ui/`);
  await page.getByRole('button', {name: '端点'}).click();

  const editor = page.locator('.inspectorEditorPanel');
  const enabled = editor.getByLabel('启用');
  await expect(enabled).toBeChecked();
  await enabled.uncheck();
  const saveResponse = page.waitForResponse(
    response =>
      response.url() === `${baseUrl}/api/endpoints` &&
      response.request().method() === 'PUT',
  );
  await editor.getByRole('button', {name: '保存'}).click();
  expect((await saveResponse).ok()).toBe(true);

  const configResponse = await apiFetch(baseUrl, '/api/config');
  expect(configResponse.ok).toBe(true);
  const config = await configResponse.json();
  expect(
    config.endpoints.httpServers.find(
      endpoint => endpoint.id === 'browser-http',
    )?.enabled,
  ).toBe(false);

  await page.reload();
  await page.getByRole('button', {name: '端点'}).click();
  const restoredEditor = page.locator('.inspectorEditorPanel');
  await expect(restoredEditor.getByLabel('启用')).not.toBeChecked();
  await expect(page.locator('.connectionRow.disabled')).toHaveCount(1);

  await restoredEditor.getByLabel('启用').check();
  const restoreResponse = page.waitForResponse(
    response =>
      response.url() === `${baseUrl}/api/endpoints` &&
      response.request().method() === 'PUT',
  );
  await restoredEditor.getByRole('button', {name: '保存'}).click();
  expect((await restoreResponse).ok()).toBe(true);
});

test('preserves false for action boolean options', async ({page}) => {
  await page.addInitScript(
    token => sessionStorage.setItem('las-token', token),
    testTokens.admin,
  );
  await page.goto(`${baseUrl}/ui/`);
  await page.getByRole('button', {name: '动作'}).click();
  await page.getByRole('button', {name: /^browser-command /u}).click();

  const editor = page.locator('.actionEditor');
  const allowConcurrent = editor.getByLabel('允许并发执行');
  await expect(allowConcurrent).toBeChecked();
  await allowConcurrent.uncheck();
  const saveResponse = page.waitForResponse(
    response =>
      response.url() === `${baseUrl}/api/actions` &&
      response.request().method() === 'PUT',
  );
  await editor.getByRole('button', {name: '保存'}).click();
  expect((await saveResponse).ok()).toBe(true);

  const configResponse = await apiFetch(baseUrl, '/api/config');
  expect(configResponse.ok).toBe(true);
  const config = await configResponse.json();
  expect(
    config.actions.find(action => action.id === 'browser-command')
      ?.allowConcurrent,
  ).toBe(false);

  await page.reload();
  await page.getByRole('button', {name: '动作'}).click();
  await page.getByRole('button', {name: /^browser-command /u}).click();
  const restoredEditor = page.locator('.actionEditor');
  await expect(restoredEditor.getByLabel('允许并发执行')).not.toBeChecked();

  await restoredEditor.getByLabel('允许并发执行').check();
  const restoreResponse = page.waitForResponse(
    response =>
      response.url() === `${baseUrl}/api/actions` &&
      response.request().method() === 'PUT',
  );
  await restoredEditor.getByRole('button', {name: '保存'}).click();
  expect((await restoreResponse).ok()).toBe(true);
});

test('reports an invalid token as authorization rather than disconnection', async ({
  page,
}) => {
  await page.setViewportSize({width: 1055, height: 933});
  await page.addInitScript(() => {
    sessionStorage.setItem('las-token', 'invalid-token');
  });
  await page.goto(`${baseUrl}/ui/`);
  await expect(
    page.getByRole('main').getByText('后端在线，部分功能需要有效的 API 令牌'),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', {name: '后端在线，接口访问需要授权'}),
  ).toBeVisible();
  const diagnostics = page.locator('.diagnosticsGroup');
  await expect(diagnostics).toContainText(/HTTP 401|HTTP 403/u);
  await diagnostics.locator(':scope > summary').click();
  const firstFailure = page.locator('.diagnosticsList details').first();
  await firstFailure.locator('summary').click();
  await expect(firstFailure).toContainText('x-las-token');
  await page.getByRole('button', {name: '输入令牌'}).click();
  await expect(page.getByLabel('API 令牌')).toBeFocused();
  const documentSize = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    height: document.documentElement.clientHeight,
    scrollHeight: document.documentElement.scrollHeight,
  }));
  expect(documentSize.scrollWidth).toBe(documentSize.width);
  expect(documentSize.scrollHeight).toBeGreaterThanOrEqual(documentSize.height);
});

test('keeps the overview dashboard within one desktop viewport', async ({
  page,
}) => {
  await page.setViewportSize({width: 1920, height: 800});
  await page.addInitScript(() => {
    const sizes = {
      'overview-traffic': {width: 1050, height: 120},
      'overview-queue': {width: 1050, height: 120},
      'overview-endpoints': {width: 610, height: 120},
      'overview-failures': {width: 610, height: 120},
    };
    Object.entries(sizes).forEach(([key, value]) => {
      localStorage.setItem(`las-panel-size:v2:${key}`, JSON.stringify(value));
    });
  });
  const now = Date.now();
  await page.route(/\/api\/events\?limit=80$/, route =>
    route.fulfill({
      json: [
        {
          id: 'overview-traffic-1',
          traceId: 'overview-traffic-trace-1',
          time: new Date(now - 60_000).toISOString(),
          source: 'http.server.browser-http',
          kind: 'http.request',
          body: {message: 'overview traffic one'},
          meta: {path: '/message'},
        },
        {
          id: 'overview-traffic-2',
          traceId: 'overview-traffic-trace-2',
          time: new Date(now - 180_000).toISOString(),
          source: 'http.server.browser-http',
          kind: 'http.request',
          body: {message: 'overview traffic two'},
          meta: {path: '/message'},
        },
      ],
    }),
  );
  await page.goto(`${baseUrl}/ui/`);
  await expect(page.getByRole('heading', {name: '概览'})).toBeVisible();
  await expect(page.locator('.trafficLegend .received')).toHaveText(
    /接收\s*2/u,
  );
  const trafficBucketCounts = await page
    .locator('.trafficBucketCount')
    .allTextContents();
  expect(
    trafficBucketCounts.reduce(
      (total, value) => total + (Number.parseInt(value, 10) || 0),
      0,
    ),
  ).toBe(2);
  await expect(page.locator('.overviewSignalList > div')).toHaveCount(3);
  await expect(page.locator('.overviewSummary .panelResizeHandle')).toHaveCount(
    0,
  );
  await expect(page.locator('.overviewMetricStrip')).toHaveCount(0);
  await expect(page.locator('.overviewPage .resizablePanel')).toHaveCount(0);
  await expect(page.locator('.executionOverviewTabs [role="tab"]')).toHaveCount(
    3,
  );
  await expect(page.locator('.overviewStatusTabs [role="tab"]')).toHaveCount(3);

  await page.getByRole('tab', {name: /自动化状态/u}).click();
  await expect(page.getByRole('tabpanel', {name: '自动化状态'})).toBeVisible();
  await page.getByRole('tab', {name: /动作状态/u}).click();
  await expect(page.getByRole('tabpanel', {name: '动作状态'})).toBeVisible();
  await page.getByRole('tab', {name: /端点状态/u}).click();
  await page.getByRole('tab', {name: /近期执行/u}).click();
  await expect(page.getByRole('tabpanel', {name: '近期执行'})).toBeVisible();
  await page.getByRole('tab', {name: /即将执行/u}).click();

  const layout = await page.evaluate(() => {
    const panels = Array.from(
      document.querySelectorAll(
        '.overviewOperationsGrid > .overviewMonitorColumn > section',
      ),
    );
    const rectangles = panels.map(panel => {
      const rect = panel.getBoundingClientRect();
      return {
        className: panel.className,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        left: rect.left,
        height: rect.height,
      };
    });
    const overlaps = [];
    for (let index = 0; index < rectangles.length; index += 1) {
      for (let other = index + 1; other < rectangles.length; other += 1) {
        const first = rectangles[index];
        const second = rectangles[other];
        if (
          first.right > second.left + 1 &&
          second.right > first.left + 1 &&
          first.bottom > second.top + 1 &&
          second.bottom > first.top + 1
        ) {
          overlaps.push([first.className, second.className]);
        }
      }
    }
    const summary = document.querySelector('.overviewSummary');
    const summaryRect = summary?.getBoundingClientRect();
    const summaryStyle = summary ? getComputedStyle(summary) : null;
    const overview = document.querySelector('.overviewPage');
    const operations = document.querySelector('.overviewOperationsGrid');
    const traffic = document.querySelector('.trafficModule');
    const execution = document.querySelector('.executionOverviewModule');
    const status = document.querySelector('.overviewStatusModule');
    const signalBoard = document.querySelector('.overviewSignalBoard');
    const signalItems = Array.from(
      document.querySelectorAll('.overviewSignalList > div'),
    );
    const scrollRegions = Array.from(
      document.querySelectorAll('.overviewExecutionList, .overviewStatusList'),
    ).map(region => ({
      className: region.className,
      overflowY: getComputedStyle(region).overflowY,
      bottom: region.getBoundingClientRect().bottom,
      parentBottom: region.parentElement?.getBoundingClientRect().bottom ?? 0,
    }));
    return {
      viewportWidth: document.documentElement.clientWidth,
      documentWidth: document.documentElement.scrollWidth,
      documentHeight: document.documentElement.scrollHeight,
      viewportHeight: document.documentElement.clientHeight,
      panels: rectangles,
      overlaps,
      overviewBottom: overview?.getBoundingClientRect().bottom,
      operationsBottom: operations?.getBoundingClientRect().bottom,
      trafficHeight: traffic?.getBoundingClientRect().height,
      executionBottom: execution?.getBoundingClientRect().bottom,
      statusBottom: status?.getBoundingClientRect().bottom,
      signalBoardBottom: signalBoard?.getBoundingClientRect().bottom,
      signalItemBottoms: signalItems.map(
        item => item.getBoundingClientRect().bottom,
      ),
      scrollRegions,
      summary: summaryRect
        ? {
            bottom: summaryRect.bottom,
            height: summaryRect.height,
            overflowY: summaryStyle?.overflowY,
          }
        : null,
    };
  });

  expect(layout.documentWidth).toBe(layout.viewportWidth);
  expect(layout.documentHeight).toBeLessThanOrEqual(layout.viewportHeight + 1);
  expect(layout.panels).toHaveLength(3);
  expect(layout.overlaps).toEqual([]);
  expect(layout.summary?.height).toBeGreaterThanOrEqual(180);
  expect(layout.summary?.overflowY).not.toMatch(/auto|scroll/u);
  expect(layout.summary?.bottom).toBeLessThanOrEqual(
    Math.min(...layout.panels.map(panel => panel.top)),
  );
  expect(layout.overviewBottom).toBeLessThanOrEqual(layout.viewportHeight);
  expect(layout.operationsBottom).toBeLessThanOrEqual(layout.viewportHeight);
  expect(layout.trafficHeight).toBeLessThanOrEqual(140);
  expect(layout.executionBottom).toBeCloseTo(layout.operationsBottom ?? 0, 0);
  expect(layout.statusBottom).toBeCloseTo(layout.operationsBottom ?? 0, 0);
  expect(Math.max(...layout.signalItemBottoms)).toBeLessThanOrEqual(
    layout.signalBoardBottom ?? 0,
  );
  for (const region of layout.scrollRegions) {
    expect(region.overflowY).toBe('auto');
    expect(region.bottom).toBeLessThanOrEqual(region.parentBottom + 1);
  }
});
