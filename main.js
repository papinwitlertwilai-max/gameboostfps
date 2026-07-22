const { app, BrowserWindow, ipcMain } = require('electron')
const { exec } = require('child_process')
const path = require('path')

let mainWin = null
let overlayWin = null
let overlayTimer = null
let splash = null

function createSplash () {
  try {
    splash = new BrowserWindow({
      width: 420, height: 470,
      frame: false, transparent: true, resizable: false,
      alwaysOnTop: true, center: true, skipTaskbar: true, hasShadow: false,
      backgroundColor: '#00000000',
      webPreferences: { nodeIntegration: false, contextIsolation: true }
    })
    splash.loadFile(path.join(__dirname, 'src', 'splash.html'))
    splash.on('closed', () => { splash = null })
  } catch (e) { splash = null }
}

function closeSplash () {
  try { if (splash && !splash.isDestroyed()) splash.close() } catch (e) {}
  splash = null
}

function createWindow () {
  mainWin = new BrowserWindow({
    width: 1080, height: 720, minWidth: 900, minHeight: 600,
    show: false,
    title: 'Set Computer Ty.ppw & Power By Chubby.com',
    icon: path.join(__dirname, 'icon.ico'),
    backgroundColor: '#0b0d10',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false, contextIsolation: true,
      preload: path.join(__dirname, 'src', 'preload.js')
    }
  })
  mainWin.loadFile(path.join(__dirname, 'src', 'index.html'))
  mainWin.setMenu(null)

  // ── เปิดหน้าต่างหลักแบบรับประกัน (ไม่พึ่ง event ใด ๆ) ──
  let revealed = false
  const reveal = () => {
    if (revealed) return
    revealed = true
    // สั่ง splash เล่นอนิเมชันขยายออกก่อนปิด (เอฟเฟกต์พุ่งเข้าโปรแกรม)
    try {
      if (splash && !splash.isDestroyed()) {
        splash.webContents.executeJavaScript('window.__exit && window.__exit()').catch(() => {})
      }
    } catch (e) {}
    setTimeout(() => {
      closeSplash()
      try { if (mainWin && !mainWin.isDestroyed()) { mainWin.show(); mainWin.focus() } } catch (e) {}
    }, 460)
  }
  setTimeout(reveal, 6000)                              // ปกติ: โชว์หลัง 6 วิ
  setTimeout(() => { closeSplash(); try { if (mainWin && !mainWin.isDestroyed() && !mainWin.isVisible()) mainWin.show() } catch (e) {} }, 13000) // failsafe สุดท้าย
  mainWin.webContents.on('did-fail-load', () => setTimeout(reveal, 500))
  mainWin.on('closed', () => { closeSplash(); mainWin = null })
}

