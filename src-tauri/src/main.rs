#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
// Gallium was built on WebView2 (Windows). On macOS and Linux the WebView2-only extras (tab pictures, page menus,
// download cancel, mute, Chrome extensions, Defender) are switched off and their code isn't compiled.
#![cfg_attr(not(windows), allow(dead_code, unused_imports, unused_variables))]

use std::{path::PathBuf, sync::mpsc, time::Duration};
use tauri::{
    webview::{DownloadEvent, NewWindowResponse, PageLoadEvent, PlatformWebview, WebviewBuilder},
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Url, Webview, WebviewUrl,
};
#[cfg(windows)]
use webview2_com::{
    take_pwstr, BrowserExtensionEnableCompletedHandler, BrowserExtensionRemoveCompletedHandler, CapturePreviewCompletedHandler,
    FindActiveMatchIndexChangedEventHandler, FindMatchCountChangedEventHandler, FindStartCompletedHandler,
    BytesReceivedChangedEventHandler, ContextMenuRequestedEventHandler, DownloadStartingEventHandler, FocusChangedEventHandler,
    IsDocumentPlayingAudioChangedEventHandler, IsMutedChangedEventHandler, WindowCloseRequestedEventHandler,
    Microsoft::Web::WebView2::Win32::*, ProcessFailedEventHandler, ProfileAddBrowserExtensionCompletedHandler,
    ProfileGetBrowserExtensionsCompletedHandler,
};
#[cfg(windows)]
use windows::core::{Interface, BOOL, HSTRING, PWSTR};

// Injected into every tab. Tab webviews have no IPC, so browser shortcuts pressed
// inside a page are smuggled out as a window.open() to a fake host that we intercept.
// ponytail: a page could fake these too (worst case: it triggers a Gallium shortcut).
const KEYS_JS: &str = r#"(() => {
  const K = new Set(['ctrl+t','ctrl+l','ctrl+w','ctrl+s','ctrl+d','ctrl+r','f5','ctrl+shift+c','ctrl+shift+t','ctrl+tab',
    'ctrl+shift+tab','alt+arrowleft','alt+arrowright','ctrl+f','f12','ctrl+shift+i','ctrl+,','ctrl+j','ctrl+shift+a','ctrl+shift+m']);
  addEventListener('keydown', e => {
    const k = [(e.ctrlKey || e.metaKey) && 'ctrl', e.altKey && 'alt', e.shiftKey && 'shift', e.key.toLowerCase()].filter(Boolean).join('+');
    if (K.has(k) || /^ctrl\+[1-9]$/.test(k)) { e.preventDefault(); e.stopImmediatePropagation(); window.open('https://gallium.key/' + k); }
  }, true);
})()"#;

/// Gallium's own pages and IPC live on these hosts. A tab or popup must never load them, or that page
/// would run with the app's privileges.
fn is_internal(u: &Url) -> bool {
    matches!(u.scheme(), "tauri" | "ipc" | "asset")
        || matches!(u.host_str(), Some("tauri.localhost" | "ipc.localhost" | "asset.localhost"))
}

/// The shortcuts a page may relay (anything else sent to gallium.key is ignored).
fn is_shortcut(k: &str) -> bool {
    const K: [&str; 20] = ["ctrl+t", "ctrl+l", "ctrl+w", "ctrl+s", "ctrl+d", "ctrl+r", "f5", "ctrl+shift+c", "ctrl+shift+t", "ctrl+tab",
        "ctrl+shift+tab", "alt+arrowleft", "alt+arrowright", "ctrl+f", "f12", "ctrl+shift+i", "ctrl+,", "ctrl+j", "ctrl+shift+a", "ctrl+shift+m"];
    K.contains(&k) || matches!(k.as_bytes(), [b'c', b't', b'r', b'l', b'+', b'1'..=b'9'])
}

#[derive(Clone, serde::Serialize)]
struct TabEvent {
    id: String,
    url: Option<String>,
    title: Option<String>,
    loading: Option<bool>,
}

#[derive(Clone, serde::Serialize)]
struct Download {
    path: String,
    name: String,
    state: &'static str, // started | done | failed
}

#[derive(serde::Serialize)]
struct Ext {
    id: String,
    name: String,
    enabled: bool,
    page: Option<String>, // popup or options page, opened in a tab
    icon: Option<String>, // data: URL of the extension's own icon
    launch: Option<String>, // for extensions without a popup: the page their toolbar button opens
    mine: bool,           // installed by the user (false = a built-in WebView2 component)
}

fn label(id: &str) -> String {
    format!("t{id}")
}

fn tab(app: &AppHandle, id: &str) -> Result<Webview, String> {
    app.get_webview(&label(id)).ok_or_else(|| format!("no tab {id}"))
}

fn ui(app: &AppHandle) -> Result<Webview, String> {
    app.get_webview("ui").ok_or_else(|| "no ui".into())
}

/// Runs `f` with a webview's WebView2 objects on the UI thread and waits for what it sends back.
/// Only call from async commands (sync commands run on the UI thread and would deadlock).
// ponytail: blocks one async worker while WebView2 answers; fine for one call at a time.
#[cfg(windows)]
fn on_core<T: Send + 'static>(
    w: Webview,
    f: impl FnOnce(PlatformWebview, mpsc::Sender<T>) + Send + 'static,
) -> Result<T, String> {
    on_core_for(w, Duration::from_secs(30), f)
}

#[cfg(windows)]
fn on_core_for<T: Send + 'static>(
    w: Webview,
    wait: Duration,
    f: impl FnOnce(PlatformWebview, mpsc::Sender<T>) + Send + 'static,
) -> Result<T, String> {
    let (tx, rx) = mpsc::channel();
    w.with_webview(move |pv| f(pv, tx)).map_err(|e| e.to_string())?;
    rx.recv_timeout(wait).map_err(|_| "WebView2 did not answer".to_string())
}

/// Appends a line to gallium.log in the app's log folder, so crashes leave evidence.
fn log(app: &AppHandle, msg: &str) {
    use std::io::Write;
    let Ok(dir) = app.path().app_log_dir() else { return };
    let _ = std::fs::create_dir_all(&dir);
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(dir.join("gallium.log")) {
        let _ = writeln!(f, "[{secs}] {msg}");
    }
}



/// Watches a webview's WebView2 processes and calls `on_fail` when one dies or hangs.
#[cfg(windows)]
fn watch_crashes(w: &Webview, on_fail: impl Fn(COREWEBVIEW2_PROCESS_FAILED_KIND) + 'static + Send) {
    let _ = w.with_webview(move |pv| unsafe {
        let Ok(core) = pv.controller().CoreWebView2() else { return };
        let h = ProcessFailedEventHandler::create(Box::new(move |_, args| {
            let mut kind = COREWEBVIEW2_PROCESS_FAILED_KIND(-1);
            if let Some(a) = args {
                let _ = a.ProcessFailedKind(&mut kind);
            }
            on_fail(kind);
            Ok(())
        }));
        let mut tok = 0i64;
        let _ = core.add_ProcessFailed(&h, &mut tok);
    });
}

