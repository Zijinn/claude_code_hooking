const { execFile } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

/**
 * Supported IDEs: key → { win: [processNames], mac: appName, label: displayName }
 * win  – Windows executable names (without .exe), case-insensitive on Windows
 * mac  – macOS application process name (as seen in System Events)
 */
const IDE_CONFIG = {
  vscode:      { win: ['Code'],           mac: 'Visual Studio Code', label: 'VSCode'      },
  cursor:      { win: ['Cursor'],         mac: 'Cursor',             label: 'Cursor'      },
  windsurf:    { win: ['Windsurf'],       mac: 'Windsurf',           label: 'Windsurf'    },
  antigravity: { win: ['Antigravity'],    mac: 'Antigravity',        label: 'Antigravity' },
  qcode:       { win: ['QCode'],          mac: 'QCode',              label: 'QCode'       },
  lingma:      { win: ['TongyiLingma'],   mac: 'Lingma',             label: 'Lingma'      },
};

const PS_TITLE_SCRIPT = `
$termNames = @('WindowsTerminal','wt','ConEmu','ConEmu64','mintty','alacritty','wezterm-gui','hyper','Tabby','Terminus')
$titles = @()
foreach ($name in $termNames) {
  $procs = Get-Process -Name $name -ErrorAction SilentlyContinue
  foreach ($p in $procs) {
    if ($p.MainWindowHandle -ne 0) { $titles += $p.MainWindowTitle }
  }
}
$titles -join "\`n"
`.trim();

const PS_PROCESS_SCRIPT = `
$procs = Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='bash.exe'"
$cmdLines = @()
foreach ($p in $procs) {
  if ($p.CommandLine) { $cmdLines += $p.CommandLine }
}
$cmdLines -join "\`n"
`.trim();

/**
 * Build a PowerShell script that detects all IDE windows at once.
 * Output format per line: "ideKey|windowTitle"
 */
function buildPsIDEScript() {
  const checks = Object.entries(IDE_CONFIG).map(([key, cfg]) => {
    const names = cfg.win.map(n => `'${n}'`).join(',');
    return `$procNames_${key} = @(${names})
foreach ($pname in $procNames_${key}) {
  $procs = Get-Process -Name $pname -ErrorAction SilentlyContinue
  foreach ($p in $procs) {
    if ($p.MainWindowHandle -ne 0 -and $p.MainWindowTitle) { Write-Output "${key}|$($p.MainWindowTitle)" }
  }
}`;
  });
  return checks.join('\n').trim();
}

/**
 * Run a PowerShell script and return stdout lines.
 */
function runPsScript(script) {
  return new Promise((resolve) => {
    const tmpFile = path.join(os.tmpdir(), `terminal-check-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.ps1`);
    try {
      fs.writeFileSync(tmpFile, script, 'utf-8');
    } catch {
      resolve([]);
      return;
    }

    execFile('powershell', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tmpFile
    ], { timeout: 10000, encoding: 'utf-8' }, (err, stdout) => {
      try { fs.unlinkSync(tmpFile); } catch (_) {}
      if (err) {
        console.error('[terminal-checker] PowerShell error:', err.message);
        resolve([]);
        return;
      }
      const lines = stdout.trim().split('\n').map(t => t.trim()).filter(Boolean);
      resolve(lines);
    });
  });
}

/**
 * Get window titles for a macOS app via osascript.
 * Requires Accessibility permission on macOS 10.15+.
 */
function getMacAppWindowTitles(appName) {
  return new Promise((resolve) => {
    // Escape backslashes first, then double quotes, for AppleScript string safety
    const escaped = appName.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const script = `tell application "System Events"\n  if exists process "${escaped}" then\n    set wTitles to {}\n    repeat with w in (get every window of process "${escaped}")\n      set end of wTitles to name of w\n    end repeat\n    set AppleScript's text item delimiters to "\n"\n    return wTitles as text\n  else\n    return ""\n  end if\nend tell`;
    execFile('osascript', ['-e', script], { timeout: 5000, encoding: 'utf-8' }, (err, stdout) => {
      if (err) { resolve([]); return; }
      const titles = stdout.trim().split('\n').map(t => t.trim()).filter(Boolean);
      resolve(titles);
    });
  });
}

