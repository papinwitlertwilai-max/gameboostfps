# AGENTS.md — GameBoost FPS PRO (Ty.ppw)

Read this fully before touching any file. It contains constraints that are **not
inferable from the source code** — including bugs that were already found and
fixed the hard way. Re-introducing them wastes real hours.

---

## 1. What this project is

An **Electron desktop app for Windows** that applies real system tweaks
(registry / PowerShell / netsh / sc / powercfg) to improve gaming performance —
higher FPS, lower input lag, lower ping. Targeted at FiveM, GTA V, CS2,
Valorant, Apex, PUBG.

It is **not** a game modifier. It never touches game memory, game files, or
anything anti-cheat would flag. It only changes Windows settings the user could
change by hand.

**UI language is Thai.** All user-facing strings (card names, descriptions,
toasts, tooltips) are Thai. Code, comments in this file, and identifiers are
English. Keep it that way.

---

## 2. Hard rules — do not violate

These are non-negotiable. If a change would break one of these, stop and ask the
human instead.

### 2.1 Never ship a registry key you cannot verify exists

This is the single most important rule. LLMs hallucinate Windows registry paths
constantly, and "tweak guide" websites are full of keys that do nothing because
the driver or OS overrides them.

Before adding any `reg add` command, you must be able to answer:
**"What is the evidence this key is read by Windows or the driver?"**

"A tweaking forum said so" is not evidence. If you cannot verify it, do not add
it. A card that looks impressive but does nothing is worse than no card — the
whole app's credibility rests on every command being real.

Already rejected for this reason (do not re-add):
- NVIDIA 3D settings via registry (Low Latency Mode, Threaded Optimization,
  Texture Filtering, Max Pre-Rendered Frames). These live in the driver's binary
  profile DB `%ProgramData%\NVIDIA Corporation\Drs\nvdrsdb0.bin` and are only
  writable through **NVAPI**. Registry writes are silently overridden.
  → This is why the **GPU Settings Guide page** exists instead (see §4.6).
- AMD Anti-Lag / Chill / Image Sharpening via registry — same problem, ADL only.

### 2.2 Never add CPU/GPU overclocking or undervolting

Voltage, multiplier, and BCLK control belong in BIOS or vendor tools (Ryzen
Master, Intel XTU). Safe values are per-silicon and cannot be generalized.
Getting it wrong causes permanent hardware damage that no `revert` can undo.

What the app does instead is legitimate: unlock the CPU to reach its
**factory-rated** boost clocks (Ultimate Performance plan, 100% min/max
processor state, core parking off, power throttling off).

### 2.3 Never add game macros or automation

No recoil control, auto-loot, auto-heal, aim assist, triggerbot, or any input
automation aimed at a game. This was requested once and refused; the refusal
stands. It is cheating and gets users banned.

### 2.4 Every state-changing tweak must have a working revert

If `apply` writes a value, `revert` must restore the default — not just delete
the key, unless deleting genuinely restores default behaviour. Users trust the
Restore page. See §5 for the one legitimate exception (action cards).

### 2.5 Never hardcode a network adapter name

`netsh interface ip set dns "Ethernet" ...` is **broken** and was already fixed
once. It fails on Wi-Fi, on renamed adapters, and on non-English Windows where
the adapter is named e.g. "อีเทอร์เน็ต".

Always resolve the adapter **by interface index** at runtime — see
`getAdapterIndex()` in `src/index.html`.

The legacy PowerShell scripts in the project history still contain this bug.
**Do not copy commands out of them verbatim.**

---

## 3. Repo layout

