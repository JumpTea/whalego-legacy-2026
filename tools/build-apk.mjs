import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ANDROID = path.join(ROOT, 'android');
const BUILD = path.join(ROOT, 'build');
const DIST = path.join(ROOT, 'dist');
const IS_WIN = process.platform === 'win32';

const fail = (message) => {
  console.error('error: ' + message);
  process.exit(1);
};

const run = (bin, args, cwd = ROOT) => {
  console.log('>', path.basename(bin), args.join(' '));
  execFileSync(bin, args, {
    cwd,
    stdio: 'inherit',
    shell: IS_WIN && bin.toLowerCase().endsWith('.bat')
  });
};

const mk = (p) => fs.mkdirSync(p, { recursive: true });

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name);
  return entry.isDirectory() ? walk(full) : [full];
});

const numeric = (name) => (name.match(/\d+/g) || []).map(Number);
const compareVersion = (a, b) => {
  const left = numeric(a);
  const right = numeric(b);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i++) {
    const diff = (right[i] || 0) - (left[i] || 0);
    if (diff !== 0) return diff;
  }
  return a.localeCompare(b);
};

const newestDir = (parent, prefix = '') => {
  if (!fs.existsSync(parent)) return null;
  const names = fs.readdirSync(parent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
    .map((entry) => entry.name)
    .sort(compareVersion);
  return names.length ? path.join(parent, names[0]) : null;
};

const readVersion = () => {
  const file = path.join(ROOT, 'version.properties');
  if (!fs.existsSync(file)) fail('缺少 version.properties');
  const values = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^([A-Za-z]+)\s*=\s*(.+)$/.exec(line.trim());
    if (match) values[match[1]] = match[2].trim();
  }
  if (!values.versionCode || !values.versionName) {
    fail('version.properties 需要 versionCode 与 versionName');
  }
  if (!/^\d+$/.test(values.versionCode)) fail('versionCode 必须是整数');
  return values;
};

const version = readVersion();

const SDK = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME;
if (!SDK || !fs.existsSync(SDK)) {
  fail('设置 ANDROID_SDK_ROOT（或 ANDROID_HOME）指向 Android SDK 后再构建');
}
const BUILD_TOOLS = newestDir(path.join(SDK, 'build-tools'));
if (!BUILD_TOOLS) fail('Android SDK 里没有 build-tools');
const PLATFORM = newestDir(path.join(SDK, 'platforms'), 'android-');
if (!PLATFORM) fail('Android SDK 里没有 platforms/android-*');
const JAR = path.join(PLATFORM, 'android.jar');
if (!fs.existsSync(JAR)) fail('找不到 ' + JAR);

const tool = (name) => {
  if (!IS_WIN) return path.join(BUILD_TOOLS, name);
  const exe = path.join(BUILD_TOOLS, name + '.exe');
  return fs.existsSync(exe) ? exe : path.join(BUILD_TOOLS, name + '.bat');
};

const JAVA_HOME = process.env.JAVA_HOME || '';
const javaTool = (name) => {
  const exe = IS_WIN ? name + '.exe' : name;
  return JAVA_HOME ? path.join(JAVA_HOME, 'bin', exe) : name;
};

const keystore = process.env.WHALEGO_KEYSTORE
  || path.join(ROOT, '.signing', 'debug.keystore');
const storepass = process.env.WHALEGO_KEYSTORE_PASS || 'android';
const keyalias = process.env.WHALEGO_KEY_ALIAS || 'whalego';
const keypass = process.env.WHALEGO_KEY_PASS || storepass;

console.log('sdk       ', SDK);
console.log('build-tools', path.basename(BUILD_TOOLS));
console.log('platform  ', path.basename(PLATFORM));
console.log('version   ', version.versionName, '(' + version.versionCode + ')');

fs.rmSync(BUILD, { recursive: true, force: true });
fs.rmSync(DIST, { recursive: true, force: true });
for (const dir of ['res', 'gen', 'classes', 'dex']) mk(path.join(BUILD, dir));
mk(DIST);

run(tool('aapt2'), [
  'compile',
  '--dir', path.join(ANDROID, 'res'),
  '-o', path.join(BUILD, 'res.zip')
]);

run(tool('aapt2'), [
  'link',
  '-o', path.join(BUILD, 'base.apk'),
  '-I', JAR,
  '--manifest', path.join(ANDROID, 'AndroidManifest.xml'),
  '-R', path.join(BUILD, 'res.zip'),
  '--java', path.join(BUILD, 'gen'),
  '-A', path.join(ANDROID, 'assets'),
  '--min-sdk-version', '26',
  '--target-sdk-version', '35',
  '--version-code', version.versionCode,
  '--version-name', version.versionName,
  '--auto-add-overlay'
]);

const sources = walk(path.join(ANDROID, 'src')).filter((file) => file.endsWith('.java'));
const generated = walk(path.join(BUILD, 'gen')).filter((file) => file.endsWith('.java'));

run(javaTool('javac'), [
  '-encoding', 'UTF-8',
  '-source', '17',
  '-target', '17',
  '-classpath', JAR,
  '-d', path.join(BUILD, 'classes'),
  ...sources,
  ...generated
]);

const classes = walk(path.join(BUILD, 'classes')).filter((file) => file.endsWith('.class'));
run(tool('d8'), [
  '--release',
  '--min-api', '26',
  '--lib', JAR,
  '--output', path.join(BUILD, 'dex'),
  ...classes
]);

fs.copyFileSync(path.join(BUILD, 'base.apk'), path.join(BUILD, 'unsigned.apk'));
run(javaTool('jar'), [
  'uf', path.join(BUILD, 'unsigned.apk'),
  '-C', path.join(BUILD, 'dex'), 'classes.dex'
]);

run(tool('zipalign'), [
  '-f', '4',
  path.join(BUILD, 'unsigned.apk'),
  path.join(BUILD, 'aligned.apk')
]);

mk(path.dirname(keystore));
if (!fs.existsSync(keystore)) {
  run(javaTool('keytool'), [
    '-genkeypair',
    '-keystore', keystore,
    '-storepass', storepass,
    '-alias', keyalias,
    '-keypass', keypass,
    '-dname', 'CN=WhaleGo Debug,O=WhaleGo,C=CN',
    '-keyalg', 'RSA',
    '-keysize', '2048',
    '-validity', '10000'
  ]);
}

const apk = path.join(DIST, 'whalego.apk');
run(tool('apksigner'), [
  'sign',
  '--ks', keystore,
  '--ks-pass', 'pass:' + storepass,
  '--key-pass', 'pass:' + keypass,
  '--out', apk,
  path.join(BUILD, 'aligned.apk')
]);

for (const target of [
  path.join(ROOT, 'site', 'whalego.apk'),
  path.join(ROOT, '..', 'site', 'whalego.apk')
]) {
  if (fs.existsSync(path.dirname(target))) {
    fs.copyFileSync(apk, target);
    console.log('copied', target);
  }
}

const bytes = fs.readFileSync(apk);
const sha = crypto.createHash('sha256').update(bytes).digest('hex');
console.log('built', apk, bytes.length, 'bytes');
console.log('sha256', sha);
