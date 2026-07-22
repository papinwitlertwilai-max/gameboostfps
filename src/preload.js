const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('boost', {
  isDesktop: true,
  run: (cmd) => ipcRenderer.invoke('run-cmd', cmd),
  sysinfo: () => ipcRenderer.invoke('sysinfo'),
  restorePoint: (name) => ipcRenderer.invoke('restore-point', name),
  hwStats: () => ipcRenderer.invoke('hwstats'),
  quickPing: (host) => ipcRenderer.invoke('quick-ping', host),
  listGames: () => ipcRenderer.invoke('list-games'),
  overlayShow: () => ipcRenderer.invoke('overlay-show'),
  overlayHide: () => ipcRenderer.invoke('overlay-hide'),
  discordSet: (info) => ipcRenderer.invoke('discord-set', info)
})
