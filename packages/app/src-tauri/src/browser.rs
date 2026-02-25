use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{Emitter, Manager, WebviewUrl};
use tauri::webview::WebviewBuilder;

// ── State ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryEntry {
    pub url: String,
    pub title: String,
    pub visited_at: u64,
}

#[derive(Debug, Default)]
pub struct BrowserState {
    pub window_open: bool,
    pub lock_holder: Option<String>,
    pub current_url: String,
    pub status: String,
    pub page_title: String,
    pub extracted_text: String,
    pub history: Vec<HistoryEntry>,
    pub loopback_port: u16,
}

pub static BROWSER_STATE: Mutex<Option<BrowserState>> = Mutex::new(None);

/// Pending extraction result -- set by loopback HTTP handler, read by extract commands
pub static BROWSER_EXTRACT_RESULT: Mutex<Option<Value>> = Mutex::new(None);

fn epoch_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

// ── URL validation ───────────────────────────────────────────────

fn is_url_safe(url: &str) -> Result<(), String> {
    let lower = url.trim().to_lowercase();
    if lower.starts_with("javascript:")
        || lower.starts_with("data:")
        || lower.starts_with("file:")
        || lower.starts_with("blob:")
        || lower.starts_with("vbscript:")
    {
        return Err(format!("Blocked scheme: {}", url));
    }
    if !lower.starts_with("http://") && !lower.starts_with("https://") {
        return Err(format!("Only http/https allowed, got: {}", url));
    }
    Ok(())
}

// ── Init script ──────────────────────────────────────────────────
// Generated per-window with the loopback port embedded.