#[cfg(windows)]
thread_local! {
    // Downloads in progress, so the UI can cancel them. WebView2 objects only live on the UI thread.
    static DOWNLOADS: std::cell::RefCell<Vec<ICoreWebView2DownloadOperation>> = const { std::cell::RefCell::new(Vec::new()) };
}

#[cfg(windows)]
fn op_path(op: &ICoreWebView2DownloadOperation) -> String {
    let mut p = PWSTR::null();
    unsafe {
        let _ = op.ResultFilePath(&mut p);
    }
    take_pwstr(p)
}

/// Tracks a tab's downloads: progress goes to the UI (at most 4x a second) and each one can be cancelled.
#[cfg(windows)]
fn watch_downloads(w: &Webview, app: AppHandle) {
    let _ = w.with_webview(move |pv| unsafe {
        let Ok(core) = pv.controller().CoreWebView2().and_then(|c| c.cast::<ICoreWebView2_4>()) else { return };
        let started = DownloadStartingEventHandler::create(Box::new(move |_, args| {
            let Some(op) = args.and_then(|a| a.DownloadOperation().ok()) else { return Ok(()) };
            let (a, mut last) = (app.clone(), std::time::Instant::now());
            let progress = BytesReceivedChangedEventHandler::create(Box::new(move |op, _| {
                if let Some(op) = op {
                    if last.elapsed() >= Duration::from_millis(250) {
                        last = std::time::Instant::now();
                        let (mut got, mut total) = (0i64, 0i64);
                        let _ = op.BytesReceived(&mut got);
                        let _ = op.TotalBytesToReceive(&mut total);
                        let _ = a.emit("download-progress", (op_path(&op), got, total));
                    }
                }
                Ok(())
            }));
            let mut tok = 0i64;
            let _ = op.add_BytesReceivedChanged(&progress, &mut tok);
            DOWNLOADS.with(|d| {
                let mut d = d.borrow_mut();
                d.retain(|o| {
                    let mut st = COREWEBVIEW2_DOWNLOAD_STATE(0);
                    let _ = o.State(&mut st);
                    st == COREWEBVIEW2_DOWNLOAD_STATE_IN_PROGRESS
                });
                d.push(op);
            });
            Ok(())
        }));
        let mut tok = 0i64;
        let _ = core.add_DownloadStarting(&started, &mut tok);
    });
}

#[cfg(windows)]
#[tauri::command]
async fn download_cancel(app: AppHandle, path: String) -> Result<(), String> {
    on_core(ui(&app)?, move |_, tx| {
        DOWNLOADS.with(|d| {
            for op in d.borrow().iter().filter(|op| op_path(op) == path) {
                unsafe {
                    let _ = op.Cancel();
                }
            }
        });
        let _ = tx.send(());
    })
}

#[cfg(not(windows))]
#[tauri::command]
async fn download_cancel(path: String) -> Result<(), String> {
    Err("Cancelling downloads isn't available on this system yet".into())
}

// ---------------- right-click menus ----------------
// Gallium draws its own menu: the page's request is held open (a deferral) until the UI says which item
// was picked, then WebView2 runs that built-in command (copy, paste, save image, inspect, spelling...).

#[derive(Clone, serde::Serialize)]
struct MenuItem {
    id: i32,
    name: String,
    label: String,
    kind: &'static str, // command | check | radio | separator | submenu
    enabled: bool,
    checked: bool,
    shortcut: String,
    children: Vec<MenuItem>,
}

#[derive(Clone, serde::Serialize)]
struct MenuRequest {
    req: u32,
    tab: String,
    x: f64,
    y: f64,
    target: &'static str, // page | image | text | audio | video
    editable: bool,
    link: String,
    src: String,
    selection: String,
    items: Vec<MenuItem>,
}

#[cfg(windows)]
thread_local! {
    static MENUS: std::cell::RefCell<std::collections::HashMap<u32, (ICoreWebView2ContextMenuRequestedEventArgs, ICoreWebView2Deferral)>> =
        std::cell::RefCell::new(std::collections::HashMap::new());
}
#[cfg(windows)]
static NEXT_MENU: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(1);

#[cfg(windows)]
fn pwstr(f: impl FnOnce(*mut PWSTR) -> windows::core::Result<()>) -> String {
    let mut p = PWSTR::null();
    if f(&mut p).is_ok() { take_pwstr(p) } else { String::new() }
}

#[cfg(windows)]
fn flag(f: impl FnOnce(*mut BOOL) -> windows::core::Result<()>) -> bool {
    let mut b = BOOL(0);
    f(&mut b).is_ok() && b.as_bool()
}

#[cfg(windows)]
fn read_menu(list: &ICoreWebView2ContextMenuItemCollection) -> Vec<MenuItem> {
    let mut out = vec![];
    unsafe {
        let mut n = 0;
        let _ = list.Count(&mut n);
        for i in 0..n {
            let Ok(it) = list.GetValueAtIndex(i) else { continue };
            let (mut id, mut kind) = (0, COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND(0));
            let _ = it.CommandId(&mut id);
            let _ = it.Kind(&mut kind);
            let kind = match kind {
                COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_SEPARATOR => "separator",
                COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_SUBMENU => "submenu",
                COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_CHECK_BOX => "check",
                COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_RADIO => "radio",
                _ => "command",
            };
            out.push(MenuItem {
                id,
                name: pwstr(|p| it.Name(p)),
                label: pwstr(|p| it.Label(p)),
                kind,
                enabled: flag(|b| it.IsEnabled(b)),
                checked: flag(|b| it.IsChecked(b)),
                shortcut: pwstr(|p| it.ShortcutKeyDescription(p)),
                children: if kind == "submenu" { it.Children().map(|c| read_menu(&c)).unwrap_or_default() } else { vec![] },
            });
        }
    }
    out
}

#[cfg(windows)]
fn watch_menus(w: &Webview, app: AppHandle, tab: String) {
    let scale = w.window().scale_factor().unwrap_or(1.0);
    let _ = w.with_webview(move |pv| unsafe {
        let Ok(core) = pv.controller().CoreWebView2().and_then(|c| c.cast::<ICoreWebView2_11>()) else { return };
        let h = ContextMenuRequestedEventHandler::create(Box::new(move |_, args| {
            let Some(a) = args else { return Ok(()) };
            let t = a.ContextMenuTarget()?;
            let mut kind = COREWEBVIEW2_CONTEXT_MENU_TARGET_KIND(0);
            let _ = t.Kind(&mut kind);
            let mut pt = windows::Win32::Foundation::POINT::default();
            let _ = a.Location(&mut pt);
            let items = read_menu(&a.MenuItems()?);
            a.SetHandled(true)?; // no native menu; ours is shown instead
            let req = NEXT_MENU.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            let deferral = a.GetDeferral()?;
            MENUS.with(|m| m.borrow_mut().insert(req, (a.clone(), deferral)));
            let _ = app.emit("context-menu", MenuRequest {
                req,
                tab: tab.clone(),
                x: pt.x as f64 / scale,
                y: pt.y as f64 / scale,
                target: match kind {
                    COREWEBVIEW2_CONTEXT_MENU_TARGET_KIND_IMAGE => "image",
                    COREWEBVIEW2_CONTEXT_MENU_TARGET_KIND_SELECTED_TEXT => "text",
                    COREWEBVIEW2_CONTEXT_MENU_TARGET_KIND_AUDIO => "audio",
                    COREWEBVIEW2_CONTEXT_MENU_TARGET_KIND_VIDEO => "video",
                    _ => "page",
                },
                editable: flag(|b| t.IsEditable(b)),
                link: if flag(|b| t.HasLinkUri(b)) { pwstr(|p| t.LinkUri(p)) } else { String::new() },
                src: if flag(|b| t.HasSourceUri(b)) { pwstr(|p| t.SourceUri(p)) } else { String::new() },
                selection: if flag(|b| t.HasSelection(b)) { pwstr(|p| t.SelectionText(p)) } else { String::new() },
                items,
            });
            Ok(())
        }));
        let mut tok = 0i64;
        let _ = core.add_ContextMenuRequested(&h, &mut tok);
    });
}

