import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {
  calculatePanelSize,
  panelSizeStorageKey,
  parsePanelSize,
} from '../src/panelSizing.ts';
import {
  calculateSplitSize,
  clampSplitSize,
  parseActionLayout,
} from '../src/splitSizing.ts';

const bounds = {
  clientX: 100,
  clientY: 100,
  width: 500,
  height: 300,
  minWidth: 240,
  minHeight: 120,
  maxWidth: 900,
};

test('changes width and height in the same drag', () => {
  assert.deepEqual(calculatePanelSize(bounds, 180, 160), {
    width: 580,
    height: 360,
  });
});

test('continues changing height when width reaches its boundary', () => {
  assert.deepEqual(calculatePanelSize(bounds, 900, 240), {
    width: 900,
    height: 440,
  });
});

test('keeps persisted sizes isolated by panel key', () => {
  assert.notEqual(
    panelSizeStorageKey('endpoints-registry'),
    panelSizeStorageKey('endpoints-logs'),
  );
  assert.equal(
    panelSizeStorageKey('endpoints-registry'),
    'las-panel-size:v2:endpoints-registry',
  );
});

test('does not reuse a static storage key across panel instances', async () => {
  const sources = await Promise.all([
    readFile(new URL('../src/main.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/WorkflowWorkspace.tsx', import.meta.url), 'utf8'),
  ]);
  const keys = sources.flatMap(source =>
    [...source.matchAll(/storageKey="([^"]+)"/g)].map(match => match[1]),
  );
  const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index);
  assert.deepEqual(duplicates, []);
});

test('rejects incomplete or invalid persisted dimensions', () => {
  assert.deepEqual(parsePanelSize('{"width":500,"height":300}'), {
    width: 500,
    height: 300,
  });
  assert.equal(parsePanelSize('{"width":500}'), null);
  assert.equal(parsePanelSize('{"width":null,"height":300}'), null);
  assert.equal(parsePanelSize('not-json'), null);
});

test('uses a dedicated bounded split layout for logs', async () => {
  const [css, source, layoutSource] = await Promise.all([
    readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
    readFile(new URL('../src/main.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/LogSplitLayout.tsx', import.meta.url), 'utf8'),
  ]);
  const block = [...css.matchAll(/\.logWorkbench \{([^}]+)\}/g)]
    .map(match => match[1])
    .find(candidate => /display:\s*grid/.test(candidate));
  assert.ok(block, 'missing .logWorkbench style block');
  assert.match(block, /display:\s*grid/);
  assert.match(block, /--log-stream-width/);
  assert.match(block, /align-items:\s*stretch/);
  assert.match(block, /overflow:\s*hidden/);
  assert.match(source, /<LogSplitLayout/);
  assert.doesNotMatch(source, /storageKey="logs-(stream|trace)"/);
  assert.equal((layoutSource.match(/orientation="vertical"/g) ?? []).length, 1);
  assert.match(layoutSource, /logs-stream/);
  assert.match(layoutSource, /logs-trace/);
});

test('isolates the action detail panels from each other', async () => {
  const [css, source] = await Promise.all([
    readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
    readFile(new URL('../src/ActionSplitLayout.tsx', import.meta.url), 'utf8'),
  ]);
  const workbench = css.match(/\.actionResourceWorkbench \{([^}]+)\}/)?.[1];
  assert.ok(workbench, 'missing .actionResourceWorkbench style block');
  assert.match(workbench, /display:\s*grid/);
  assert.match(workbench, /--action-registry-width/);
  assert.match(workbench, /--action-inspector-height/);
  assert.match(workbench, /overflow:\s*hidden/);
  const block = css.match(/\.actionLibraryDetails \{([^}]+)\}/)?.[1];
  assert.ok(block, 'missing .actionLibraryDetails style block');
  assert.match(block, /display:\s*grid/);
  assert.match(block, /var\(--action-inspector-height\)/);
  assert.match(block, /gap:\s*0/);
  assert.match(block, /contain:\s*inline-size/);
  assert.match(block, /overflow:\s*hidden/);
  assert.match(block, /minmax\(0,\s*1fr\)/);
  assert.doesNotMatch(block, /0\.85fr/);
  const rowDivider = css.match(/\.actionRowDivider \{([^}]+)\}/)?.[1];
  assert.ok(rowDivider, 'missing .actionRowDivider style block');
  assert.match(rowDivider, /grid-column:\s*1/);
  assert.match(rowDivider, /grid-row:\s*2/);
  assert.match(
    source,
    /className="actionLibraryDetails"[\s\S]+className="actionRowDivider"/,
  );
});

