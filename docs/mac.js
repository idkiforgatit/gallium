// The hero: an interactive MacBook Pro (3D model by jackbaeten on Sketchfab, CC BY 4.0) with Gallium on its screen.
// The Sketchfab viewer API swaps the laptop's screen texture for real Gallium screenshots.
;(() => {
  const UID = '8e34fc2b303144f78490007d91ff57c4', SCREEN = 'sfCQkHOWyrsLmor'
  const IMG = 'https://idkiforgatit.github.io/gallium/img/' // absolute: the viewer loads these from inside its own frame
  const SHOTS = { home: 'home-glass.jpg', page: 'page-glass.jpg', dark: 'home-dark.jpg', overview: 'overview.jpg', search: 'search-dark.jpg' }
  const box = document.getElementById('mac'), frame = document.getElementById('mac-frame'), btns = [...document.querySelectorAll('#screens button')]
  const T = [6.55, .27, 6.82] // the model's centre
  const view = (dx, dy, dz, lift) => [[T[0] + dx, T[1] + dy, T[2] + dz], [T[0], T[1], T[2] + lift]]
  const FRONT = view(0, -40, 8, 1.4), START = view(26, -24, 12, 1.5)
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches
  let api, tex
  if (!window.Sketchfab) return box.classList.add('failed')
  new Sketchfab(frame).init(UID, {
    autostart: 1, preload: 1, transparent: 1, camera: 0, scrollwheel: 0, dnt: 1,
    ui_hint: 0, ui_infos: 0, ui_controls: 0, ui_stop: 0, ui_settings: 0, ui_help: 0, ui_inspector: 0, ui_vr: 0, ui_ar: 0, ui_fullscreen: 0, ui_annotations: 0, ui_loading: 0,
    success: a => { api = a; a.start(); a.addEventListener('viewerready', ready) },
    error: () => box.classList.add('failed'),
  })
  function ready() {
    api.setBackground({ color: [.961, .961, .969] })          // the page's own grey, so the model sits on the page
    api.setPostProcessing({ vignetteEnable: false })
    api.setCameraLookAt(...(calm ? FRONT : START), 0)
    api.addTexture(IMG + SHOTS.home, (err, uid) => {
      if (err) return box.classList.add('ready')
      tex = uid
      api.getMaterialList((e, mats) => {
        const m = mats?.find(x => x.name === SCREEN)
        if (!m) return box.classList.add('ready')
        m.channels.EmitColor.texture = { uid }; m.channels.EmitColor.enable = true; m.channels.EmitColor.factor = 1
        m.channels.AlbedoPBR.texture = { uid }; m.channels.AlbedoPBR.color = [0, 0, 0]
        api.setMaterial(m, () => {
          box.classList.add('ready')
          if (!calm) setTimeout(() => api.setCameraLookAt(...FRONT, 2.6), 350) // swing round to face you
        })
      })
    })
  }
  // switch what's on the screen
  btns.forEach(b => b.addEventListener('click', () => {
    btns.forEach(x => x.classList.toggle('on', x === b))
    if (api && tex) api.updateTexture(IMG + SHOTS[b.dataset.s], tex, () => {})
  }))
  document.getElementById('mac-reset').addEventListener('click', () => api && api.setCameraLookAt(...FRONT, 1.2))
  // on touch screens a one-finger drag should scroll the page, so turning the laptop is opt-in
  if (matchMedia('(pointer: coarse)').matches) {
    box.classList.add('touch')
    document.getElementById('mac-touch').addEventListener('click', () => box.classList.add('live'))
  }
})()