/// Finishes a page's right-click: cmd = the built-in item to run, or -1 for none.
#[cfg(windows)]
#[tauri::command]
async fn menu_pick(app: AppHandle, req: u32, cmd: i32) -> Result<(), String> {
    on_core(ui(&app)?, move |_, tx| {
        MENUS.with(|m| {
            if let Some((a, d)) = m.borrow_mut().remove(&req) {
                unsafe {
                    if cmd >= 0 {
                        let _ = a.SetSelectedCommandId(cmd);
                    }
                    let _ = d.Complete();
                }
            }
        });
        let _ = tx.send(());
    })
}

#[cfg(not(windows))]
#[tauri::command]
async fn menu_pick(req: u32, cmd: i32) -> Result<(), String> {
    Ok(()) // pages show the system's own right-click menu here
}

// ---------------- sound ----------------

#[cfg(windows)]
fn emit_audio(app: &AppHandle, id: &str, core: &ICoreWebView2_8) {
    let (mut playing, mut muted) = (BOOL(0), BOOL(0));
    unsafe {
        let _ = core.IsDocumentPlayingAudio(&mut playing);
        let _ = core.IsMuted(&mut muted);
    }
    let _ = app.emit("tab-audio", (id, playing.as_bool(), muted.as_bool()));
}

/// Tells the UI when a tab starts/stops making sound or is (un)muted, so it can show the speaker icon.
#[cfg(windows)]
fn watch_audio(w: &Webview, app: AppHandle, id: String, muted: bool) {
    let _ = w.with_webview(move |pv| unsafe {
        let Ok(core) = pv.controller().CoreWebView2().and_then(|c| c.cast::<ICoreWebView2_8>()) else { return };
        if muted {
            let _ = core.SetIsMuted(true); // remembered from last time
        }
        let (a1, i1) = (app.clone(), id.clone());
        let playing = IsDocumentPlayingAudioChangedEventHandler::create(Box::new(move |c, _| {
            if let Some(c) = c.and_then(|c| c.cast::<ICoreWebView2_8>().ok()) { emit_audio(&a1, &i1, &c) }
            Ok(())
        }));
        let mute = IsMutedChangedEventHandler::create(Box::new(move |c, _| {
            if let Some(c) = c.and_then(|c| c.cast::<ICoreWebView2_8>().ok()) { emit_audio(&app, &id, &c) }
            Ok(())
        }));
        let mut tok = 0i64;
        let _ = core.add_IsDocumentPlayingAudioChanged(&playing, &mut tok);
        let _ = core.add_IsMutedChanged(&mute, &mut tok);
    });
}

#[cfg(windows)]
#[tauri::command]
fn tab_mute(app: AppHandle, id: String, muted: bool) -> Result<(), String> {
    tab(&app, &id)?
        .with_webview(move |pv| unsafe {
            if let Ok(c) = pv.controller().CoreWebView2().and_then(|c| c.cast::<ICoreWebView2_8>()) {
                let _ = c.SetIsMuted(muted);
            }
        })
        .map_err(|e| e.to_string())
}

#[cfg(not(windows))]
#[tauri::command]
fn tab_mute(id: String, muted: bool) -> Result<(), String> {
    Err("Muting tabs isn't available on this system yet".into())
}

#[cfg(windows)]
fn emit_find(app: &AppHandle, id: &str, f: &ICoreWebView2Find) {
    let (mut i, mut n) = (0, 0);
    unsafe {
        let _ = f.ActiveMatchIndex(&mut i);
        let _ = f.MatchCount(&mut n);
    }
    let _ = app.emit("find", (id, i, n));
}

fn file_name(p: &std::path::Path) -> String {
    p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
}

// ---------------- tabs ----------------

/// Async on purpose: creating a webview inside a sync command deadlocks on Windows
/// (sync commands run on the main thread, which the new webview needs). See tauri#4121.
#[tauri::command]
async fn tab_open(app: AppHandle, id: String, url: String, r: [f64; 4], muted: Option<bool>) -> Result<(), String> {
    let win = app.get_window("main").ok_or("no window")?;
    let url: Url = url.parse().map_err(|e| format!("{e}"))?;
    if is_internal(&url) {
        return Err("That address can't be opened in a tab".into());
    }
    let (a1, a2, a3, a4) = (app.clone(), app.clone(), app.clone(), app.clone());
    let (i1, i2) = (id.clone(), id.clone());
    let builder = WebviewBuilder::new(label(&id), WebviewUrl::External(url))
        .on_navigation(|u| !is_internal(u))
        .browser_extensions_enabled(true)
        .initialization_script(KEYS_JS)
        .on_document_title_changed(move |w, title| {
            let url = w.url().ok().map(|u| u.to_string());
            let _ = a1.emit("tab", TabEvent { id: i1.clone(), url, title: Some(title), loading: None });
        })
        .on_page_load(move |_, p| {
            let loading = matches!(p.event(), PageLoadEvent::Started);
            let _ = a2.emit("tab", TabEvent { id: i2.clone(), url: Some(p.url().to_string()), title: None, loading: Some(loading) });
        })
        .on_new_window(move |u, _| {
            if u.host_str() == Some("gallium.key") {
                let k = u.path().trim_start_matches('/');
                if is_shortcut(k) {
                    let _ = a3.emit("shortcut", k);
                }
            } else if !is_internal(&u) {
                let _ = a3.emit("open-tab", u.to_string());
            }
            NewWindowResponse::Deny
        })
        .on_download(move |_, ev| {
            let d = match ev {
                DownloadEvent::Requested { destination, .. } => {
                    Download { path: destination.display().to_string(), name: file_name(destination), state: "started" }
                }
                DownloadEvent::Finished { path: Some(p), success, .. } => {
                    Download { path: p.display().to_string(), name: file_name(&p), state: if success { "done" } else { "failed" } }
                }
                _ => return true,
            };
            let _ = a4.emit("download", d);
            true
        });
    let w = win
        .add_child(builder, LogicalPosition::new(r[0], r[1]), LogicalSize::new(r[2], r[3]))
        .map_err(|e| e.to_string())?;

    #[cfg(windows)]
    {
    // A crashed or hung page reloads itself (at most every 5s, so a page that keeps crashing can't loop).
    let (a5, i5, w5) = (app.clone(), id.clone(), w.clone());
    let last = std::sync::Mutex::new(None::<std::time::Instant>);
    watch_crashes(&w, move |kind| {
        log(&a5, &format!("tab {i5}: WebView2 process failed (kind {})", kind.0));
        let page_died = kind == COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED
            || kind == COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE;
        let mut last = last.lock().unwrap_or_else(|e| e.into_inner());
        if page_died && last.map_or(true, |t| t.elapsed() > Duration::from_secs(5)) {
            *last = Some(std::time::Instant::now());
            let _ = w5.reload();
            let _ = a5.emit("tab-crash", &i5);
        }
    });

    watch_downloads(&w, app.clone());
    watch_menus(&w, app.clone(), id.clone());
    watch_audio(&w, app.clone(), id.clone(), muted.unwrap_or(false));

    // Report find-in-page progress ("3 of 12") back to the UI.
    let _ = w.with_webview(move |pv| unsafe {
        let Ok(find) = pv.controller().CoreWebView2().and_then(|c| c.cast::<ICoreWebView2_28>()).and_then(|c| c.Find()) else { return };
        let (a, i) = (app.clone(), id.clone());
        let on_count = FindMatchCountChangedEventHandler::create(Box::new(move |f, _| {
            if let Some(f) = f { emit_find(&a, &i, &f) }
            Ok(())
        }));
        let on_index = FindActiveMatchIndexChangedEventHandler::create(Box::new(move |f, _| {
            if let Some(f) = f { emit_find(&app, &id, &f) }
            Ok(())
        }));
        let mut tok = 0i64;
        let _ = find.add_MatchCountChanged(&on_count, &mut tok);
        let _ = find.add_ActiveMatchIndexChanged(&on_index, &mut tok);
    });
    }
    Ok(())
}