// ── helper: run powershell, parse JSON ──────────────────────────
function psJson (ps, fallback) {
  return new Promise(resolve => {
    exec(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${ps.replace(/"/g, '\\"')}"`,
      { windowsHide: true, timeout: 12000 }, (err, stdout) => {
        if (err) return resolve(fallback)
        try { resolve(JSON.parse((stdout || '').trim())) } catch { resolve(fallback) }
      })
  })
}

// ── run a shell command ─────────────────────────────────────────
ipcMain.handle('run-cmd', (e, cmd) => new Promise(resolve => {
  exec(cmd, { shell: 'cmd.exe', windowsHide: true, timeout: 20000 }, (err, stdout, stderr) => {
    resolve({ ok: !err, out: (stdout || '').trim(), err: (stderr || '').trim() })
  })
}))

// ── system info (CPU / GPU / RAM) — dedicated-GPU scoring ────────
ipcMain.handle('sysinfo', () => {
  const ps = `$c=(Get-CimInstance Win32_Processor | Select-Object -First 1).Name; ` +
             `$gpus=Get-CimInstance Win32_VideoController | Where-Object {$_.Name -and $_.PNPDeviceID -notlike 'ROOT\\*' -and $_.Name -notmatch 'Microsoft|Basic|Remote|Virtual|Parsec|Meta|Citrix|VNC|DisplayLink'}; ` +
             `$scored=$gpus | ForEach-Object { $n=$_.Name; $s=1; ` +
             `if($n -match 'NVIDIA|GeForce|RTX|GTX|Quadro|Radeon RX|Radeon Pro|Arc A[0-9]|Arc B[0-9]'){$s=3} ` +
             `elseif($n -match 'Radeon.*Graphics|Vega|Intel.*Graphics|UHD|Iris|HD Graphics'){$s=0}; ` +
             `[pscustomobject]@{N=$n; S=$s; R=[int64]($_.AdapterRAM)} }; ` +
             `$g=($scored | Sort-Object S,R -Descending | Select-Object -First 1).N; ` +
             `if(-not $g){$g=(Get-CimInstance Win32_VideoController | Select-Object -First 1).Name}; ` +
             `$r=[math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory/1GB); ` +
             `ConvertTo-Json -Compress @{cpu=$c; gpu=$g; ram=$r}`
  return psJson(ps, { cpu: null, gpu: null, ram: null })
})

// ── live hardware stats: load / ram / temps ─────────────────────
function getHwStats () {
  const ps = `$l=[math]::Round((Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average); ` +
             `$os=Get-CimInstance Win32_OperatingSystem; ` +
             `$ru=[math]::Round(($os.TotalVisibleMemorySize-$os.FreePhysicalMemory)/1MB,1); ` +
             `$rt=[math]::Round($os.TotalVisibleMemorySize/1MB,1); ` +
             `$ct=$null; try{ $t=Get-CimInstance -Namespace root/wmi -Class MSAcpi_ThermalZoneTemperature -EA Stop | Select-Object -First 1; if($t){$ct=[math]::Round(($t.CurrentTemperature/10)-273.15)} }catch{}; ` +
             `$gt=$null; try{ $q=(nvidia-smi --query-gpu=temperature.gpu --format=csv,noheader,nounits 2>$null | Select-Object -First 1); if($q){$gt=[int]($q.Trim())} }catch{}; ` +
             `ConvertTo-Json -Compress @{cpuLoad=$l; ramUsed=$ru; ramTot=$rt; cpuTemp=$ct; gpuTemp=$gt}`
  return psJson(ps, {})
}
ipcMain.handle('hwstats', () => getHwStats())

// ── quick ping (ms) ─────────────────────────────────────────────
function getPing (host) {
  const h = (host || '1.1.1.1').replace(/[^a-zA-Z0-9.\-]/g, '')
  return new Promise(resolve => {
    exec(`ping -n 1 -w 1000 ${h}`, { windowsHide: true, timeout: 5000 }, (err, stdout) => {
      const m = (stdout || '').match(/[=<]\s*(\d+)\s*ms/i)
      resolve({ ms: m ? parseInt(m[1]) : null })
    })
  })
}
ipcMain.handle('quick-ping', (e, host) => getPing(host))

// ── detect running games ────────────────────────────────────────
ipcMain.handle('list-games', () => new Promise(resolve => {
  exec('tasklist /fo csv /nh', { windowsHide: true, timeout: 8000 }, (err, stdout) => {
    if (err) return resolve([])
    const out = (stdout || '').toLowerCase()
    const games = [
      ['FiveM', 'fivem.exe'], ['GTA V', 'gta5.exe'], ['CS2', 'cs2.exe'],
      ['Valorant', 'valorant-win64-shipping.exe'], ['Apex Legends', 'r5apex.exe'],
      ['PUBG', 'tslgame.exe'], ['Fortnite', 'fortniteclient-win64-shipping.exe'],
      ['Overwatch', 'overwatch.exe'], ['League of Legends', 'league of legends.exe'],
      ['Dota 2', 'dota2.exe'], ['Rainbow Six', 'rainbowsix.exe']
    ]
    resolve(games.filter(([n, ex]) => out.includes(ex)).map(([n]) => n))
  })
}))

// ── restore point ───────────────────────────────────────────────
ipcMain.handle('restore-point', (e, name) => new Promise(resolve => {
  const desc = (name || 'GameBoostFPS').replace(/"/g, '')
  const ps = `Enable-ComputerRestore -Drive 'C:\\'; Checkpoint-Computer -Description '${desc}' -RestorePointType 'MODIFY_SETTINGS'`
  exec(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${ps}"`,
    { windowsHide: true, timeout: 90000 }, (err, stdout, stderr) => {
      resolve({ ok: !err, err: (stderr || '').trim() })
    })
}))

// ── mini overlay window (solid, always-on-top; safe) ────────────
function overlayContent () {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    *{margin:0;padding:0;box-sizing:border-box;font-family:'Segoe UI',Tahoma,sans-serif;-webkit-user-select:none}
    body{background:#0b0d10;color:#e6eaf0;border:1px solid #2a3550;border-radius:10px;overflow:hidden;padding:10px 12px}
    .t{font-size:9px;letter-spacing:2px;color:#7b8496;text-transform:uppercase;margin-bottom:7px;display:flex;justify-content:space-between}
    .g{display:grid;grid-template-columns:1fr 1fr;gap:6px 14px}
    .r{display:flex;justify-content:space-between;align-items:baseline;font-size:12px}
    .k{color:#8a94a6}.v{font-weight:700;font-size:14px;color:#5cf0da}
    .v.warn{color:#ff9d5c}.v.bad{color:#ff5470}
  </style></head><body>
    <div class="t"><span>GAMEBOOST · LIVE</span><span id="pingDot">●</span></div>
    <div class="g">
      <div class="r"><span class="k">PING</span><span class="v" id="o_ping">—</span></div>
      <div class="r"><span class="k">CPU</span><span class="v" id="o_cpu">—</span></div>
      <div class="r"><span class="k">RAM</span><span class="v" id="o_ram">—</span></div>
      <div class="r"><span class="k">C°</span><span class="v" id="o_ct">—</span></div>
      <div class="r"><span class="k">GPU°</span><span class="v" id="o_gt">—</span></div>
    </div>
    <script>
      window.upd = function(j){
        function set(id,val,unit,warnAt,badAt){
          var el=document.getElementById(id); if(!el)return;
          if(val==null){el.textContent='N/A';el.className='v';return;}
          el.textContent=val+(unit||''); el.className='v'+(val>=badAt?' bad':(val>=warnAt?' warn':''));
        }
        set('o_ping',j.ping,'ms',60,120);
        set('o_cpu',j.cpuLoad,'%',75,92);
        set('o_ram',j.ramPct,'%',80,93);
        set('o_ct',j.cpuTemp,'°',75,88);
        set('o_gt',j.gpuTemp,'°',78,87);
      }
    </script>
  </body></html>`
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html)
}

async function pushOverlay () {
  if (!overlayWin || overlayWin.isDestroyed()) return
  try {
    const [hw, p] = await Promise.all([getHwStats(), getPing('1.1.1.1')])
    const ramPct = (hw.ramUsed && hw.ramTot) ? Math.round(hw.ramUsed / hw.ramTot * 100) : null
    const data = { ping: p.ms, cpuLoad: hw.cpuLoad, ramPct, cpuTemp: hw.cpuTemp, gpuTemp: hw.gpuTemp }
    overlayWin.webContents.executeJavaScript('window.upd(' + JSON.stringify(data) + ')').catch(() => {})
  } catch (e) {}
}

ipcMain.handle('overlay-show', () => {
  if (overlayWin && !overlayWin.isDestroyed()) { overlayWin.focus(); return { ok: true } }
  overlayWin = new BrowserWindow({
    width: 232, height: 128, x: 24, y: 24,
    frame: false, resizable: false, alwaysOnTop: true, skipTaskbar: true,
    focusable: false, backgroundColor: '#0b0d10',
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  })
  overlayWin.setAlwaysOnTop(true, 'screen-saver')
  overlayWin.loadURL(overlayContent())
  overlayWin.on('closed', () => { overlayWin = null })
  pushOverlay()
  if (overlayTimer) clearInterval(overlayTimer)
  overlayTimer = setInterval(pushOverlay, 2000)
  return { ok: true }
})

ipcMain.handle('overlay-hide', () => {
  if (overlayTimer) { clearInterval(overlayTimer); overlayTimer = null }
  if (overlayWin && !overlayWin.isDestroyed()) overlayWin.close()
  overlayWin = null
  return { ok: true }
})

// ── Discord Rich Presence (optional; never crashes app) ─────────
let rpc = null, rpcReady = false
function setDiscordActivity (info) {
  if (!rpc || !rpcReady) return false
  try {
    rpc.setActivity({
      details: (info && info.details) || 'กำลังปรับแต่งคอม',
      state: (info && info.state) || 'GameBoostFPS PRO Ty.ppw',
      largeImageKey: 'logo',
      largeImageText: 'GameBoostFPS Ty.ppw',
      startTimestamp: Date.now()
    })
    return true
  } catch (e) { return false }
}
;(function initDiscord () {
  try {
    const DiscordRPC = require('discord-rpc')
    const clientId = '1526202636863406080' // GameBoostFPS Discord App
    rpc = new DiscordRPC.Client({ transport: 'ipc' })
    rpc.on('ready', () => { rpcReady = true; setDiscordActivity(null) }) // ตั้งสถานะเริ่มต้นทันที
    rpc.login({ clientId }).catch(() => { rpc = null })
  } catch (e) { rpc = null }
})()
ipcMain.handle('discord-set', (e, info) => ({ ok: setDiscordActivity(info) }))

app.whenReady().then(() => {
  createSplash()
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