```
GameBoostFPS_PRO_Ty.ppw/
├── main.js              Electron main process — all IPC handlers, GPU detection,
│                        splash window, overlay window, Discord RPC
├── BUILD.bat            One-click build (auto-kills old build, npm install, electron-builder)
├── icon.ico             App icon, multi-resolution, pixel-rocket design
├── icon_256.png         Source PNG for the icon
├── README.txt           End-user readme (Thai)
├── AGENTS.md            This file
├── tools/validate.js    Static + runtime validator — RUN AFTER EVERY EDIT (§7)
└── src/
    ├── index.html       The entire renderer: HTML + CSS + tweak data + all logic
    ├── preload.js       contextBridge — exposes window.boost.*
    └── splash.html      Frameless transparent circular launcher (Riot-style)
```

`src/index.html` is ~208 KB and holds everything in one file: markup, a large
`<style>` block, and one large inline `<script>`. **This is known technical
debt.** Splitting it into modules is welcome, but only as a deliberate,
separately-validated refactor — not as a side effect of another change.

---

## 4. Architecture

### 4.1 Process split

- **main.js** — has Node access. Runs all shell commands. Owns all windows.
- **preload.js** — the only bridge. `contextIsolation: true`,
  `nodeIntegration: false`. Do not weaken these.
- **index.html** — renderer. No Node access. Talks to main only via
  `window.boost.*`.

### 4.2 IPC surface

| Handler | Purpose |
|---|---|
| `run-cmd` | Execute a shell command via cmd.exe, 20 s timeout |
| `sysinfo` | CPU name, GPU name, RAM GB — with dedicated-GPU scoring (§9.3) |
| `hwstats` | CPU load, RAM used/total, CPU temp (ACPI), GPU temp (nvidia-smi) |
| `quick-ping` | Single ping, returns ms |
| `list-games` | Scans `tasklist` for known game executables |
| `restore-point` | Creates a Windows System Restore point |
| `overlay-show` / `overlay-hide` | The always-on-top mini stats window |
| `discord-set` | Updates Discord Rich Presence |

Renderer-side API (`preload.js`):
`isDesktop`, `run`, `sysinfo`, `restorePoint`, `hwStats`, `quickPing`,
`listGames`, `overlayShow`, `overlayHide`, `discordSet`

`window.boost.isDesktop` is `false` when `index.html` is opened directly in a
browser. Preview mode must degrade gracefully — never crash, show a toast that
the feature needs the built .exe.

### 4.3 The tweak registry

All tweaks live in one array `T` in `src/index.html`. Currently **67 tweaks
across 14 categories**.

| Category | Count | Notes |
|---|---|---|
| `network` | 10 | |
| `games` | 8 | per-title: priority + shader-cache clear |
| `policy` | 7 | |
| `service` | 6 | set to Manual, guarded |
| `ram` | 5 | |
| `cpu` | 5 | |
| `svcoff` | 4 | permanent disable, guarded |
| `nvidia` | 4 | vendor-specific, excluded from bulk |
| `fivem` | 4 | |
| `boost` | 4 | |
| `input` | 3 | |
| `amd` | 3 | vendor-specific, excluded from bulk |
| `gpu` | 2 | vendor-neutral |
| `clean` | 2 | action cards |

### 4.4 Bulk operations

`BULK_EXCLUDE` holds categories that "Optimize all" must skip:
`clean, fivem, games, nvidia, amd, service, svcoff`.

Vendor categories are excluded because applying NVIDIA tweaks on a Radeon
machine is noise. `pickAutoTweaks()` re-adds the correct vendor's cards after
detecting the GPU, so Auto Tune still covers them.

### 4.5 Game Mode

One-button toggle on the Dashboard. Applies
`GAME_MODE_TWEAKS = ['ram_standby','fm_priority','dnsflush','svc_sysmain','svc_wsearch','svc_spooler','cpu_powerthrottle']`
and reverts the state-type ones on exit.

### 4.6 GPU Settings Guide page (`gpuguide`)

Because driver 3D settings are unreachable from registry (§2.1), this page reads
the real GPU + RAM, classifies the card into `high` / `mid` / `low`, and renders
a **tailored table of settings the user applies manually** in NVIDIA App or AMD
Adrenalin, each with a reason.