/// Put tab `id` (or nothing) at rect `r`; park every other tab off-screen.
/// Parking instead of hiding keeps pages painted, so switching tabs is instant.
// ponytail: parked tabs keep rendering; unload long-idle tabs if memory becomes a problem.
#[tauri::command]
fn tab_show(app: AppHandle, id: Option<String>, r: [f64; 4], radius: f64, focus: bool) {
    let target = id.map(|i| label(&i));
    for (name, w) in app.webviews() {
        if name == "ui" || name == POPUP {
            continue;
        }
        let _ = w.set_size(LogicalSize::new(r[2], r[3]));
        if Some(&name) == target.as_ref() {
            let _ = w.set_position(LogicalPosition::new(r[0], r[1]));
            round_corners(&w, r[2], r[3], radius);
            if focus {
                let _ = w.set_focus();
            }
        } else {
            let _ = w.set_position(LogicalPosition::new(-30000.0, -30000.0));
        }
    }
    if focus && target.is_none() {
        ui_focus(app);
    }
}

/// Clips a tab's native window to rounded corners so it matches the frame drawn by the UI.
#[cfg(windows)]
fn round_corners(w: &Webview, width: f64, height: f64, radius: f64) {
    use windows::Win32::{Foundation::HWND, Graphics::Gdi::{CreateRoundRectRgn, SetWindowRgn}};
    let scale = w.window().scale_factor().unwrap_or(1.0);
    let px = |v: f64| (v * scale).round() as i32;
    let (wd, ht, d) = (px(width), px(height), px(radius * 2.0));
    let _ = w.with_webview(move |pv| unsafe {
        let mut hwnd = HWND::default();
        if pv.controller().ParentWindow(&mut hwnd).is_ok() {
            // Windows takes ownership of the region.
            SetWindowRgn(hwnd, Some(CreateRoundRectRgn(0, 0, wd + 1, ht + 1, d, d)), true);
        }
    });
}

#[cfg(not(windows))]
fn round_corners(_: &Webview, _: f64, _: f64, _: f64) {}

#[tauri::command]
fn ui_focus(app: AppHandle) {
    if let Ok(w) = ui(&app) {
        let _ = w.set_focus();
    }
}

#[tauri::command]
fn tab_nav(app: AppHandle, id: String, url: String) -> Result<(), String> {
    tab(&app, &id)?.navigate(url.parse().map_err(|e| format!("{e}"))?).map_err(|e| e.to_string())
}

/// Runs a fixed action in a tab. Only these, never arbitrary JS from the UI.
#[tauri::command]
fn tab_do(app: AppHandle, id: String, action: String) -> Result<(), String> {
    let w = tab(&app, &id)?;
    let js = match action.as_str() {
        "devtools" => return Ok(w.open_devtools()),
        "back" => "history.back()",
        "forward" => "history.forward()",
        "reload" => "location.reload()",
        "copy" => "navigator.clipboard.writeText(location.href)",
        _ => return Err("unknown action".into()),
    };
    w.eval(js).map_err(|e| e.to_string())
}

#[tauri::command]
fn tab_close(app: AppHandle, id: String) {
    if let Ok(w) = tab(&app, &id) {
        let _ = w.close();
    }
}

/// Closes every tab view. The UI calls this when it (re)starts, so tabs left over
/// from a reloaded UI never collide with new ones.
#[tauri::command]
fn tab_close_all(app: AppHandle) {
    for (name, w) in app.webviews() {
        if name != "ui" {
            let _ = w.close();
        }
    }
}

/// Window backdrop for glass themes: none | mica | acrylic | tabbed.
#[tauri::command]
fn set_material(app: AppHandle, kind: String, dark: bool) -> Result<(), String> {
    use tauri::window::{Effect, EffectsBuilder};
    let win = app.get_window("main").ok_or("no window")?;
    #[cfg(target_os = "macos")]
    let effect = match kind.as_str() {
        "none" => return win.set_effects(None).map_err(|e| e.to_string()),
        _ => Effect::UnderWindowBackground,
    };
    #[cfg(not(target_os = "macos"))]
    let effect = match (kind.as_str(), dark) {
        ("mica", false) => Effect::MicaLight,
        ("mica", true) => Effect::MicaDark,
        ("tabbed", false) => Effect::TabbedLight,
        ("tabbed", true) => Effect::TabbedDark,
        ("acrylic", _) => Effect::Acrylic,
        _ => return win.set_effects(None).map_err(|e| e.to_string()),
    };
    win.set_effects(EffectsBuilder::new().effect(effect).build()).map_err(|e| e.to_string())
}

