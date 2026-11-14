/** Reviewed installation ownership and additional native tool definitions. @module */
import type { ToolDefinition } from './tool-definitions.ts'

const recipes: Readonly<Record<string, string>> = {
  python: 'python-analysis', java: 'java', 'ghidra-headless': 'ghidra-headless', jadx: 'jadx', apktool: 'apktool',
  adb: 'android-platform-tools', fastboot: 'android-platform-tools', tshark: 'wireshark', capinfos: 'wireshark',
  mitmdump: 'mitmproxy', nmap: 'nmap',
}
const adapters = new Set(['apk', 'analysis', 'packet-capture', 'radare2', 'r2ghidra', 'tshark', 'jadx', 'file',
  'strings', 'readelf', 'objdump', 'nm', 'ghidra-headless', 'adb'])
const manual = new Set(['hopper', 'ida', 'kuna', 'jeb'])

/** Attach management metadata without allowing catalog imports to supply executable recipes.
 * @param definition - built-in definition before schema normalization.
 * @returns definition with declared installation ownership and integration support.
 */
export function managedToolDefinition<T extends { id: string; dependency?: string; invocation?: string }>(definition: T): T & {
  management: NonNullable<ToolDefinition['management']>
} {
  const recipe = recipes[definition.id]
  return { ...definition, management: {
    installation: definition.dependency ? 'dependency' : recipe ? 'managed' : definition.invocation === 'provider' ? 'builtin' : 'manual',
    support: adapters.has(definition.id) ? 'adapter' : manual.has(definition.id) ? 'manual' : 'native',
    ...(recipe ? { recipe } : {}),
  } }
}

/** Additional definitions use existing native execution and explicit provider connections. */
export const additionalToolDefinitions = [
  { id: 'java', label: 'Java / JDK', category: 'runtime', tags: ['runtime', 'android', 'reverse'],
    description: 'Selected full JDK for Java analysis tools / Java 分析运行时', commands: ['java'], args: ['-version'],
    compatibility: { minimumMajor: 17 }, url: 'https://adoptium.net/installation/archives',
    guide: 'Select a full JDK, including javac, compatible with the chosen tool. Ghidra validates its own declared Java requirements. Do not infer the JDK from a different environment.' },
  { id: 'ghidra-headless', label: 'Ghidra headless', category: 'reverse', tags: ['reverse', 'binary', 'firmware'],
    description: 'Headless native analysis with reusable owned projects / 无界面原生分析与项目复用',
    commands: ['java'], args: ['-version'], dependencies: ['java'], url: 'https://github.com/NationalSecurityAgency/ghidra/releases',
    guide: 'Use security_ghidra_headless with an imported file asset and a bounded read-only operation. Select the Ghidra installation and JDK through the toolbox.' },
  { id: 'apktool', label: 'Apktool', category: 'reverse', tags: ['android', 'reverse'],
    description: 'Android resources and smali decoding / Android 资源与 smali 解码', commands: ['apktool'], args: ['--version'],
    dependencies: ['java'], url: 'https://apktool.org/docs/install/',
    guide: 'Use the selected Java launcher and official Apktool JAR. Decode into the analysis outputs directory, retain original APK identity and diagnostics, and capture the native tool result as evidence.' },
  { id: 'gdb', label: 'GNU GDB', category: 'reverse', tags: ['reverse', 'debugging', 'linux'], platforms: ['linux'],
    description: 'Native debugger / 原生调试器', commands: ['gdb'], url: 'https://www.sourceware.org/gdb/',
    guide: 'Use an explicitly selected environment and authorized target. A version probe does not establish ptrace permissions or process ownership. Save commands and outputs as evidence.' },
  { id: 'rizin', label: 'Rizin', category: 'reverse', tags: ['reverse', 'binary', 'firmware'],
    description: 'Binary inspection and disassembly / 二进制分析与反汇编', commands: ['rizin'], args: ['-v'],
    url: 'https://rizin.re/', guide: 'Use bounded JSON queries against the imported sample, keep addresses and file offsets distinct, and retain raw output. This catalog entry does not add a dedicated DSH adapter.' },
  { id: 'unblob', label: 'Unblob', category: 'reverse', tags: ['firmware', 'iot', 'extraction'], platforms: ['linux'],
    description: 'Firmware extraction with external extractors / 固件识别与提取', commands: ['unblob'],
    url: 'https://unblob.org/installation/', guide: 'Use the firmware container collection including required extractors. Extract into a dedicated output directory and retain the input digest, extractor diagnostics and incomplete regions.' },
  { id: 'capinfos', label: 'capinfos', category: 'utility', tags: ['capture', 'network', 'pcap'],
    description: 'Capture file metadata / 抓包文件元数据', commands: ['capinfos'], args: ['--version'],
    url: 'https://www.wireshark.org/download.html', guide: 'Inspect saved PCAP/PCAPNG files. A working capinfos does not establish live capture permissions or Npcap availability.' },
  { id: 'mitmdump', label: 'mitmdump', category: 'web', tags: ['web', 'network', 'proxy'],
    description: 'Explicit HTTP proxy observations / HTTP 代理观测', commands: ['mitmdump'],
    url: 'https://docs.mitmproxy.org/stable/overview/installation/',
    guide: 'Start only for an authorized target and explicit listen address. Installation does not modify system proxy settings or trust certificates. Keep credentials out of retained diagnostics.' },
  { id: 'chromium', label: 'Chrome / Edge / Chromium', category: 'web', tags: ['web', 'browser'],
    description: 'Existing browser for Playwright / Playwright 浏览器连接', commands: ['chrome', 'msedge', 'chromium', 'chromium-browser'],
    url: 'https://www.chromium.org/getting-involved/download-chromium/',
    guide: 'Select an existing browser executable in the Playwright integration. Browser presence does not establish a running connection or an authenticated page. Do not launch a browser merely to discover its version.' },
  { id: 'hopper', label: 'Hopper', category: 'reverse', tags: ['reverse', 'binary'], platforms: ['darwin', 'linux'],
    description: 'Existing Hopper installation; manual integration / 已有 Hopper 安装', commands: ['hopper'],
    url: 'https://www.hopperapp.com/', guide: 'Use the official installer and your own license. This entry supplies installation guidance; no dedicated DSH Hopper adapter is registered.' },
  { id: 'ida', label: 'IDA', category: 'reverse', tags: ['reverse', 'binary'],
    description: 'Existing IDA installation; manual integration / 已有 IDA 安装', commands: ['idat', 'idat64'], args: ['-v'],
    url: 'https://hex-rays.com/ida-pro', guide: 'Register your existing licensed executable. This entry neither installs an IDA MCP bridge nor supplies a dedicated DSH adapter.' },
  { id: 'kuna', label: 'Kuna', category: 'reverse', tags: ['reverse', 'binary'], platforms: ['darwin', 'linux'],
    description: 'Existing Kuna executable / 已有 Kuna 程序', commands: ['kuna'],
    url: 'https://github.com/Noelo-Lab/kuna',
    guide: 'Register an existing Kuna executable and use its documented native workflow. DSH does not activate a license or advertise REA provider operations.' },
  { id: 'jeb', label: 'JEB', category: 'reverse', tags: ['android', 'reverse'],
    description: 'Existing JEB installation; manual integration / 已有 JEB 安装', commands: ['jeb'],
    url: 'https://www.pnfsoftware.com/jeb/', guide: 'Use the official installation and your own license. Connecting JEB MCP requires separate operator configuration; this catalog entry is not an active connection.' },
] as const
