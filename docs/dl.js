// Points every download button (data-dl) at the right file for this computer: Windows, Mac or Linux.
(() => {
  const R = 'https://github.com/idkiforgatit/gallium/releases/latest/download/'
  const FILES = {
    win: { file: 'Gallium_1.0.0_x64-setup.exe', name: 'Windows' },
    mac: { file: 'Gallium_1.0.0_universal.dmg', name: 'Mac' },
    linux: { file: 'Gallium_1.0.0_amd64.AppImage', name: 'Linux' },
  }
  const p = (navigator.userAgentData?.platform || navigator.platform || '').toLowerCase(), ua = navigator.userAgent.toLowerCase()
  const phone = /android|iphone|ipad|mobile/.test(ua) // can't install it there; keep the default
  const os = phone ? 'win' : /mac/.test(p) ? 'mac' : /linux|x11|cros/.test(p) ? 'linux' : 'win'
  document.documentElement.dataset.os = os
  for (const a of document.querySelectorAll('[data-dl]')) {
    a.href = R + FILES[os].file
    const label = a.querySelector('.dl-name') // only buttons that say the platform change their words
    if (label) label.textContent = FILES[os].name
  }
})()