/// JPEG snapshot of a tab, so the UI can draw over (or animate) a picture of the page.
#[cfg(windows)]
#[tauri::command]
async fn tab_snap(app: AppHandle, id: String) -> Result<tauri::ipc::Response, String> {
    use windows::Win32::UI::Shell::{IStream_Read, IStream_Reset, IStream_Size, SHCreateMemStream};
    // Short wait: the UI falls back to no picture rather than freezing.
    let bytes = on_core_for(tab(&app, &id)?, Duration::from_millis(1500), |pv, tx| unsafe {
        let (Ok(core), Some(stream)) = (pv.controller().CoreWebView2(), SHCreateMemStream(None)) else { return };
        let s = stream.clone();
        let done = CapturePreviewCompletedHandler::create(Box::new(move |res| {
            if res.is_ok() {
                let len = IStream_Size(&s).unwrap_or(0) as usize;
                let mut buf = vec![0u8; len];
                if IStream_Reset(&s).is_ok() && IStream_Read(&s, buf.as_mut_ptr().cast(), len as u32).is_ok() {
                    let _ = tx.send(buf);
                }
            }
            Ok(())
        }));
        let _ = core.CapturePreview(COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_JPEG, &stream, &done);
    })?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[cfg(not(windows))]
#[tauri::command]
async fn tab_snap(id: String) -> Result<tauri::ipc::Response, String> {
    Err("no snapshots on this system".into()) // the UI carries on without a picture
}

/// Find in page: op = start | next | prev | stop.
#[cfg(windows)]
#[tauri::command]
async fn tab_find(app: AppHandle, id: String, op: String, term: String) -> Result<(), String> {
    on_core(tab(&app, &id)?, move |pv, tx| unsafe {
        let r = (|| -> windows::core::Result<()> {
            let find = pv.controller().CoreWebView2()?.cast::<ICoreWebView2_28>()?.Find()?;
            match op.as_str() {
                "next" => find.FindNext(),
                "prev" => find.FindPrevious(),
                "stop" => find.Stop(),
                _ => {
                    let opts = pv.environment().cast::<ICoreWebView2Environment15>()?.CreateFindOptions()?;
                    opts.SetFindTerm(&HSTRING::from(term.as_str()))?;
                    opts.SetSuppressDefaultFindDialog(true)?;
                    opts.SetShouldHighlightAllMatches(true)?;
                    find.Start(&opts, &FindStartCompletedHandler::create(Box::new(|_| Ok(()))))
                }
            }
        })();
        let _ = tx.send(r.map_err(|e| e.message()));
    })?
}

#[cfg(not(windows))]
#[tauri::command]
async fn tab_find(app: AppHandle, id: String, op: String, term: String) -> Result<(), String> {
    // WebKit's own find: selects the next match (no match count)
    let t = serde_json::to_string(&term).map_err(|e| e.to_string())?;
    let js = match op.as_str() {
        "stop" => "getSelection().removeAllRanges()".to_string(),
        "prev" => format!("window.find({t}, false, true, true)"),
        _ => format!("window.find({t}, false, false, true)"),
    };
    tab(&app, &id)?.eval(js).map_err(|e| e.to_string())
}

// ---------------- extension popups ----------------
// An extension's popup opens in a small floating window under its toolbar button (like Chrome),
// sized to its content, and closes when it loses focus, on Esc, or when the extension closes it.

const POPUP: &str = "extpop";
const POPUP_JS: &str = r#"addEventListener('keydown', e => { if (e.key === 'Escape') window.open('https://gallium.key/popup-close') }, true)"#;
// Width: the body's own width if it sets one (else the starting 360px); height: everything on the page.
const MEASURE_JS: &str = r#"(() => { const b = document.body || document.documentElement, cs = getComputedStyle(b), d = document.documentElement;
  const w = Math.ceil(b.getBoundingClientRect().width + parseFloat(cs.marginLeft || 0) + parseFloat(cs.marginRight || 0));
  return JSON.stringify([Math.max(w, d.scrollWidth > 360 ? d.scrollWidth : 0), d.scrollHeight]) })()"#;

fn close_popup(app: &AppHandle, why: &str) {
    if let Some(w) = app.get_webview(POPUP) {
        log(app, &format!("extension popup closed: {why}"));
        let _ = w.close();
        let _ = app.emit("ext-popup-closed", ());
    }
}

/// Fits the popup to its content (200-800 x 60-600, like Chrome), right edge under the button.
#[cfg(windows)]
fn fit_popup(w: &Webview, right: f64, top: f64) {
    let w2 = w.clone();
    let _ = w.eval_with_callback(MEASURE_JS, move |res| {
        let dims: Option<[f64; 2]> = serde_json::from_str(&res)
            .ok()
            .or_else(|| serde_json::from_str::<String>(&res).ok().and_then(|s| serde_json::from_str(&s).ok()));
        if let Some([cw, ch]) = dims {
            let (wd, ht) = (cw.clamp(200.0, 800.0), ch.clamp(60.0, 600.0));
            let _ = w2.set_size(LogicalSize::new(wd, ht));
            let _ = w2.set_position(LogicalPosition::new((right - wd).max(8.0), top));
            round_corners(&w2, wd, ht, 12.0);
        }
    });
}

#[cfg(windows)]
#[tauri::command]
async fn ext_popup(app: AppHandle, url: String, right: f64, top: f64) -> Result<(), String> {
    close_popup(&app, "replaced");
    for _ in 0..30 {
        if app.get_webview(POPUP).is_none() {
            break; // the old popup is gone, so its label can be reused
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    let win = app.get_window("main").ok_or("no window")?;
    let url: Url = url.parse().map_err(|e| format!("{e}"))?;
    if is_internal(&url) {
        return Err("blocked".into());
    }
    let a1 = app.clone();
    let builder = WebviewBuilder::new(POPUP, WebviewUrl::External(url))
        .on_navigation(|u| !is_internal(u))
        .browser_extensions_enabled(true)
        .initialization_script(POPUP_JS)
        .on_new_window(move |u, _| {
            if u.host_str() != Some("gallium.key") && !is_internal(&u) {
                let _ = a1.emit("open-tab", u.to_string()); // links from a popup open as tabs
            }
            close_popup(&a1, "new window / esc");
            NewWindowResponse::Deny
        })
        .on_page_load(move |w, p| {
            if matches!(p.event(), PageLoadEvent::Finished) {
                fit_popup(&w, right, top);
                // popups often render after load; measure again as they settle
                std::thread::spawn(move || {
                    for ms in [300, 900] {
                        std::thread::sleep(Duration::from_millis(ms));
                        fit_popup(&w, right, top);
                    }
                });
            }
        });
    // starts off-screen; fit_popup moves it into place once it knows its size
    let w = win
        .add_child(builder, LogicalPosition::new(-30000.0, -30000.0), LogicalSize::new(360.0, 120.0))
        .map_err(|e| e.to_string())?;
    let (a2, a3) = (app.clone(), app.clone());
    let _ = w.with_webview(move |pv| unsafe {
        let ctl = pv.controller();
        let mut tok = 0i64;
        // Close on focus loss, but only once it has really had focus (Windows may refuse focus while
        // Gallium is in the background, and that is not the user clicking away).
        let had_focus = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let hf = had_focus.clone();
        let got = FocusChangedEventHandler::create(Box::new(move |_, _| {
            hf.store(true, std::sync::atomic::Ordering::Relaxed);
            Ok(())
        }));
        let _ = ctl.add_GotFocus(&got, &mut tok);
        // closing from inside the popup's own event would tear it down mid-callback, so hop threads first
        // focus can bounce while the popup is being created; only later focus loss means "clicked away"
        let born = std::time::Instant::now();
        let lost = FocusChangedEventHandler::create(Box::new(move |_, _| {
            if had_focus.load(std::sync::atomic::Ordering::Relaxed) && born.elapsed() > Duration::from_millis(500) {
                let a = a2.clone();
                std::thread::spawn(move || close_popup(&a, "lost focus"));
            }
            Ok(())
        }));
        let _ = ctl.add_LostFocus(&lost, &mut tok);
        if let Ok(core) = ctl.CoreWebView2() {
            let closed = WindowCloseRequestedEventHandler::create(Box::new(move |_, _| {
                let a = a3.clone();
                std::thread::spawn(move || close_popup(&a, "window.close"));
                Ok(())
            }));
            let _ = core.add_WindowCloseRequested(&closed, &mut tok);
        }
    });
    let _ = w.set_focus();
    Ok(())
}

#[cfg(not(windows))]
#[tauri::command]
async fn ext_popup(url: String, right: f64, top: f64) -> Result<(), String> {
    Err("Extensions need Windows for now".into())
}

#[tauri::command]
fn ext_popup_close(app: AppHandle) {
    close_popup(&app, "ui click");
}

// ---------------- extensions (Chrome Web Store) ----------------

fn ext_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("extensions"))
}