test('uses one fixed column and row divider for automation tasks', async () => {
  const [css, source, layoutSource] = await Promise.all([
    readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
    readFile(new URL('../src/WorkflowWorkspace.tsx', import.meta.url), 'utf8'),
    readFile(
      new URL('../src/WorkflowSplitLayout.tsx', import.meta.url),
      'utf8',
    ),
  ]);
  const block = css.match(/\.workflowWorkbench \{([^}]+)\}/)?.[1];
  assert.ok(block, 'missing .workflowWorkbench style block');
  assert.match(block, /display:\s*grid/);
  assert.match(block, /--workflow-sidebar-width/);
  assert.match(block, /--workflow-registry-height/);
  assert.match(source, /<WorkflowSplitLayout/);
  assert.doesNotMatch(
    source,
    /storageKey="workflow-(registry|inspector|canvas)"/,
  );
  assert.equal((layoutSource.match(/orientation="vertical"/g) ?? []).length, 1);
  assert.equal(
    (layoutSource.match(/orientation="horizontal"/g) ?? []).length,
    1,
  );
  assert.match(
    layoutSource,
    /className="workflowSidebar"[\s\S]+className="workflowRegistry"[\s\S]+className="workflowRowDivider"[\s\S]+className="workflowInspector"/,
  );
  assert.match(
    layoutSource,
    /className="workflowColumnDivider"[\s\S]+className="workflowCanvasPanel"/,
  );
  const sidebar = css.match(/\.workflowSidebar \{([^}]+)\}/)?.[1];
  assert.ok(sidebar, 'missing .workflowSidebar style block');
  assert.match(sidebar, /minmax\(0,\s*1fr\)/);
  assert.doesNotMatch(sidebar, /0\.58fr/);
  assert.match(css, /@container workflow-inspector \(max-width:\s*460px\)/);
});

test('uses two fixed column dividers for endpoint panels', async () => {
  const [css, source, layoutSource, dividerSource] = await Promise.all([
    readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
    readFile(new URL('../src/main.tsx', import.meta.url), 'utf8'),
    readFile(
      new URL('../src/EndpointSplitLayout.tsx', import.meta.url),
      'utf8',
    ),
    readFile(new URL('../src/SplitDivider.tsx', import.meta.url), 'utf8'),
  ]);
  const block = css.match(/\.endpointWorkbench \{([^}]+)\}/)?.[1];
  assert.ok(block, 'missing .endpointWorkbench style block');
  assert.match(block, /display:\s*grid/);
  assert.match(block, /--endpoint-registry-width/);
  assert.match(block, /--endpoint-inspector-width/);
  assert.match(source, /<EndpointSplitLayout/);
  assert.doesNotMatch(
    source,
    /storageKey="endpoints-(registry|inspector|logs)"/,
  );
  assert.equal((layoutSource.match(/orientation="vertical"/g) ?? []).length, 2);
  assert.match(
    source,
    /className="connectionTable"[\s\S]+className="connectionSummary"[\s\S]+className="connectionRows"/,
  );
  assert.doesNotMatch(dividerSource, /splitLayoutReset|RotateCcw/);
  assert.doesNotMatch(css, /\.splitLayoutReset/);
});

test('clamps action split controls without resizing child panels', () => {
  const bounds = {
    startCoordinate: 100,
    startSize: 420,
    minimum: 320,
    maximum: 680,
  };
  assert.equal(calculateSplitSize(bounds, 180), 500);
  assert.equal(calculateSplitSize(bounds, -100), 320);
  assert.equal(calculateSplitSize(bounds, 900), 680);
  assert.equal(clampSplitSize(740, 320, 680), 680);
  assert.equal(clampSplitSize(200, 320, 680), 320);
});

test('loads only valid persisted action split dimensions', () => {
  assert.deepEqual(
    parseActionLayout('{"registryWidth":430,"inspectorHeight":360}'),
    {registryWidth: 430, inspectorHeight: 360},
  );
  assert.deepEqual(
    parseActionLayout('{"registryWidth":-1,"inspectorHeight":240}'),
    {inspectorHeight: 240},
  );
  assert.deepEqual(parseActionLayout('invalid'), {});
});