/**
 * Get all terminal window titles via PowerShell.
 */
function getTerminalTitles() {
  return runPsScript(PS_TITLE_SCRIPT);
}

/**
 * Get all Claude Code process command lines (node + children).
 */
function getClaudeProcessCmdLines() {
  return runPsScript(PS_PROCESS_SCRIPT);
}

/**
 * Get window titles for all supported IDEs.
 * Returns a map: { vscode: [...titles], cursor: [...titles], windsurf: [...titles], ... }
 * On unsupported platforms returns empty arrays for all IDEs.
 */
async function getIDEWindows() {
  const result = {};
  for (const key of Object.keys(IDE_CONFIG)) {
    result[key] = [];
  }

  const platform = os.platform();

  if (platform === 'win32') {
    try {
      const lines = await runPsScript(buildPsIDEScript());
      for (const line of lines) {
        const sep = line.indexOf('|');
        if (sep > 0) {
          const ideKey = line.substring(0, sep);
          const title = line.substring(sep + 1);
          if (result[ideKey]) {
            result[ideKey].push(title);
          }
        }
      }
    } catch (err) {
      console.error('[ide-checker] Windows IDE detection failed:', err.message);
    }
  } else if (platform === 'darwin') {
    await Promise.all(
      Object.entries(IDE_CONFIG).map(async ([key, cfg]) => {
        try {
          result[key] = await getMacAppWindowTitles(cfg.mac);
        } catch (_) {}
      })
    );
  }
  // Linux: window title detection not available without extra system tools

  return result;
}

/**
 * @deprecated Use getIDEWindows() instead. Kept for backward compatibility.
 * Get all VSCode (Code.exe) window titles.
 */
async function getVSCodeWindows() {
  const ideWindows = await getIDEWindows();
  return ideWindows.vscode || [];
}

/**
 * Given a list of sessions (serialized), find those whose cwd folder name
 * does not appear in any terminal window title AND whose cwd path does not
 * appear in any Claude Code process command line.
 * Returns an array of orphan session IDs.
 */
async function findOrphanSessions(sessions) {
  if (sessions.length === 0) return [];

  // Run both checks in parallel
  const [titles, cmdLines] = await Promise.all([
    getTerminalTitles(),
    getClaudeProcessCmdLines(),
  ]);

  // If process check returned nothing, conservatively assume all sessions are alive.
  // Title check alone is unreliable (window titles may not contain folder names).
  if (cmdLines.length === 0) return [];

  // Join all command lines for substring matching
  const cmdLineBlob = cmdLines.join('\n').toLowerCase();

  const orphans = [];
  for (const session of sessions) {
    const cwd = session.cwd || '';
    if (!cwd) continue;

    // Check 1: window title matches cwd folder name
    const folderName = cwd.replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop() || '';
    const titleMatch = folderName && titles.length > 0 && titles.some(title => title.includes(folderName));

    // Check 2: process command line contains cwd path (forward or back slash)
    const cwdForward = cwd.replace(/\\/g, '/').toLowerCase();
    const cwdBack = cwd.replace(/\//g, '\\').toLowerCase();
    const processMatch = cmdLines.length > 0 && (cmdLineBlob.includes(cwdForward) || cmdLineBlob.includes(cwdBack));

    // OR logic: either match means session is alive
    if (!titleMatch && !processMatch) {
      orphans.push(session.id);
    }
  }
  return orphans;
}

module.exports = { IDE_CONFIG, findOrphanSessions, getTerminalTitles, getVSCodeWindows, getIDEWindows };