/// Maps a WebView2 extension id to the folder we unpacked it into.
fn ext_index(app: &AppHandle) -> serde_json::Map<String, serde_json::Value> {
    ext_dir(app)
        .and_then(|d| std::fs::read_to_string(d.join("index.json")).map_err(|e| e.to_string()))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// The extension's popup (or options) page, read from its manifest.
/// The extension's own icon (the largest up to 128px from its manifest), as a data: URL the UI can show.
fn ext_icon(dir: &std::path::Path) -> Option<String> {
    use base64::Engine;
    let m: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(dir.join("manifest.json")).ok()?).ok()?;
    let icons = m.get("icons")?.as_object()?;
    let (_, file) = icons
        .iter()
        .filter_map(|(k, v)| Some((k.parse::<u32>().ok()?, v.as_str()?)))
        .max_by_key(|(size, _)| if *size <= 128 { *size } else { 0 })?;
    let path = dir.join(file.trim_start_matches('/')).canonicalize().ok()?;
    if !path.starts_with(dir.canonicalize().ok()?) {
        return None; // the manifest points outside the extension
    }
    let bytes = std::fs::read(path).ok()?;
    let mime = if file.ends_with(".svg") { "image/svg+xml" } else if file.ends_with(".jpg") || file.ends_with(".jpeg") { "image/jpeg" } else { "image/png" };
    Some(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

/// What clicking the toolbar button of an extension *without* a popup opens: its new-tab page, or the
/// page its background script opens with chrome.tabs.create({ url }) (the usual "open my app" pattern).
fn ext_launch(dir: &std::path::Path) -> Option<String> {
    let m: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(dir.join("manifest.json")).ok()?).ok()?;
    if let Some(p) = m.pointer("/chrome_url_overrides/newtab").and_then(|v| v.as_str()) {
        return Some(p.to_string());
    }
    let mut scripts: Vec<String> = vec![];
    if let Some(sw) = m.pointer("/background/service_worker").and_then(|v| v.as_str()) {
        scripts.push(sw.to_string());
    }
    if let Some(list) = m.pointer("/background/scripts").and_then(|v| v.as_array()) {
        scripts.extend(list.iter().filter_map(|v| v.as_str().map(String::from)));
    }
    for sc in scripts {
        let Ok(src) = std::fs::read_to_string(dir.join(sc.trim_start_matches('/'))) else { continue };
        let Some(i) = src.find("tabs.create") else { continue };
        let mut end = src.len().min(i + 400);
        while !src.is_char_boundary(end) {
            end -= 1;
        }
        let rest = &src[i..end];
        let Some(u) = rest.find("url") else { continue };
        let rest = &rest[u + 3..];
        let Some(q) = rest.find(['"', '\'', '`']) else { continue };
        let quote = rest[q..].chars().next()?;
        let body = &rest[q + 1..];
        if let Some(end) = body.find(quote) {
            if end > 0 {
                return Some(body[..end].to_string());
            }
        }
    }
    None
}

fn ext_page(dir: &std::path::Path) -> Option<String> {
    let m: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(dir.join("manifest.json")).ok()?).ok()?;
    ["/action/default_popup", "/browser_action/default_popup", "/options_ui/page", "/options_page"]
        .iter()
        .find_map(|p| m.pointer(p)?.as_str().map(str::to_owned))
}

#[cfg(windows)]
unsafe fn ext_info(e: &ICoreWebView2BrowserExtension) -> (String, String, bool) {
    let (mut id, mut name, mut on) = (PWSTR::null(), PWSTR::null(), BOOL(0));
    let _ = e.Id(&mut id);
    let _ = e.Name(&mut name);
    let _ = e.IsEnabled(&mut on);
    (take_pwstr(id), take_pwstr(name), on.as_bool())
}

#[cfg(windows)]
fn profile(pv: &PlatformWebview) -> windows::core::Result<ICoreWebView2Profile7> {
    unsafe { pv.controller().CoreWebView2()?.cast::<ICoreWebView2_13>()?.Profile()?.cast() }
}

/// Calls `f` with every installed extension (on the UI thread).
#[cfg(windows)]
fn each_ext(pv: PlatformWebview, f: impl FnOnce(Vec<ICoreWebView2BrowserExtension>) + 'static) {
    let Ok(p) = profile(&pv) else { return f(vec![]) };
    let done = ProfileGetBrowserExtensionsCompletedHandler::create(Box::new(move |_, list| {
        let mut out = vec![];
        if let Some(list) = list {
            let mut n = 0;
            unsafe {
                let _ = list.Count(&mut n);
                out = (0..n).filter_map(|i| list.GetValueAtIndex(i).ok()).collect();
            }
        }
        f(out);
        Ok(())
    }));
    unsafe {
        let _ = p.GetBrowserExtensions(&done);
    }
}

#[cfg(windows)]
#[tauri::command]
async fn ext_list(app: AppHandle) -> Result<Vec<Ext>, String> {
    let list = on_core(ui(&app)?, |pv, tx| {
        each_ext(pv, move |exts| {
            let _ = tx.send(exts.iter().map(|e| unsafe { ext_info(e) }).collect::<Vec<_>>());
        })
    })?;
    let index = ext_index(&app);
    Ok(list
        .into_iter()
        .map(|(id, name, enabled)| {
            let dir = index.get(&id).and_then(|d| d.as_str()).map(std::path::PathBuf::from);
            let page = dir.as_deref().and_then(ext_page).map(|p| format!("chrome-extension://{id}/{}", p.trim_start_matches('/')));
            let icon = dir.as_deref().and_then(ext_icon);
            let launch = if page.is_some() { None } else {
                dir.as_deref().and_then(ext_launch).map(|u| if u.contains("://") { u } else { format!("chrome-extension://{id}/{}", u.trim_start_matches('/')) })
            };
            Ext { id, name, enabled, page, icon, launch, mine: dir.is_some() }
        })
        .collect())
}

#[cfg(not(windows))]
#[tauri::command]
async fn ext_list() -> Result<Vec<Ext>, String> {
    Ok(vec![]) // Chrome extensions need WebView2 (Windows)
}

