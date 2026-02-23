use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::Child;
use std::sync::Mutex;
use std::time::Duration;
use serde_json::Value;
use tauri::Emitter;
use notify_debouncer_mini::{new_debouncer, DebouncedEventKind};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};

// ── Capabilities (Claude settings + known tools) ────────────────

#[tauri::command]
fn get_capabilities() -> Value {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".to_string());
    let settings_path = PathBuf::from(&home).join(".claude").join("settings.json");

    let settings: Value = fs::read_to_string(&settings_path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(serde_json::json!({}));

    // Parse enabled plugins
    let plugins: Vec<Value> = settings
        .get("enabledPlugins")
        .and_then(|p| p.as_object())
        .map(|obj| {
            obj.iter()
                .filter(|(_, v)| v.as_bool().unwrap_or(false))
                .map(|(k, _)| {
                    let parts: Vec<&str> = k.splitn(2, '@').collect();
                    serde_json::json!({
                        "name": parts.first().copied().unwrap_or(k.as_str()),
                        "source": parts.get(1).copied().unwrap_or(""),
                        "key": k,
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    // Parse MCP server permissions
    let mcp_servers: Vec<String> = settings
        .get("permissions")
        .and_then(|p| p.get("allow"))
        .and_then(|a| a.as_array())
        .map(|arr| {
            let mut seen = std::collections::HashSet::new();
            arr.iter()
                .filter_map(|v| v.as_str())
                .filter_map(|s| {
                    if s.starts_with("mcp__") {
                        s.strip_prefix("mcp__")
                            .and_then(|r| r.split("__").next())
                            .map(|name| name.to_string())
                    } else {
                        None
                    }
                })
                .filter(|name| seen.insert(name.clone()))
                .collect()
        })
        .unwrap_or_default();

    serde_json::json!({
        "plugins": plugins,
        "mcpServers": mcp_servers,
        "discordBot": {
            "name": "Hello World",
            "appId": "1475276479683235942",
            "patUserId": "403706305144946690",
            "server": "Robopals",
            "status": "active"
        },
        "accounts": [
            { "service": "Discord", "username": "wsdevfriend", "purpose": "War room + bot" },
            { "service": "Twitter/X", "username": "@WSDevGuy", "purpose": "buildinpublic" },
            { "service": "Reddit", "username": "WSDevGuy", "purpose": "community" },
            { "service": "GitHub", "username": "Wittlesus", "purpose": "repos" },
            { "service": "npm", "username": "pooter", "purpose": "packages" },
            { "service": "HuggingFace", "username": "wittlesus", "purpose": "models/datasets" },
            { "service": "Stripe", "username": "connected", "purpose": "payments" },
            { "service": "ProtonMail", "username": "WittleSusDev", "purpose": "project email" },
        ]
    })
}

// ── App config (project path storage) ───────────────────────────

fn app_config_path() -> PathBuf {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".hello-world-app.json")
}

#[tauri::command]
fn get_app_project_path() -> Option<String> {
    let path = app_config_path();
    let contents = fs::read_to_string(&path).ok()?;
    let v: Value = serde_json::from_str(&contents).ok()?;
    v.get("projectPath")?.as_str().map(|s| s.to_string())
}

#[tauri::command]
fn set_app_project_path(project_path: String) -> Result<(), String> {
    let hw_dir = PathBuf::from(&project_path).join(".hello-world");
    if !hw_dir.exists() {
        return Err(format!(
            "Not a Hello World project — .hello-world/ not found at {}",
            project_path
        ));
    }
    let config = serde_json::json!({ "projectPath": project_path });
    let contents = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Serialize error: {}", e))?;
    fs::write(app_config_path(), contents)
        .map_err(|e| format!("Write error: {}", e))
}

// ── Project data commands ────────────────────────────────────────

fn hw_path(project_path: &str, file_name: &str) -> PathBuf {
    PathBuf::from(project_path).join(".hello-world").join(file_name)
}

fn read_json_file(project_path: &str, file_name: &str) -> Result<Value, String> {
    let path = hw_path(project_path, file_name);
    let contents = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;
    serde_json::from_str(&contents)
        .map_err(|e| format!("Failed to parse {}: {}", path.display(), e))
}

fn write_json_file(project_path: &str, file_name: &str, data: &Value) -> Result<(), String> {
    let path = hw_path(project_path, file_name);
    let contents = serde_json::to_string_pretty(data)
        .map_err(|e| format!("Failed to serialize: {}", e))?;
    fs::write(&path, contents)
        .map_err(|e| format!("Failed to write {}: {}", path.display(), e))
}

#[tauri::command]
fn get_config(project_path: &str) -> Result<Value, String> {
    read_json_file(project_path, "config.json")
}

#[tauri::command]
fn save_config(project_path: &str, config: Value) -> Result<Value, String> {
    write_json_file(project_path, "config.json", &config)?;
    Ok(config)
}

#[tauri::command]
fn get_state(project_path: &str) -> Result<Value, String> {
    read_json_file(project_path, "state.json")
}

#[tauri::command]
fn get_memories(project_path: &str) -> Result<Value, String> {
    read_json_file(project_path, "memories.json")
}

#[tauri::command]
fn get_sessions(project_path: &str) -> Result<Value, String> {
    read_json_file(project_path, "sessions.json")
}

#[tauri::command]
fn get_brain_state(project_path: &str) -> Result<Value, String> {
    read_json_file(project_path, "brain-state.json")
}

#[tauri::command]
fn get_activity(project_path: &str) -> Result<Value, String> {
    read_json_file(project_path, "activity.json")
}

#[tauri::command]
fn get_approvals(project_path: &str) -> Result<Value, String> {
    read_json_file(project_path, "approvals.json")
}

#[tauri::command]
fn get_workflow(project_path: &str) -> Result<Value, String> {
    read_json_file(project_path, "workflow.json")
}

#[tauri::command]
fn get_direction(project_path: &str) -> Result<Value, String> {
    read_json_file(project_path, "direction.json")
}

#[tauri::command]
fn mark_direction_note_read(project_path: &str, note_id: String) -> Result<(), String> {
    let mut data = read_json_file(project_path, "direction.json")?;
    let notes = data["notes"]
        .as_array_mut()
        .ok_or("direction.json missing notes array")?;
    for note in notes.iter_mut() {
        if note["id"].as_str() == Some(note_id.as_str()) {
            note["read"] = serde_json::json!(true);
            break;
        }
    }
    write_json_file(project_path, "direction.json", &data)
}

#[tauri::command]
fn get_watchers(project_path: &str) -> Result<Value, String> {
    read_json_file(project_path, "watchers.json")
}

#[tauri::command]
fn get_timeline(project_path: &str) -> Result<String, String> {
    let path = std::path::Path::new(project_path)
        .join(".hello-world")
        .join("timeline.md");
    std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read timeline.md: {}", e))
}

fn epoch_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

// ── Approval resolution ──────────────────────────────────────────

#[tauri::command]
fn resolve_approval(project_path: &str, request_id: String, decision: String) -> Result<(), String> {
    let mut data = read_json_file(project_path, "approvals.json")?;

    let pending = data["pending"]
        .as_array_mut()
        .ok_or("approvals.json missing pending array")?;

    let pos = pending.iter().position(|r| r["id"].as_str() == Some(request_id.as_str()));
    let idx = pos.ok_or_else(|| format!("Approval request not found: {}", request_id))?;
    let mut resolved = pending.remove(idx);

    resolved["status"] = serde_json::json!(decision);
    resolved["resolvedAt"] = serde_json::json!(epoch_ms());

    data["resolved"]
        .as_array_mut()
        .ok_or("approvals.json missing resolved array")?
        .push(resolved);

    write_json_file(project_path, "approvals.json", &data)
}

// ── Question answering ───────────────────────────────────────────

#[tauri::command]
fn answer_question(project_path: &str, id: String, answer: String) -> Result<Value, String> {
    let mut data = read_json_file(project_path, "state.json")?;

    let questions = data["questions"]
        .as_array_mut()
        .ok_or("state.json missing questions array")?;

    let q = questions
        .iter_mut()
        .find(|q| q["id"].as_str() == Some(id.as_str()))
        .ok_or_else(|| format!("Question not found: {}", id))?;

    q["status"] = serde_json::json!("answered");
    q["answer"] = serde_json::json!(answer);
    q["answeredAt"] = serde_json::json!(epoch_ms());

    let result = q.clone();
    write_json_file(project_path, "state.json", &data)?;
    Ok(result)
}

// ── Chat history ─────────────────────────────────────────────────

fn append_chat_message_internal(project_path: &str, role: &str, text: &str) -> Result<(), String> {
    let mut history = read_json_file(project_path, "chat-out.json")
        .unwrap_or_else(|_| serde_json::json!({ "messages": [] }));

    let timestamp_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    let new_msg = serde_json::json!({
        "id": format!("msg_{}", timestamp_ms),
        "role": role,
        "text": text,
        "timestamp": timestamp_ms,
    });

    history["messages"]
        .as_array_mut()
        .ok_or("messages is not an array")?
        .push(new_msg);

    write_json_file(project_path, "chat-out.json", &history)
}

#[tauri::command]
fn get_chat_history(project_path: &str) -> Value {
    read_json_file(project_path, "chat-out.json")
        .unwrap_or_else(|_| serde_json::json!({ "messages": [] }))
}

#[tauri::command]
fn append_chat_message(project_path: &str, role: String, text: String) -> Result<(), String> {
    append_chat_message_internal(project_path, &role, &text)
}

// ── Claude subprocess chat (streaming) ───────────────────────────

// Persists the active chat session ID across messages for conversation continuity
static CHAT_SESSION_ID: Mutex<Option<String>> = Mutex::new(None);

// Emitted to frontend as text chunks arrive
#[derive(Clone, serde::Serialize)]
struct ChatChunkPayload {
    text: String,
    done: bool,
}

#[tauri::command]
async fn send_claude_message(
    app: tauri::AppHandle,
    project_path: String,
    message: String,
) -> Result<(), String> {
    let session_id = CHAT_SESSION_ID
        .lock()
        .map_err(|_| "Session lock poisoned")?
        .clone();

    let app_clone = app.clone();
    let proj_clone = project_path.clone();

    let result = tauri::async_runtime::spawn_blocking(move || {
        let home = std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .unwrap_or_else(|_| ".".to_string());

        // Use `cmd /c claude` so Windows shell PATH is used (npm global binaries)
        let mut cmd = std::process::Command::new("cmd");
        cmd.arg("/c").arg("claude");
        cmd.args(["-p", "--output-format", "stream-json", "--include-partial-messages"]);

        if let Some(ref sid) = session_id {
            cmd.args(["--resume", sid]);
        } else {
            cmd.args([
                "--append-system-prompt",
                "You are Claude, the AI CEO. You are chatting with Pat via the Hello World desktop app. Be concise and direct. You have access to hw_* MCP tools for tasks, memory, and decisions.",
            ]);
        }

        cmd.arg(&message)
            .current_dir(&home)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null());

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to start claude: {e}"))?;

        let stdout = child.stdout.take().ok_or("No stdout")?;
        let reader = BufReader::new(stdout);

        let mut full_text = String::new();
        let mut session_id_out: Option<String> = None;

        // stream-json emits one JSON object per line
        for line in reader.lines() {
            let line = match line {
                Ok(l) if !l.trim().is_empty() => l,
                _ => continue,
            };

            let Ok(event) = serde_json::from_str::<Value>(&line) else {
                continue;
            };

            let event_type = event["type"].as_str().unwrap_or("");

            // Capture session_id from the result event
            if event_type == "result" {
                if let Some(sid) = event["session_id"].as_str() {
                    session_id_out = Some(sid.to_string());
                }
                // Final result — done
                let _ = app_clone.emit("hw-chat-chunk", ChatChunkPayload {
                    text: String::new(),
                    done: true,
                });
                break;
            }

            // Partial text chunks from assistant message
            if event_type == "assistant" {
                if let Some(content) = event["message"]["content"].as_array() {
                    for block in content {
                        if block["type"].as_str() == Some("text") {
                            if let Some(text) = block["text"].as_str() {
                                full_text.push_str(text);
                                let _ = app_clone.emit("hw-chat-chunk", ChatChunkPayload {
                                    text: text.to_string(),
                                    done: false,
                                });
                            }
                        }
                    }
                }
            }
        }

        child.wait().ok();

        if full_text.is_empty() {
            return Err("Claude returned no text".to_string());
        }

        Ok((proj_clone, full_text, session_id_out))
    })
    .await
    .map_err(|e| format!("Spawn error: {e}"))??;

    let (proj, response_text, new_session_id) = result;

    // Store new session ID for conversation continuity
    if let Some(sid) = new_session_id {
        *CHAT_SESSION_ID.lock().map_err(|_| "Lock poisoned")? = Some(sid);
    }

    // Write complete response to chat-out.json (file watcher fires → UI refetches full history)
    append_chat_message_internal(&proj, "assistant", &response_text)
}

#[tauri::command]
fn reset_chat_session() -> Result<(), String> {
    *CHAT_SESSION_ID.lock().map_err(|_| "Lock poisoned")? = None;
    Ok(())
}

// ── Embedded terminal (PTY) ───────────────────────────────────────

struct PtyState {
    writer: Box<dyn Write + Send>,
    master: Box<dyn portable_pty::MasterPty + Send>,
}

static PTY_STATE: Mutex<Option<PtyState>> = Mutex::new(None);

fn build_project_context(project_path: &str) -> String {
    let config = read_json_file(project_path, "config.json").ok();
    let state = read_json_file(project_path, "state.json").ok();
    let workflow = read_json_file(project_path, "workflow.json").ok();

    let name = config.as_ref()
        .and_then(|c| c["config"]["name"].as_str())
        .unwrap_or("Unknown Project");

    let phase = workflow.as_ref()
        .and_then(|w| w["phase"].as_str())
        .unwrap_or("idle");

    let active_tasks: Vec<String> = state.as_ref()
        .and_then(|s| s["tasks"].as_array())
        .map(|tasks| {
            tasks.iter()
                .filter(|t| matches!(t["status"].as_str(), Some("in_progress") | Some("todo")))
                .take(5)
                .filter_map(|t| {
                    t["title"].as_str().map(|title| {
                        format!("- [{}] {}", t["status"].as_str().unwrap_or("?"), title)
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    let open_questions: Vec<String> = state.as_ref()
        .and_then(|s| s["questions"].as_array())
        .map(|qs| {
            qs.iter()
                .filter(|q| q["status"].as_str() == Some("open"))
                .take(3)
                .filter_map(|q| q["question"].as_str().map(|s| format!("- {}", s)))
                .collect()
        })
        .unwrap_or_default();

    let mut ctx = format!(
        "You are Claude, the autonomous AI CEO. Project: '{}' at {}. Workflow phase: {}.",
        name, project_path, phase
    );

    if !active_tasks.is_empty() {
        ctx.push_str(&format!("\n\nActive tasks:\n{}", active_tasks.join("\n")));
    }

    if !open_questions.is_empty() {
        ctx.push_str(&format!("\n\nOpen questions:\n{}", open_questions.join("\n")));
    }

    ctx.push_str("\n\nYou have access to hw_* MCP tools. Act autonomously. Report outcomes to Pat.");
    ctx
}

#[tauri::command]
fn start_pty_session(app: tauri::AppHandle, project_path: Option<String>) -> Result<(), String> {
    // Idempotent — if a session is already running, don't spawn another
    if PTY_STATE.lock().map_err(|_| "Lock poisoned")?.is_some() {
        return Ok(());
    }

    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".to_string());

    let pty_system = native_pty_system();
    let pty_pair = pty_system
        .openpty(PtySize { rows: 24, cols: 220, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| format!("PTY open failed: {e}"))?;

    let mut cmd = CommandBuilder::new("cmd");

    if let Some(ref path) = project_path {
        let context = build_project_context(path);
        cmd.args(["/c", "helloworld", "--append-system-prompt", &context]);
    } else {
        cmd.args(["/c", "helloworld"]);
    }

    cmd.cwd(&home);

    pty_pair.slave
        .spawn_command(cmd)
        .map_err(|e| format!("Spawn failed: {e}"))?;

    let reader = pty_pair.master
        .try_clone_reader()
        .map_err(|e| format!("Reader clone failed: {e}"))?;

    let writer = pty_pair.master
        .take_writer()
        .map_err(|e| format!("Writer take failed: {e}"))?;

    // Background thread: stream raw PTY output to frontend
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        let mut reader = reader;
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    // Send raw bytes as base64 — xterm.js decodes and renders natively
                    let encoded = base64_encode(&buf[..n]);
                    let _ = app.emit("pty-data", encoded);
                }
            }
        }
    });

    *PTY_STATE.lock().map_err(|_| "Lock poisoned")? = Some(PtyState {
        writer,
        master: pty_pair.master,
    });

    Ok(())
}

#[tauri::command]
fn write_pty_input(data: String) -> Result<(), String> {
    let mut guard = PTY_STATE.lock().map_err(|_| "Lock poisoned")?;
    if let Some(ref mut state) = *guard {
        state.writer.write_all(data.as_bytes()).map_err(|e| format!("Write failed: {e}"))?;
        state.writer.flush().map_err(|e| format!("Flush failed: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
fn resize_pty(rows: u16, cols: u16) -> Result<(), String> {
    let guard = PTY_STATE.lock().map_err(|_| "Lock poisoned")?;
    if let Some(ref state) = *guard {
        state.master
            .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| format!("Resize failed: {e}"))?;
    }
    Ok(())
}

// Minimal base64 encoder (avoids adding a dep)
fn base64_encode(data: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as usize;
        let b1 = if chunk.len() > 1 { chunk[1] as usize } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as usize } else { 0 };
        out.push(CHARS[(b0 >> 2)] as char);
        out.push(CHARS[((b0 & 3) << 4) | (b1 >> 4)] as char);
        out.push(if chunk.len() > 1 { CHARS[((b1 & 15) << 2) | (b2 >> 6)] as char } else { '=' });
        out.push(if chunk.len() > 2 { CHARS[b2 & 63] as char } else { '=' });
    }
    out
}

// ── File watcher ─────────────────────────────────────────────────

#[tauri::command]
fn start_watching(app: tauri::AppHandle, project_path: String) -> Result<(), String> {
    let watch_path = PathBuf::from(&project_path).join(".hello-world");

    if !watch_path.exists() {
        return Err(format!("{} does not exist", watch_path.display()));
    }

    std::thread::spawn(move || {
        let app_handle = app.clone();
        let (tx, rx) = std::sync::mpsc::channel();

        let mut debouncer = match new_debouncer(Duration::from_millis(500), tx) {
            Ok(d) => d,
            Err(_) => return,
        };

        if debouncer
            .watcher()
            .watch(&watch_path, notify::RecursiveMode::NonRecursive)
            .is_err()
        {
            return;
        }

        loop {
            match rx.recv() {
                Ok(Ok(events)) => {
                    let mut changed_files: Vec<String> = Vec::new();
                    for event in events {
                        if event.kind == DebouncedEventKind::Any {
                            if let Some(name) = event.path.file_name() {
                                let name_str = name.to_string_lossy().to_string();
                                if name_str.ends_with(".json") && !changed_files.contains(&name_str) {
                                    changed_files.push(name_str);
                                }
                            }
                        }
                    }
                    if !changed_files.is_empty() {
                        let _ = app_handle.emit("hw-files-changed", &changed_files);
                    }
                }
                Ok(Err(_)) => {}
                Err(_) => break,
            }
        }
    });

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_app_project_path,
            set_app_project_path,
            get_config,
            save_config,
            get_state,
            get_memories,
            get_sessions,
            get_brain_state,
            get_activity,
            get_approvals,
            get_workflow,
            get_direction,
            mark_direction_note_read,
            get_watchers,
            get_timeline,
            get_chat_history,
            append_chat_message,
            send_claude_message,
            reset_chat_session,
            start_pty_session,
            write_pty_input,
            resize_pty,
            start_watching,
            get_capabilities,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
