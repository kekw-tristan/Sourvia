const { app, BrowserWindow, dialog } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');

// Exercise the production app and IPC with deterministic native-dialog responses.
BrowserWindow.prototype.show = function () { this.webContents.setBackgroundThrottling(false); };
let response = 2;
dialog.showMessageBox = async () => ({ response });
dialog.showMessageBoxSync = () => 0;
let temp;
let window;
const errors = [];
const timeout = setTimeout(() => { console.error('Electron smoke test timed out'); app.exit(1); }, 45000);
async function waitFor(expression, message) {
  for (let i = 0; i < 150; i++) {
    if (await window.webContents.executeJavaScript(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(message);
}
async function click(selector) {
  await window.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(selector)}).click()`);
}
async function node(name) {
  await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.react-flow__node')).find(node => node.querySelector('.node-label')?.firstChild.textContent === ${JSON.stringify(name)}).click()`);
}
async function shortcut(key, modifiers = {}) {
  await window.webContents.executeJavaScript(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, ctrlKey: true, ...${JSON.stringify(modifiers)}, bubbles: true, cancelable: true }))`);
}
app.whenReady().then(async () => {
  try {
    temp = await fs.mkdtemp(path.join(os.tmpdir(), 'sourvia-electron-'));
    const project = path.join(temp, 'project');
    await fs.mkdir(project);
    await fs.mkdir(path.join(project, 'src'));
    await fs.mkdir(path.join(project, 'shaders'));
    await fs.mkdir(path.join(project, '.git'));
    await fs.writeFile(path.join(project, 'readme.txt'), 'Sourvia smoke test\n');
    await fs.writeFile(path.join(project, 'src', 'main.cpp'), 'int main() { return 0; }\n');
    await fs.writeFile(path.join(project, 'shaders', 'main.hlsl'), 'float4 main() { return 0; }\n');
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [project] });
    const { languageServers } = require('../dist/main/languageServer/config.js');
    for (const config of languageServers) {
      config.command = process.env.SOURVIA_TEST_NODE;
      config.args = [path.resolve('tests/fixtures/lsp-server.cjs'), path.join(temp, `${config.id}.jsonl`)];
    }
    app.on('browser-window-created', (_event, created) => {
      window = created;
      created.webContents.on('console-message', details => {
        if (details.level === 'error') errors.push(details.message);
      });
      created.webContents.on('preload-error', (_event, _file, error) => errors.push(error.message));
    });
    require('../dist/main/main.js');
    app.removeAllListeners('window-all-closed');
    while (!window) await new Promise(resolve => setTimeout(resolve, 20));
    await new Promise(resolve => window.webContents.once('did-finish-load', resolve));
    await waitFor('!!document.querySelector(".open-button")', 'Application did not render');
    assert.equal(await window.webContents.executeJavaScript('typeof require'), 'undefined');
    assert.equal(window.webContents.getLastWebPreferences().sandbox, true);
    await click('.open-button');
    await waitFor('document.querySelectorAll(".react-flow__node").length === 4', 'Project graph did not load or ignored .git was shown');
    await node('src');
    await waitFor('document.querySelector(".breadcrumb").textContent.endsWith("src")', 'Folder navigation failed');
    await node('main.cpp');
    await waitFor('document.querySelectorAll(".monaco-editor .view-line").length > 0', 'Monaco did not render');
    await waitFor('!!document.querySelector(".squiggly-error")', 'LSP diagnostics did not reach Monaco');
    await window.webContents.executeJavaScript('document.querySelector(".monaco-editor textarea, .monaco-editor .native-edit-context").focus()');
    await window.webContents.insertText('// edited by smoke test\n');
    await waitFor('!!document.querySelector(".dirty")', 'Typing did not modify the document');
    await shortcut('s');
    await waitFor('!document.querySelector(".dirty")', 'Save did not clear modified state');
    assert.match(await fs.readFile(path.join(project, 'src', 'main.cpp'), 'utf8'), /edited by smoke test/);
    await click('[aria-label="Parent folder"]');
    await waitFor('document.querySelectorAll(".react-flow__node").length === 4', 'Parent navigation failed');
    await node('readme.txt');
    await waitFor('document.querySelectorAll(".tab").length === 2', 'Second file did not open');
    await shortcut('Tab');
    await waitFor('document.querySelector(".tab.active").textContent.includes("main.cpp")', 'Tab cycling failed');
    await click('[aria-label="Previous folder"]');
    await waitFor('document.querySelector(".breadcrumb").textContent.endsWith("src")', 'Back navigation failed');
    await click('[aria-label="Parent folder"]');
    await waitFor('document.querySelectorAll(".react-flow__node").length === 4', 'Return to root failed');
    await node('shaders');
    await waitFor('document.querySelector(".breadcrumb").textContent.endsWith("shaders")', 'Shader folder failed');
    await node('main.hlsl');
    await waitFor('document.querySelector(".tab.active").textContent.includes("main.hlsl")', 'HLSL file did not open');
    await waitFor('document.querySelector(".statusbar").textContent.includes("hlsl: ready")', 'HLSL server did not start');
    await window.webContents.insertText('// hlsl edit\n');
    await waitFor('!!document.querySelector(".dirty")', 'HLSL edit failed');
    response = 2;
    await shortcut('w');
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(await window.webContents.executeJavaScript('document.querySelectorAll(".tab").length'), 3);
    response = 0;
    await shortcut('w');
    await waitFor('document.querySelectorAll(".tab").length === 2', 'Save and close failed');
    assert.match(await fs.readFile(path.join(project, 'shaders', 'main.hlsl'), 'utf8'), /hlsl edit/);
    assert.equal(await window.webContents.executeJavaScript(`window.desktop.listDirectory(${JSON.stringify(temp)}).then(() => false, () => true)`), true);
    await click('[aria-label="Parent folder"]');
    await waitFor('document.querySelectorAll(".react-flow__node").length === 4', 'Final project overview failed');
    await click('.tab button[role="tab"]');
    await waitFor('document.querySelector(".tab.active").textContent.includes("main.cpp")', 'Return to C++ tab failed');
    await fs.mkdir('test-results', { recursive: true });
    window.webContents.invalidate();
    await window.webContents.capturePage();
    await new Promise(resolve => setTimeout(resolve, 300));
    await waitFor(`(() => {
      const center = document.querySelector('.graph-node.center').getBoundingClientRect();
      const canvas = document.querySelector('.react-flow').getBoundingClientRect();
      return Math.abs(center.x + center.width / 2 - canvas.x - canvas.width / 2) < 3 &&
        Math.abs(center.y + center.height / 2 - canvas.y - canvas.height / 2) < 3;
    })()`, 'Current folder was not centered in the graph');
    await fs.writeFile('test-results/editor.png', (await window.webContents.capturePage()).toPNG());
    assert.deepEqual(errors, []);
    console.log('PASS Electron: sandbox, graph, navigation, Monaco, typing, save, tabs, dirty prompts, C++/HLSL diagnostics and project boundary.');
    // Closing documents flushes each server queue before exiting.
    await window.webContents.executeJavaScript(`Promise.all([window.desktop.closeDocument(${JSON.stringify(path.join(project, 'src', 'main.cpp'))}), window.desktop.closeDocument(${JSON.stringify(path.join(project, 'readme.txt'))})])`);
    window.destroy();
    clearTimeout(timeout);
    // before-quit in production waits for LSP shutdown; delete fixtures after children exit.
    app.on('will-quit', () => {
      if (temp && path.dirname(temp) === os.tmpdir() && path.basename(temp).startsWith('sourvia-electron-')) require('node:fs').rmSync(temp, { recursive: true, force: true });
    });
    app.quit();
  } catch (error) {
    console.error(error, errors);
    clearTimeout(timeout);
    if (window && !window.isDestroyed()) window.destroy();
    app.once('will-quit', () => app.exit(1));
    app.quit();
  }
});