/// action = enable | disable | remove
#[cfg(windows)]
#[tauri::command]
async fn ext_set(app: AppHandle, id: String, action: String) -> Result<(), String> {
    on_core(ui(&app)?, move |pv, tx| {
        each_ext(pv, move |exts| unsafe {
            let Some(e) = exts.into_iter().find(|e| ext_info(e).0 == id) else { return };
            let tx2 = tx.clone();
            let _ = if action == "remove" {
                e.Remove(&BrowserExtensionRemoveCompletedHandler::create(Box::new(move |_| { let _ = tx2.send(()); Ok(()) })))
            } else {
                e.Enable(action == "enable", &BrowserExtensionEnableCompletedHandler::create(Box::new(move |_| { let _ = tx2.send(()); Ok(()) })))
            };
        })
    })
}

#[cfg(not(windows))]
#[tauri::command]
async fn ext_set(id: String, action: String) -> Result<(), String> {
    Err("Extensions need Windows for now".into())
}

/// Strips the CRX header (v2 or v3) and returns the zip inside.
fn crx_zip(b: &[u8]) -> Option<&[u8]> {
    let u32_at = |i: usize| Some(u32::from_le_bytes(b.get(i..i + 4)?.try_into().ok()?) as usize);
    if b.get(..4)? != b"Cr24" {
        return None;
    }
    let start = match u32_at(4)? {
        3 => 12 + u32_at(8)?,
        2 => 16 + u32_at(8)? + u32_at(12)?,
        _ => return None,
    };
    b.get(start..)
}

/// Downloads an extension from the Chrome Web Store and installs it into WebView2.
#[cfg(windows)]
#[tauri::command]
async fn ext_install(app: AppHandle, store_id: String) -> Result<Ext, String> {
    if store_id.len() != 32 || !store_id.bytes().all(|c| (b'a'..=b'p').contains(&c)) {
        return Err("not a Chrome Web Store extension id".into());
    }
    let dir = ext_dir(&app)?.join(&store_id);
    let d = dir.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let url = format!(
            "https://clients2.google.com/service/update2/crx?response=redirect&prodversion=150.0&acceptformat=crx2,crx3&x=id%3D{store_id}%26uc"
        );
        let crx = ureq::get(&url)
            .call()
            .map_err(|e| e.to_string())?
            .body_mut()
            .with_config()
            .limit(200 * 1024 * 1024)
            .read_to_vec()
            .map_err(|e| e.to_string())?;
        let zip = crx_zip(&crx).ok_or("download was not a valid extension")?;
        let mut z = zip::ZipArchive::new(std::io::Cursor::new(zip)).map_err(|e| e.to_string())?;
        let unpacked: u64 = (0..z.len()).filter_map(|i| z.by_index(i).ok().map(|f| f.size())).sum();
        if unpacked > 500 * 1024 * 1024 {
            return Err("That extension is too large to install".into());
        }
        let _ = std::fs::remove_dir_all(&d);
        z.extract(&d).map_err(|e| e.to_string())?;
        // Chrome's signature folder; unpacked extensions may not contain "_" names.
        let _ = std::fs::remove_dir_all(d.join("_metadata"));
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())??;

    let path = dir.display().to_string();
    let (id, name, enabled) = on_core(ui(&app)?, move |pv, tx| {
        let Ok(p) = profile(&pv) else { return };
        let done = ProfileAddBrowserExtensionCompletedHandler::create(Box::new(move |res, ext| {
            let _ = tx.send(match (res, ext) {
                (Ok(()), Some(e)) => Ok(unsafe { ext_info(&e) }),
                (Err(e), _) => Err(e.message()),
                _ => Err("install failed".into()),
            });
            Ok(())
        }));
        unsafe {
            let _ = p.AddBrowserExtension(&HSTRING::from(path.as_str()), &done);
        }
    })??;

    {
        static INDEX_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
        let _guard = INDEX_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let mut index = ext_index(&app);
        index.insert(id.clone(), dir.display().to_string().into());
        let _ = std::fs::write(ext_dir(&app)?.join("index.json"), serde_json::to_string(&index).unwrap_or_default());
    }
    let page = ext_page(&dir).map(|p| format!("chrome-extension://{id}/{}", p.trim_start_matches('/')));
    let launch = if page.is_some() { None } else {
        ext_launch(&dir).map(|u| if u.contains("://") { u } else { format!("chrome-extension://{id}/{}", u.trim_start_matches('/')) })
    };
    Ok(Ext { id, name, enabled, page, icon: ext_icon(&dir), launch, mine: true })
}

#[cfg(not(windows))]
#[tauri::command]
async fn ext_install(store_id: String) -> Result<Ext, String> {
    Err("Chrome extensions are only in Gallium for Windows for now".into())
}

// ---------------- misc ----------------