`gpuProfile()` holds the tier logic. It was tested against 15 real model strings.
If you touch it, re-run those cases (§7.3) — the AMD 4-digit parsing and the
Intel Arc regex both had bugs that only showed up on specific models.

### 4.7 Live Monitor page (`monitor`)

Polls `hwstats` + `quick-ping` every 2.5 s while the page is open. Also hosts:
game auto-detection (8 s poll), scheduled cleaning, benchmark before/after, and
the overlay toggle.

**Benchmark measures system state, not in-game FPS** — RAM free, process count,
ping, CPU idle. It is honest about this in the UI. Do not relabel it as an FPS
benchmark. Measuring real FPS would require bundling PresentMon (§10).

---

## 5. Tweak card schema

```js
{
  id:   'unique_snake_case',      // must be unique across the whole array
  cat:  'network',                // must exist as a key in CATS
  icon: '🔌',
  name: 'Short title',            // Thai
  desc: 'What it does and why',   // Thai — be specific, users read this
  tags: [['ลด latency','lat'], ['FPS','fps']],   // tag style: lat | fps | warn
  apply:  ['cmd 1', 'cmd 2'],     // array of shell command strings
  revert: ['cmd 1'] | null
}
```

### State cards vs action cards

- `revert: [...]` → **state card**. Locks to "✓ Applied", tracked in Restore,
  counted in the tuned percentage.
- `revert: null` → **action card**. Repeatable, shows "▶ Run" / "↻ Run again",
  **not** tracked in Restore and not counted as applied.

Cache clears, DNS flush, and RAM purge are action cards — running them twice is
normal and there is nothing to undo. Getting this wrong causes the "card locked
after one click" bug that was already fixed once.

### Guarding destructive commands

Service tweaks must not fail loudly on machines where the service does not
exist. Follow the existing guard pattern in the `service` / `svcoff` cards
rather than inventing a new one.

---

## 6. Adding a new tweak — checklist

1. Verify the command actually works and the key is real (§2.1).
2. Pick a unique `id` and an existing `cat`.
3. Write a real `revert`, or set `revert: null` if it is genuinely an action.
4. If the category is new: add it to `CATS`, add a nav button, add a
   `<section class="page" id="page-<cat>">` with `<div class="grid"
   id="grid-<cat>">`, and add the cat to the three `isCat` / render / count
   arrays. Missing any one of these produces an empty page with no error.
5. Decide whether it belongs in `BULK_EXCLUDE`.
6. Run `node tools/validate.js` (§7). It must pass clean.
7. Only then build.

---

## 7. Validation — run after every edit

```
node tools/validate.js
```

This is not optional and it is fast. It catches, in order:

1. `node --check` on `main.js` and `preload.js`
2. Every `<script>` block in `index.html` and `splash.html` parses
3. The tweak array evaluates in a DOM-stubbed sandbox
4. Zero malformed cards (missing id/cat/name/apply, bad revert type)
5. Zero duplicate ids
6. Every `cat` used has a `CATS` label
7. CSS brace balance in every `<style>` block
8. `gpuProfile()` tier detection against 15 known GPU model strings

### 7.1 Why a sandbox rather than a browser

There is no browser in CI. The validator stubs `document`, `localStorage`,
`window.boost`, and the timer functions, then evaluates the inline script with
`new Function()`. If you add code that touches a DOM API the stub does not
implement, extend the stub in `tools/validate.js` — **do not** weaken the check
or skip it.

### 7.2 Functional testing async code

`window.boost` is mocked in the validator, so `refreshMon()`, `detectGames()`,
`benchSnap()`, and `renderGuide()` can be called directly and their output
asserted. Several real bugs were caught this way before ever building.

### 7.3 GPU tier cases that must keep passing

