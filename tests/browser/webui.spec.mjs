import {expect, test} from '@playwright/test';
import {
  allocatePort,
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

test('reports an invalid token as authorization rather than disconnection', async ({
  page,
}) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('las-token', 'invalid-token');
  });
  await page.goto(`${baseUrl}/ui/`);
  await expect(
    page.getByText('后端在线，部分功能需要有效的 API 令牌'),
  ).toBeVisible();
  await expect(page.getByRole('heading', {name: '本地接口诊断'})).toBeVisible();
  await expect(page.locator('.diagnosticsList details').first()).toContainText(
    /HTTP 401|HTTP 403/u,
  );
});
