const fs = require('node:fs');
const path = require('node:path');
const [stage, ...args] = process.argv.slice(2);
fs.appendFileSync(path.join(process.env.SOURVIA_BUILD_TEST_ROOT, 'calls.jsonl'), JSON.stringify({ stage, args, cwd: process.cwd() }) + '\n');
if (stage === 'premake') {
  fs.mkdirSync('generated', { recursive: true });
  fs.writeFileSync('generated/Makefile', 'fixture');
  if (args.includes('vs2022')) {
    fs.writeFileSync('generated/Fixture.sln', 'Project("{GUID}") = "app", "App.vcxproj", "{APP}"\nEndProject\n');
    fs.writeFileSync('generated/App.vcxproj', '<Project />');
  }
  console.log('Generated Makefiles');
} else if (stage === 'msbuild') {
  if (args.some(arg => arg.startsWith('/getProperty:'))) {
    console.log(JSON.stringify({ Properties: {
      ConfigurationType: 'Application', TargetPath: path.join(process.env.SOURVIA_BUILD_TEST_ROOT, 'program'),
      LocalDebuggerWorkingDirectory: process.cwd(),
    } }));
  } else if (args.includes('/t:fail')) {
    process.stderr.write(`  2>${path.join(process.env.SOURVIA_BUILD_TEST_ROOT, 'main.cpp')}(2,5): error C2065: MSVC error\n`);
    process.exitCode = 1;
  } else console.log('MSBuild complete');
} else if (stage === 'make') {
  if (args.includes('fail')) {
    process.stderr.write('../main.cpp:2:5: error: unknown identifier\n');
    process.exitCode = 2;
  } else if (args.includes('wait')) {
    console.log('BUILD WAITING');
    setInterval(() => {}, 1000);
  } else {
    console.log('Build complete');
  }
} else {
  console.log('PROGRAM OUTPUT: ' + args.join('|'));
  if (args.includes('wait')) setInterval(() => {}, 1000);
}