| GPU string | vendor | tier |
|---|---|---|
| `NVIDIA GeForce RTX 4090` | nvidia | high |
| `NVIDIA GeForce RTX 4070` | nvidia | high |
| `NVIDIA GeForce RTX 3060` | nvidia | mid |
| `NVIDIA GeForce RTX 2060` | nvidia | mid |
| `NVIDIA GeForce GTX 1650` | nvidia | low |
| `AMD Radeon RX 9070 XT` | amd | high |
| `AMD Radeon RX 7900 XTX` | amd | high |
| `AMD Radeon RX 7800 XT` | amd | high |
| `AMD Radeon RX 7600` | amd | mid |
| `AMD Radeon RX 6600` | amd | mid |
| `AMD Radeon RX 6500 XT` | amd | low |
| `AMD Radeon RX 580` | amd | low |
| `AMD Radeon(TM) Graphics` | amd | low |
| `Intel(R) Arc(TM) A770 Graphics` | intel | mid |
| `Intel(R) UHD Graphics 770` | intel | low |

---

## 8. Build and release

### Developer build

Double-click `BUILD.bat`. It:
1. Kills any running `GameBoostFPS.exe` / `electron.exe` and deletes the old
   `GameBoostFPS_Build` folder — **this auto-cleanup must stay**, the user hit
   locked-file errors without it
2. Copies `main.js`, `icon.ico`, `src/preload.js`, `src/index.html`,
   `src/splash.html`
3. Writes `package.json` (portable target, asar on, `requireAdministrator`)
4. `npm install` + `electron-builder --win`

Output: `GameBoostFPS_Build\dist\GameBoostFPS_Ty.ppw.exe`

Admin elevation is required because the tweaks write to HKLM and control
services.

### Two distributions

- **DEV zip** — readable source, for development.
- **SHARE zip** — `main.js`, `preload.js`, and the inline scripts of
  `index.html` and `splash.html` are obfuscated with
  `javascript-obfuscator@4.1.1`.

Obfuscator options in use: `compact`, `controlFlowFlattening 0.7`,
`deadCodeInjection`, hexadecimal identifiers, `numbersToExpressions`,
`stringArray` with base64 at threshold 0.75, `splitStrings` chunk 8,
`transformObjectKeys`, `selfDefending`.

Always `node --check` the obfuscated output and re-parse every `<script>` block
before zipping. Obfuscation has silently broken builds before.

The Discord client ID gets base64-encoded by the string array in SHARE builds —
`grep` will not find it, but it decodes correctly at runtime. That is expected.

---

## 9. Bug history — do not re-introduce

### 9.1 The app-won't-open hang

A transparent, always-on-top splash window failed to render on some debloated
Windows installs. The main window was `show: false` waiting on `ready-to-show`,
which never fired — the app hung with a spinner cursor and no window.

The current design keeps the Riot-style splash but makes reveal unconditional:

- splash creation is wrapped in `try/catch`
- a fixed `setTimeout(reveal, 6000)` shows the main window regardless of events
- a second failsafe at 13000 ms force-closes the splash and shows the window
- `did-fail-load` also triggers reveal

**Never make the main window's visibility depend solely on an Electron event.**
If you touch the splash, keep all four layers.

### 9.2 `prefers-reduced-motion` killed every animation

`index.html` contains:

```css
@media(prefers-reduced-motion:reduce){
  *:not(#bootScreen):not(#bootScreen *){animation:none!important; transition:none!important}
}
```

The original rule used a bare `*`, which disabled **all** animation app-wide
whenever Windows had animation effects turned off — which is the default on
Atlas OS / Revi OS, *and* is exactly what the app's own "Visual Effects off"
tweak causes. The app was disabling its own loading spinner.

Splash animations additionally carry inline `!important`, because an inline
`!important` declaration outranks an author-stylesheet `!important` one.

Do not "clean up" either the `:not()` selector or those `!important` flags.

### 9.3 iGPU reported instead of the real GPU

`sysinfo` originally took the first `Win32_VideoController` or sorted by
`AdapterRAM`. Both are wrong: `AdapterRAM` is unreliable (it is a 32-bit field,
so cards above 4 GB report garbage, while iGPUs report shared system RAM).

