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
function key(keyCode, modifiers = []) {
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
}
async function field(label, value) {
  await window.webContents.executeJavaScript(`(() => {
    const input = [...document.querySelectorAll('.run-settings label')].find(item => item.firstChild.textContent === ${JSON.stringify(label)}).querySelector('input,textarea');
    Object.getOwnPropertyDescriptor(input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
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
    await fs.writeFile(path.join(project, 'src', 'definition.hpp'), 'int sampleValue = 0;\n');
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
    key('F12');
    await waitFor('document.querySelector(".tab.active").textContent.includes("definition.hpp")', 'F12 did not open the definition in another file');
    await waitFor('document.querySelector(".statusbar").textContent.includes("Ln 1, Col 5")', 'Definition selection was not applied');
    await shortcut('w');
    await waitFor('document.querySelectorAll(".tab").length === 1', 'Definition tab did not close');
    key('Home', ['control']);
    key('Space', ['control']);
    await waitFor('!!document.querySelector(".suggest-widget.visible")?.textContent.includes("sampleValue")', 'LSP completion did not appear');
    key('Escape');
    key('K', ['control']); key('I', ['control']);
    await waitFor('!!document.querySelector(".monaco-hover")?.textContent.includes("Symbol info")', 'LSP hover did not appear');
    key('Escape');
    // Use actual mouse input to exercise Monaco's Ctrl-click definition gesture.
    const point = await window.webContents.executeJavaScript(`(() => {
      const walker = document.createTreeWalker(document.querySelector('.view-line'), NodeFilter.SHOW_TEXT);
      let text;
      while (text = walker.nextNode()) {
        const offset = text.textContent.indexOf('main');
        if (offset < 0) continue;
        const range = document.createRange(); range.setStart(text, offset); range.setEnd(text, offset + 4);
        const rect = range.getBoundingClientRect(); return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
      }
    })()`);
    window.webContents.sendInputEvent({ type: 'mouseMove', ...point, modifiers: ['control'] });
    await new Promise(resolve => setTimeout(resolve, 350));
    window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point, modifiers: ['control'] });
    window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point, modifiers: ['control'] });
    await waitFor('document.querySelector(".tab.active").textContent.includes("definition.hpp")', 'Ctrl-click did not navigate to the definition');
    await shortcut('w');
    await waitFor('document.querySelectorAll(".tab").length === 1', 'Ctrl-click definition tab did not close');
    key('Home', ['control']);
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
    await fs.writeFile(path.join(project, 'build.cjs'), `const fs = require('node:fs');
      if (fs.existsSync('fail-build')) { console.error('src/main.cpp:1:5: error: smoke build failure'); process.exit(2); }
      console.log('SMOKE BUILD SUCCESS');`);
    await fs.writeFile(path.join(project, 'program.cjs'), "console.log('SMOKE PROGRAM SUCCESS');");
    const program = process.platform === 'win32' ? 'runner.exe' : 'runner';
    await fs.copyFile(process.env.SOURVIA_TEST_NODE, path.join(project, program));
    if (process.platform !== 'win32') await fs.chmod(path.join(project, program), 0o755);
    await click('.run-button');
    await waitFor('!!document.querySelector(".run-settings[open]")', 'Run without an executable did not open settings');
    await field('Make executable', process.env.SOURVIA_TEST_NODE);
    await field('Make target (optional)', 'build.cjs');
    await field('Program executable', program);
    await field('Program arguments (one per line)', 'program.cjs');
    await click('.run-settings button[type="submit"]');
    await waitFor('!document.querySelector(".run-settings")', 'Run settings did not save');
    await window.webContents.executeJavaScript('document.querySelector(".monaco-editor textarea, .monaco-editor .native-edit-context").focus()');
    key('Home', ['control']);
    await window.webContents.insertText('// saved by Run\n');
    await waitFor('!!document.querySelector(".dirty")', 'Build autosave setup failed');
    await click('.run-button');
    await waitFor('document.querySelector(".build-status")?.textContent === "Program exited successfully."', 'Build and Run did not complete');
    assert.match(await window.webContents.executeJavaScript('document.querySelector(".build-output").textContent'), /SMOKE BUILD SUCCESS[\s\S]*SMOKE PROGRAM SUCCESS/);
    assert.match(await fs.readFile(path.join(project, 'src', 'main.cpp'), 'utf8'), /saved by Run/);
    await fs.writeFile(path.join(project, 'fail-build'), '');
    await click('.run-button');
    await waitFor('!!document.querySelector(".build-status.failed")', 'Build failure was not shown');
    assert.doesNotMatch(await window.webContents.executeJavaScript('document.querySelector(".build-output").textContent'), /SMOKE PROGRAM SUCCESS/);
    await window.webContents.executeJavaScript('[...document.querySelectorAll(".output-toolbar [role=tab]")].find(item => item.textContent.startsWith("Problems")).click()');
    await waitFor('[...document.querySelectorAll(".problem-row")].some(item => item.textContent.includes("smoke build failure"))', 'Compiler error missing in Problems');
    await window.webContents.executeJavaScript('[...document.querySelectorAll(".problem-row")].find(item => item.textContent.includes("smoke build failure")).click()');
    await waitFor('document.querySelector(".statusbar").textContent.includes("Ln 1, Col 5")', 'Problem navigation did not move the cursor');
    await click('[aria-label="Run settings"]');
    await window.webContents.executeJavaScript(`(() => {
      const system = document.querySelector('.run-settings select');
      system.value = 'premake'; system.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await waitFor('document.querySelectorAll(".run-settings select").length === 2', 'Premake generator selector did not appear');
    await window.webContents.executeJavaScript(`(() => {
      const generator = document.querySelectorAll('.run-settings select')[1];
      generator.value = 'vs2022'; generator.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await waitFor('document.querySelector(".run-settings").textContent.includes("MSBuild executable") && !document.querySelector(".run-settings").textContent.includes("Make executable")', 'Visual Studio settings did not select the MSBuild controls');
    await field('Program executable', '');
    await field('Premake executable', 'sourvia-smoke-missing-premake');
    await click('.run-settings button[type="submit"]');
    await waitFor('!document.querySelector(".run-settings")', 'Automatic run settings did not save');
    await fs.writeFile(path.join(project, 'premake5.lua'), '-- smoke fixture');
    await click('.run-button');
    await waitFor('document.querySelector(".build-output")?.textContent.includes("sourvia-smoke-missing-premake")', 'Run without an executable did not reach the Premake build');
    await waitFor('!!document.querySelector(".build-status.failed")', 'Missing Premake should report a build error');
    assert.equal(await window.webContents.executeJavaScript('!!document.querySelector(".run-settings")'), false, 'Native Run must not reopen settings just because the executable is automatic');
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
    console.log('PASS Electron: sandbox, graph, navigation, Monaco, save, tabs, C++/HLSL diagnostics, F12, Ctrl-click, hover, completion, Run settings, build/run, autosave, compiler errors and problem navigation.');
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