/// Opens a downloaded file, or shows it in Explorer.
#[cfg(windows)]
#[tauri::command]
fn reveal(path: String, open: bool) -> Result<(), String> {
    if !std::path::Path::new(&path).is_file() {
        return Err("file not found".into());
    }
    use std::os::windows::process::CommandExt;
    let arg = if open { format!("\"{path}\"") } else { format!("/select,\"{path}\"") };
    std::process::Command::new("explorer").raw_arg(arg).spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[cfg(not(windows))]
#[tauri::command]
fn reveal(path: String, open: bool) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if !p.is_file() {
        return Err("file not found".into());
    }
    let mac = cfg!(target_os = "macos");
    let mut c = std::process::Command::new(if mac { "open" } else { "xdg-open" });
    if mac && !open {
        c.arg("-R"); // show it in Finder
    }
    // Linux file managers have no common "select this file", so "show" opens its folder
    c.arg(if open || mac { p } else { p.parent().unwrap_or(p) });
    c.spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// Clears cookies, cache, history and site data for every tab (they share one profile).
// ---- theme and mod files (.gtheme / .gmod): plain JSON that the UI checks before using ----
const PKG_EXT: [&str; 2] = ["gtheme", "gmod"];
fn is_pkg(p: &std::path::Path) -> bool {
    p.extension().and_then(|e| e.to_str()).is_some_and(|e| PKG_EXT.contains(&e.to_ascii_lowercase().as_str()))
}

#[tauri::command]
async fn pkg_read(path: String) -> Result<String, String> {
    let p = std::path::Path::new(&path);
    if !is_pkg(p) {
        return Err("not a Gallium theme or mod file".into());
    }
    if std::fs::metadata(p).map_err(|e| e.to_string())?.len() > 8 << 20 {
        return Err("file is too large".into());
    }
    std::fs::read_to_string(p).map_err(|e| e.to_string())
}

/// Writes an exported theme or mod into the Downloads folder (never overwriting) and returns its path.
#[tauri::command]
async fn pkg_save(app: AppHandle, name: String, ext: String, text: String) -> Result<String, String> {
    if !PKG_EXT.contains(&ext.as_str()) || text.len() > 8 << 20 {
        return Err("can't save that file".into());
    }
    let stem: String = name.chars().filter(|c| c.is_alphanumeric() || " -_".contains(*c)).take(60).collect();
    let stem = if stem.trim().is_empty() { "Gallium".to_string() } else { stem.trim().to_string() };
    let dir = app.path().download_dir().ok().filter(|d| d.is_dir()).ok_or("no Downloads folder")?;
    let mut p = dir.join(format!("{stem}.{ext}"));
    for n in 2.. {
        if !p.exists() {
            break;
        }
        p = dir.join(format!("{stem} ({n}).{ext}"));
    }
    std::fs::write(&p, text).map_err(|e| e.to_string())?;
    Ok(p.to_string_lossy().into())
}

/// Scans the exact file contents with Microsoft Defender's command-line scanner: "clean", "threat" or "unavailable".
#[cfg(windows)]
#[tauri::command]
async fn av_scan(text: String) -> Result<String, String> {
    use std::os::windows::process::CommandExt;
    let exe = PathBuf::from(std::env::var_os("ProgramFiles").unwrap_or_else(|| r"C:\Program Files".into())).join("Windows Defender").join("MpCmdRun.exe");
    if !exe.is_file() {
        return Ok("unavailable".into());
    }
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let f = std::env::temp_dir().join(format!("gallium-scan-{nanos}.tmp"));
    std::fs::write(&f, &text).map_err(|e| e.to_string())?;
    std::thread::sleep(std::time::Duration::from_millis(150));
    if !f.exists() {
        return Ok("threat".into()); // real-time protection removed it as soon as it was written
    }
    let out = std::process::Command::new(&exe)
        .args(["-Scan", "-ScanType", "3", "-File"])
        .arg(&f)
        .arg("-DisableRemediation")
        .creation_flags(0x0800_0000) // no console window
        .output();
    let _ = std::fs::remove_file(&f);
    Ok(match out.map(|o| o.status.code()) {
        Ok(Some(0)) => "clean",
        Ok(Some(2)) => "threat",
        _ => "unavailable",
    }
    .into())
}

#[cfg(not(windows))]
#[tauri::command]
async fn av_scan(text: String) -> Result<String, String> {
    // ClamAV, if it's installed: "clean", "threat" or "unavailable"
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let f = std::env::temp_dir().join(format!("gallium-scan-{nanos}.tmp"));
    std::fs::write(&f, &text).map_err(|e| e.to_string())?;
    let out = std::process::Command::new("clamscan").arg("--no-summary").arg(&f).output();
    let _ = std::fs::remove_file(&f);
    Ok(match out.map(|o| o.status.code()) {
        Ok(Some(0)) => "clean",
        Ok(Some(1)) => "threat",
        _ => "unavailable",
    }
    .into())
}

#[tauri::command]
fn clear_data(app: AppHandle) -> Result<(), String> {
    ui(&app)?.clear_all_browsing_data().map_err(|e| e.to_string())
}

/// Google search suggestions, fetched here so the privileged UI never runs remote code.
#[tauri::command]
async fn suggest(q: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        ureq::get("https://suggestqueries.google.com/complete/search")
            .query("client", "chrome")
            .query("ie", "UTF-8")
            .query("oe", "UTF-8")
            .query("q", &q)
            .call()
            .map_err(|e| e.to_string())?
            .body_mut()
            .read_to_string()
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

// Theme and mod files Gallium was opened with (double-clicking a .gtheme or .gmod). The UI collects them once it's ready.
static PENDING: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(Vec::new());
fn pkg_args(args: &[String]) -> Vec<String> {
    args.iter().skip(1).filter(|a| is_pkg(std::path::Path::new(a)) && std::path::Path::new(a).is_file()).cloned().collect()
}

#[tauri::command]
fn pkg_pending() -> Vec<String> {
    std::mem::take(&mut *PENDING.lock().unwrap())
}

fn main() {
    *PENDING.lock().unwrap() = pkg_args(&std::env::args().collect::<Vec<_>>());
    tauri::Builder::default()
        // Opening a second Gallium (for example by double-clicking a theme file) hands the file to the one already running.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            for path in pkg_args(&argv) {
                let _ = app.emit("open-pkg", path);
            }
            if let Some(w) = app.get_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .invoke_handler(tauri::generate_handler![
            tab_open, tab_show, ui_focus, tab_nav, tab_do, tab_close, tab_close_all, tab_snap, tab_find,
            ext_list, ext_set, ext_install, reveal, clear_data, suggest, set_material, download_cancel, menu_pick, ext_popup, ext_popup_close, tab_mute, pkg_read, pkg_save, av_scan, pkg_pending
        ])
        .setup(|app| {
            // Panics go to gallium.log (stderr is invisible in release builds).
            let handle = app.handle().clone();
            std::panic::set_hook(Box::new(move |info| log(&handle, &format!("PANIC: {info}"))));
            // Hidden until the UI has painted (it calls show()), so there is no white flash.
            let win = tauri::window::WindowBuilder::new(app, "main")
                .title("Gallium")
                .inner_size(1440.0, 900.0)
                .min_inner_size(700.0, 450.0)
                .decorations(false)
                .transparent(true) // lets glass themes show the Mica/Acrylic backdrop
                .visible(false)
                .build()?;
            // Small screens: open at most 90% of the screen, centred
            if let Ok(Some(m)) = win.current_monitor() {
                let s = m.size().to_logical::<f64>(m.scale_factor());
                if s.width < 1600.0 || s.height < 1000.0 {
                    let _ = win.set_size(LogicalSize::new(1440f64.min(s.width * 0.9), 900f64.min(s.height * 0.9)));
                    let _ = win.center();
                }
            }
            let w = win.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(3));
                let _ = w.show(); // safety net if the UI never calls show()
            });
            // Every webview must use the same WebView2 options, so extensions are on here too.
            let ui = WebviewBuilder::new("ui", WebviewUrl::App("index.html".into()))
                .browser_extensions_enabled(true)
                .transparent(true)
                .auto_resize()
                .disable_drag_drop_handler(); // lets the sidebar use HTML drag & drop
            let ui = win.add_child(ui, LogicalPosition::new(0.0, 0.0), win.inner_size()?)?;

            // If the UI's page dies, reload it; if the whole engine dies, restart Gallium.
            #[cfg(windows)]
            let (h, w) = (app.handle().clone(), ui.clone());
            #[cfg(windows)]
            watch_crashes(&ui, move |kind| {
                log(&h, &format!("UI: WebView2 process failed (kind {})", kind.0));
                if kind == COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED {
                    h.restart();
                } else if kind == COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED
                    || kind == COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE
                {
                    let _ = w.reload();
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Gallium");
}

#[cfg(test)]
mod tests {
    #[test]
    fn crx_zip_strips_headers() {
        let zip = b"PK\x03\x04rest";
        let mut v3 = b"Cr24\x03\0\0\0\x02\0\0\0hh".to_vec();
        v3.extend_from_slice(zip);
        assert_eq!(super::crx_zip(&v3), Some(&zip[..]));
        let mut v2 = b"Cr24\x02\0\0\0\x01\0\0\0\x02\0\0\0kss".to_vec();
        v2.extend_from_slice(zip);
        assert_eq!(super::crx_zip(&v2), Some(&zip[..]));
        assert_eq!(super::crx_zip(b"PK\x03\x04"), None);
    }
}