fn make_init_script(port: u16) -> String {
    format!(r#"
(function() {{
  if (!window.location.protocol.startsWith('http')) return;

  var HW_PORT = {port};

  function buildSelector(el) {{
    if (el.id) return '#' + el.id;
    if (el.name) return el.tagName.toLowerCase() + '[name="' + el.name + '"]';
    var path = [];
    var current = el;
    while (current && current.parentElement) {{
      var parent = current.parentElement;
      var siblings = Array.from(parent.children).filter(function(c) {{
        return c.tagName === current.tagName;
      }});
      if (siblings.length > 1) {{
        var idx = siblings.indexOf(current) + 1;
        path.unshift(current.tagName.toLowerCase() + ':nth-of-type(' + idx + ')');
      }} else {{
        path.unshift(current.tagName.toLowerCase());
      }}
      current = parent;
      if (current.id) {{ path.unshift('#' + current.id); break; }}
    }}
    return path.join(' > ');
  }}

  function postResult(data) {{
    try {{
      var payload = typeof data === 'string' ? data : JSON.stringify(data);
      if (navigator.sendBeacon) {{
        navigator.sendBeacon(
          'http://127.0.0.1:' + HW_PORT + '/browser-result',
          new Blob([payload], {{ type: 'text/plain' }})
        );
      }} else {{
        var xhr = new XMLHttpRequest();
        xhr.open('POST', 'http://127.0.0.1:' + HW_PORT + '/browser-result', true);
        xhr.send(payload);
      }}
    }} catch(e) {{}}
  }}

  window.__HW_EXTRACT__ = {{
    text: function(selector, maxChars) {{
      var root = selector ? document.querySelector(selector) : document.body;
      if (!root) return JSON.stringify({{ error: 'selector not found' }});
      var clone = root.cloneNode(true);
      ['script','style','noscript','svg','iframe','nav','footer',
       'header','.ad','[aria-hidden="true"]','[role="banner"]','[role="navigation"]']
        .forEach(function(sel) {{
          clone.querySelectorAll(sel).forEach(function(el) {{ el.remove(); }});
        }});
      var text = (clone.innerText || clone.textContent || '')
        .replace(/\n{{3,}}/g, '\n\n')
        .replace(/[ \t]{{2,}}/g, ' ')
        .trim();
      var limit = maxChars || 8000;
      var limited = text.slice(0, limit);
      return JSON.stringify({{
        title: document.title,
        url: window.location.href,
        text: limited,
        charCount: text.length,
        truncated: limited.length < text.length
      }});
    }},

    links: function(filter) {{
      var anchors = Array.from(document.querySelectorAll('a[href]'));
      var links = anchors.map(function(a) {{
        return {{
          text: (a.textContent || '').trim().slice(0, 80),
          href: a.href,
          isExternal: a.hostname !== window.location.hostname
        }};
      }}).filter(function(l) {{ return l.text && l.href.startsWith('http'); }});
      if (filter) {{
        var f = filter.toLowerCase();
        links = links.filter(function(l) {{
          return l.text.toLowerCase().includes(f) || l.href.toLowerCase().includes(f);
        }});
      }}
      return JSON.stringify(links.slice(0, 100));
    }},

    interactive: function() {{
      var elements = [];
      document.querySelectorAll('input, textarea, select').forEach(function(el, i) {{
        elements.push({{
          type: el.tagName.toLowerCase(),
          inputType: el.type || '',
          name: el.name || el.id || 'input_' + i,
          placeholder: el.placeholder || '',
          selector: buildSelector(el)
        }});
      }});
      document.querySelectorAll('button, [role="button"], input[type="submit"]').forEach(function(el) {{
        elements.push({{
          type: 'button',
          text: (el.textContent || '').trim().slice(0, 60),
          selector: buildSelector(el)
        }});
      }});
      return JSON.stringify(elements.slice(0, 50));
    }},

    click: function(selector) {{
      var el = document.querySelector(selector);
      if (!el) return JSON.stringify({{ error: 'not found', selector: selector }});
      el.click();
      return JSON.stringify({{ ok: true, selector: selector }});
    }},

    fill: function(selector, value) {{
      var el = document.querySelector(selector);
      if (!el) return JSON.stringify({{ error: 'not found', selector: selector }});
      el.focus();
      el.value = value;
      el.dispatchEvent(new Event('input', {{ bubbles: true }}));
      el.dispatchEvent(new Event('change', {{ bubbles: true }}));
      return JSON.stringify({{ ok: true, selector: selector }});
    }},

    extractAndPost: function(selector, maxChars, action) {{
      var result = this.text(selector, maxChars);
      postResult(JSON.stringify({{ action: action || 'extract', data: result }}));
    }},

    linksAndPost: function(filter, action) {{
      var result = this.links(filter);
      postResult(JSON.stringify({{ action: action || 'links', data: result }}));
    }},

    interactiveAndPost: function(action) {{
      var result = this.interactive();
      postResult(JSON.stringify({{ action: action || 'interactive', data: result }}));
    }},

    clickAndPost: function(selector, action) {{
      var result = this.click(selector);
      postResult(JSON.stringify({{ action: action || 'click', data: result }}));
    }},

    fillAndPost: function(selector, value, action) {{
      var result = this.fill(selector, value);
      postResult(JSON.stringify({{ action: action || 'fill', data: result }}));
    }}
  }};

  // Auto-extract on page load
  if (document.readyState === 'loading') {{
    document.addEventListener('DOMContentLoaded', function() {{
      window.__HW_EXTRACT__.extractAndPost('', 8000, 'auto');
    }});
  }} else {{
    setTimeout(function() {{
      window.__HW_EXTRACT__.extractAndPost('', 8000, 'auto');
    }}, 100);
  }}
}})();
"#, port = port)
}

// ── Public: called by loopback HTTP handler ──────────────────────

/// Store extraction result from the browser page (called by loopback /browser-result handler)
pub fn store_browser_result(payload: Value) {
    // Update BROWSER_EXTRACT_RESULT for pending extract commands
    if let Ok(mut guard) = BROWSER_EXTRACT_RESULT.lock() {
        *guard = Some(payload.clone());
    }

    // Also update BROWSER_STATE with latest page info.
    let data_str = payload["data"].as_str().unwrap_or("");
    if data_str.is_empty() { return; }

    let inner: Value = match serde_json::from_str(data_str) {
        Ok(v) => v,
        Err(_) => return,
    };

    if let Ok(mut guard) = BROWSER_STATE.lock() {
        if let Some(ref mut state) = *guard {
            state.page_title = inner["title"].as_str().unwrap_or("").to_string();
            state.current_url = inner["url"].as_str().unwrap_or(&state.current_url).to_string();
            state.extracted_text = inner["text"].as_str().unwrap_or("").to_string();
            state.status = "ready".to_string();
        }
    }
}

// ── Helpers ──────────────────────────────────────────────────────

fn read_sync_port(project_path: &str) -> Result<u16, String> {
    let sync_path = PathBuf::from(project_path)
        .join(".hello-world")
        .join("sync.json");
    let contents = std::fs::read_to_string(&sync_path)
        .map_err(|e| format!("Cannot read sync.json: {}", e))?;
    let data: Value = serde_json::from_str(&contents)
        .map_err(|e| format!("Cannot parse sync.json: {}", e))?;
    data["port"]
        .as_u64()
        .map(|p| p as u16)
        .ok_or_else(|| "sync.json missing port".to_string())
}

/// Wait for BROWSER_EXTRACT_RESULT to be populated (blocking, with timeout)
pub fn wait_for_extract_result_pub(timeout_ms: u64) -> Result<Value, String> {
    wait_for_extract_result(timeout_ms)
}

fn wait_for_extract_result(timeout_ms: u64) -> Result<Value, String> {
    let iterations = timeout_ms / 50;
    for _ in 0..iterations {
        std::thread::sleep(Duration::from_millis(50));
        if let Ok(mut guard) = BROWSER_EXTRACT_RESULT.lock() {
            if let Some(result) = guard.take() {
                return Ok(result);
            }
        }
    }
    Err("Extraction timed out".to_string())
}

// ── Tauri commands ───────────────────────────────────────────────

/// Open or navigate the embedded browser webview (child of main window)
#[tauri::command]
pub fn browser_open(app: tauri::AppHandle, project_path: String, url: String) -> Result<Value, String> {
    is_url_safe(&url)?;

    let mut state_guard = BROWSER_STATE.lock().map_err(|_| "Lock poisoned")?;

    // If webview already exists, just navigate
    if let Some(ref mut state) = *state_guard {
        if state.window_open {
            if let Some(webview) = app.get_webview("hw-browser") {
                // Save to history
                if !state.current_url.is_empty() {
                    state.history.push(HistoryEntry {
                        url: state.current_url.clone(),
                        title: state.page_title.clone(),
                        visited_at: epoch_ms(),
                    });
                    if state.history.len() > 50 { state.history.remove(0); }
                }
                state.status = "loading".to_string();
                state.current_url = url.clone();
                webview.navigate(url.parse().map_err(|e: url::ParseError| e.to_string())?)
                    .map_err(|e| format!("Navigate: {}", e))?;
                return Ok(serde_json::json!({ "action": "navigated", "url": url }));
            }
        }
    }

    // Read loopback port for init_script
    let port = read_sync_port(&project_path)?;
    let init_script = make_init_script(port);

    // Get the main window to embed the browser as a child webview
    let main_window = app.get_window("main")
        .ok_or("Main window not found")?;

    // Create browser as a child webview of the main window
    // Start with a default position -- React will call browser_set_bounds to position it
    let webview = main_window.add_child(
        WebviewBuilder::new(
            "hw-browser",
            WebviewUrl::External(url.parse().map_err(|e: url::ParseError| e.to_string())?),
        )
        .initialization_script(&init_script),
        tauri::LogicalPosition::new(0.0, 0.0),
        tauri::LogicalSize::new(100.0, 100.0),
    ).map_err(|e| format!("Webview create failed: {}", e))?;

    // Start hidden until React sends bounds
    let _ = webview.hide();

    *state_guard = Some(BrowserState {
        window_open: true,
        lock_holder: None,
        current_url: url.clone(),
        status: "loading".to_string(),
        page_title: String::new(),
        extracted_text: String::new(),
        history: Vec::new(),
        loopback_port: port,
    });

    let _ = app.emit("hw-browser-opened", &url);

    Ok(serde_json::json!({ "action": "opened", "url": url }))
}

/// Set the bounds of the embedded browser webview (called by React BrowserView)
#[tauri::command]
pub fn browser_set_bounds(app: tauri::AppHandle, x: f64, y: f64, width: f64, height: f64) -> Result<(), String> {
    let webview = app.get_webview("hw-browser").ok_or("Browser not open")?;

    webview.set_position(tauri::LogicalPosition::new(x, y))
        .map_err(|e| format!("SetPosition: {}", e))?;
    webview.set_size(tauri::LogicalSize::new(width, height))
        .map_err(|e| format!("SetSize: {}", e))?;

    // Show the webview now that it has proper bounds
    let _ = webview.show();

    Ok(())
}

/// Show or hide the embedded browser webview (used when switching tabs)
#[tauri::command]
pub fn browser_set_visible(app: tauri::AppHandle, visible: bool) -> Result<(), String> {
    let webview = app.get_webview("hw-browser").ok_or("Browser not open")?;

    if visible {
        webview.show().map_err(|e| format!("Show: {}", e))?;
    } else {
        webview.hide().map_err(|e| format!("Hide: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
pub fn browser_navigate(app: tauri::AppHandle, url: String) -> Result<Value, String> {
    is_url_safe(&url)?;
    let webview = app.get_webview("hw-browser").ok_or("Browser not open")?;

    let mut state_guard = BROWSER_STATE.lock().map_err(|_| "Lock poisoned")?;
    if let Some(ref mut state) = *state_guard {
        if !state.current_url.is_empty() {
            state.history.push(HistoryEntry {
                url: state.current_url.clone(),
                title: state.page_title.clone(),
                visited_at: epoch_ms(),
            });
            if state.history.len() > 50 { state.history.remove(0); }
        }
        state.current_url = url.clone();
        state.status = "loading".to_string();
    }

    webview.navigate(url.parse().map_err(|e: url::ParseError| e.to_string())?)
        .map_err(|e| format!("Navigate: {}", e))?;

    Ok(serde_json::json!({ "action": "navigated", "url": url }))
}

#[tauri::command]
pub async fn browser_extract_content(
    app: tauri::AppHandle,
    selector: Option<String>,
    max_chars: Option<u32>,
) -> Result<Value, String> {
    let webview = app.get_webview("hw-browser").ok_or("Browser not open")?;

    // Clear pending result
    if let Ok(mut guard) = BROWSER_EXTRACT_RESULT.lock() {
        *guard = None;
    }

    let sel = selector.as_deref().unwrap_or("").replace('\'', "\\'");
    let chars = max_chars.unwrap_or(8000);

    let script = format!(
        "window.__HW_EXTRACT__.extractAndPost('{}', {}, 'extract');",
        sel, chars
    );
    webview.eval(&script).map_err(|e| format!("Eval: {}", e))?;

    // Poll for result in a blocking thread
    let result = tauri::async_runtime::spawn_blocking(|| {
        wait_for_extract_result(10000)
    })
    .await
    .map_err(|e| format!("Spawn: {}", e))??;

    // Parse the nested result
    let data_str = result["data"].as_str().unwrap_or("{}");
    let parsed: Value = serde_json::from_str(data_str).unwrap_or(result.clone());

    Ok(parsed)
}

#[tauri::command]
pub async fn browser_get_links(
    app: tauri::AppHandle,
    filter: Option<String>,
) -> Result<Value, String> {
    let webview = app.get_webview("hw-browser").ok_or("Browser not open")?;

    if let Ok(mut guard) = BROWSER_EXTRACT_RESULT.lock() {
        *guard = None;
    }

    let f = filter.as_deref().unwrap_or("").replace('\'', "\\'");
    let script = format!("window.__HW_EXTRACT__.linksAndPost('{}', 'links');", f);
    webview.eval(&script).map_err(|e| format!("Eval: {}", e))?;

    let result = tauri::async_runtime::spawn_blocking(|| {
        wait_for_extract_result(5000)
    })
    .await
    .map_err(|e| format!("Spawn: {}", e))??;

    let data_str = result["data"].as_str().unwrap_or("[]");
    let parsed: Value = serde_json::from_str(data_str).unwrap_or(serde_json::json!([]));
    Ok(parsed)
}

#[tauri::command]
pub async fn browser_click_element(
    app: tauri::AppHandle,
    selector: String,
) -> Result<Value, String> {
    let webview = app.get_webview("hw-browser").ok_or("Browser not open")?;

    if let Ok(mut guard) = BROWSER_EXTRACT_RESULT.lock() {
        *guard = None;
    }

    let sel = selector.replace('\'', "\\'");
    let script = format!("window.__HW_EXTRACT__.clickAndPost('{}', 'click');", sel);
    webview.eval(&script).map_err(|e| format!("Eval: {}", e))?;

    let result = tauri::async_runtime::spawn_blocking(|| {
        wait_for_extract_result(5000)
    })
    .await
    .map_err(|e| format!("Spawn: {}", e))??;

    let data_str = result["data"].as_str().unwrap_or("{}");
    let parsed: Value = serde_json::from_str(data_str).unwrap_or(result);
    Ok(parsed)
}

#[tauri::command]
pub async fn browser_fill_field(
    app: tauri::AppHandle,
    selector: String,
    value: String,
) -> Result<Value, String> {
    let webview = app.get_webview("hw-browser").ok_or("Browser not open")?;

    if let Ok(mut guard) = BROWSER_EXTRACT_RESULT.lock() {
        *guard = None;
    }

    let sel = selector.replace('\'', "\\'");
    let val = value.replace('\'', "\\'");
    let script = format!("window.__HW_EXTRACT__.fillAndPost('{}', '{}', 'fill');", sel, val);
    webview.eval(&script).map_err(|e| format!("Eval: {}", e))?;

    let result = tauri::async_runtime::spawn_blocking(|| {
        wait_for_extract_result(5000)
    })
    .await
    .map_err(|e| format!("Spawn: {}", e))??;

    let data_str = result["data"].as_str().unwrap_or("{}");
    let parsed: Value = serde_json::from_str(data_str).unwrap_or(result);
    Ok(parsed)
}

#[tauri::command]
pub fn browser_get_state() -> Result<Value, String> {
    let guard = BROWSER_STATE.lock().map_err(|_| "Lock poisoned")?;
    match &*guard {
        Some(state) => Ok(serde_json::json!({
            "open": true,
            "url": state.current_url,
            "title": state.page_title,
            "status": state.status,
            "lockHolder": state.lock_holder,
            "historyLength": state.history.len(),
            "history": state.history.iter().rev().take(10).collect::<Vec<_>>(),
            "extractedPreview": state.extracted_text.chars().take(500).collect::<String>(),
        })),
        None => Ok(serde_json::json!({
            "open": false,
            "url": "",
            "title": "",
            "status": "idle",
            "lockHolder": null,
            "historyLength": 0,
            "history": [],
            "extractedPreview": "",
        })),
    }
}

#[tauri::command]
pub fn browser_close(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(webview) = app.get_webview("hw-browser") {
        let _ = webview.close();
    }
    let mut guard = BROWSER_STATE.lock().map_err(|_| "Lock poisoned")?;
    *guard = None;
    let _ = app.emit("hw-browser-closed", ());
    Ok(())
}

#[tauri::command]
pub fn browser_acquire_lock(agent_id: String) -> Result<(), String> {
    let mut guard = BROWSER_STATE.lock().map_err(|_| "Lock poisoned")?;
    match &mut *guard {
        Some(state) => match &state.lock_holder {
            Some(holder) if holder != &agent_id => {
                Err(format!("Browser locked by: {}", holder))
            }
            _ => {
                state.lock_holder = Some(agent_id);
                Ok(())
            }
        },
        None => Err("Browser not open".to_string()),
    }
}

#[tauri::command]
pub fn browser_release_lock(agent_id: String) -> Result<(), String> {
    let mut guard = BROWSER_STATE.lock().map_err(|_| "Lock poisoned")?;
    if let Some(ref mut state) = *guard {
        if state.lock_holder.as_deref() == Some(&agent_id) {
            state.lock_holder = None;
        }
    }
    Ok(())
}