On a Ryzen 9 9800X3D the app showed `AMD Radeon(TM) Graphics` (the iGPU) instead
of the discrete card.

Current approach is **name-based scoring**:
- score 3 — `NVIDIA|GeForce|RTX|GTX|Quadro|Radeon RX|Radeon Pro|Arc A[0-9]|Arc B[0-9]`
- score 0 — `Radeon.*Graphics|Vega|Intel.*Graphics|UHD|Iris|HD Graphics`
- score 1 — anything else

Filters out `PNPDeviceID -like 'ROOT\*'` and Microsoft/Basic/Virtual/Parsec/
Citrix/VNC/DisplayLink adapters, sorts by score then RAM, takes the top.

Note the escaping: in the JS source the pattern is written `'ROOT\\*'` so that
PowerShell receives a single backslash. This was wrong once and silently
disabled the filter.

### 9.4 Cache-clear cards locked after one click

Fixed by introducing the action-card concept (§5).

### 9.5 Ultimate Performance plan created but not activated

`powercfg -duplicatescheme` prints a new GUID; it must be captured and passed to
`powercfg -setactive`. Simply duplicating the scheme does nothing. The current
command parses the GUID with `for /f "tokens=4"`.

### 9.6 `autotuninglevel=experimental`

The legacy EXTREME PowerShell script used it. It can make throughput *worse* on
some networks. The app deliberately uses `normal`. Do not change this back.

---

## 10. Known impossible — do not attempt

- **NVIDIA / AMD driver 3D settings from registry** — see §2.1. The Guide page
  is the accepted solution.
- **Real in-game FPS measurement** — needs PresentMon bundled. Rejected: it
  bloats the download, trips antivirus, and makes the build fragile. The
  benchmark measures system state instead and says so.
- **GPU temperature on AMD cards** — `nvidia-smi` covers NVIDIA only. AMD would
  need LibreHardwareMonitor bundled; same objections. The UI shows `N/A` and
  explains why.
- **CPU temperature on some boards** — `MSAcpi_ThermalZoneTemperature` is not
  implemented by every vendor. `N/A` is correct behaviour, not a bug.
- **Overlay above exclusive-fullscreen games** — an Electron limitation.
  Borderless and windowed work. Documented in the UI.

---

## 11. Test environments

| Machine | Notes |
|---|---|
| Ryzen 7 2700X + GTX 1650, 16 GB | No iGPU — single-GPU path |
| Ryzen 9 9800X3D + iGPU + discrete, 31 GB | Dual-GPU path, exposed §9.3 |
| Atlas OS (Win10) | Primary dev box. Debloated. |
| Revi OS (Win11) | Debloated. Exposed §9.2. Node.js MSI fails with error 2503 here — use portable Node or `winget`. |

Assume the user's Windows is **debloated**: services may be missing, animations
off, Microsoft Store absent, Windows Installer unreliable. Every command must
fail gracefully on a stripped install.

---

## 12. UI conventions

- Thai for everything user-facing. Descriptions explain *why*, not just *what*.
- Tag styles: `lat` (latency, teal), `fps` (performance, purple), `warn`
  (caution, amber). Use `warn` for anything requiring a restart or carrying a
  trade-off.
- 18 themes and 6 app icons persist to `localStorage` (`gb_theme`, `gb_icon`).
  New CSS must use the theme variables, not hardcoded colours, or it will break
  in 17 of them.
- The terminal dock logs every command. Keep it truthful — log what actually
  ran, including failures.
- Be honest in the UI about limitations. Several features carry explicit notes
  saying what they cannot do. That is deliberate and should be preserved.

---

## 13. Working agreement

- Change one thing at a time, validate, then move on.
- Prefer refusing a feature over shipping one that appears to work but does not.
- When unsure whether a system command is real, say so plainly and ask —
  the human would rather answer a question than ship a placebo.
