use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::Child;
use std::sync::Mutex;
use std::time::Duration;
use serde_json::Value;
use tauri::{Emitter, Manager};
use notify_debouncer_mini::{new_debouncer, DebouncedEventKind};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};

// ── UTC timestamp helper (no chrono dependency) ─────────────────

/// Convert days since Unix epoch to (year, month, day).
/// Howard Hinnant's civil_from_days algorithm.
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u32;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d)
}

/// Returns current UTC time as ISO 8601 string (e.g. "2026-02-26T05:30:00.123Z").
fn utc_now_iso() -> String {
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    let secs = (millis / 1000) as i64;
    let ms = millis % 1000;
    let time_of_day = secs.rem_euclid(86400);
    let hours = time_of_day / 3600;
    let minutes = (time_of_day % 3600) / 60;
    let seconds = time_of_day % 60;
    let (y, m, d) = civil_from_days(secs / 86400);
    format!("{y:04}-{m:02}-{d:02}T{hours:02}:{minutes:02}:{seconds:02}.{ms:03}Z")
}

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
    // state.json was split into tasks.json, decisions.json, questions.json
    // Merge them back into one response for the frontend
    let tasks_data = read_json_file(project_path, "tasks.json")
        .unwrap_or_else(|_| serde_json::json!({"tasks": []}));
    let decisions_data = read_json_file(project_path, "decisions.json")
        .unwrap_or_else(|_| serde_json::json!({"decisions": []}));
    let questions_data = read_json_file(project_path, "questions.json")
        .unwrap_or_else(|_| serde_json::json!({"questions": []}));

    Ok(serde_json::json!({
        "tasks": tasks_data["tasks"],
        "decisions": decisions_data["decisions"],
        "questions": questions_data["questions"],
    }))
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
fn get_fullsweep(project_path: &str) -> Result<Value, String> {
    read_json_file(project_path, "fullsweep-results.json")
}

#[tauri::command]
fn get_approvals(project_path: &str) -> Result<Value, String> {
    read_json_file(project_path, "approvals.json")
}

#[tauri::command]
fn get_research(project_path: &str) -> Result<Value, String> {
    read_json_file(project_path, "research-outputs.json")
}

#[tauri::command]
fn get_extracted_research(project_path: &str) -> Result<Value, String> {
    read_json_file(project_path, "extracted-research.json")
}

#[tauri::command]
fn get_deliberations(project_path: &str) -> Result<Value, String> {
    let hw_dir = std::path::Path::new(project_path).join(".hello-world").join("deliberations");
    if !hw_dir.exists() {
        return Ok(Value::Array(vec![]));
    }
    let mut results = Vec::new();
    let entries = std::fs::read_dir(&hw_dir).map_err(|e| e.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("json") {
            let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
            let parsed: Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
            results.push(parsed);
        }
    }
    Ok(Value::Array(results))
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
fn get_usage(project_path: &str) -> Result<Value, String> {
    read_json_file(project_path, "qwen-usage.json")
}

#[tauri::command]
fn get_claude_usage(project_path: &str) -> Result<Value, String> {
    read_json_file(project_path, "claude-usage.json")
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
fn get_mode(project_path: &str) -> Result<Value, String> {
    read_json_file(project_path, "mode.json")
        .or_else(|_| Ok(serde_json::json!({"overdrive": false})))
}

#[tauri::command]
fn set_mode(project_path: &str, overdrive: bool) -> Result<Value, String> {
    let data = serde_json::json!({
        "overdrive": overdrive,
        "toggledAt": utc_now_iso(),
        "toggledBy": "pat",
    });
    write_json_file(project_path, "mode.json", &data)?;
    Ok(data)
}

#[tauri::command]
fn spawn_sentinel(project_path: String) -> Result<Value, String> {
    let app_pid = std::process::id();
    let sentinel_script = PathBuf::from(&project_path)
        .join(".claude")
        .join("sentinel.mjs");

    if !sentinel_script.exists() {
        return Err("sentinel.mjs not found".to_string());
    }

    // Check if sentinel is already running
    let sentinel_json = hw_path(&project_path, "sentinel.json");
    if sentinel_json.exists() {
        if let Ok(contents) = fs::read_to_string(&sentinel_json) {
            if let Ok(data) = serde_json::from_str::<Value>(&contents) {
                if let Some(pid) = data["pid"].as_u64() {
                    // Check if that PID is still alive
                    #[cfg(windows)]
                    {
                        let output = std::process::Command::new("tasklist")
                            .args(["/FI", &format!("PID eq {}", pid), "/NH"])
                            .output();
                        if let Ok(out) = output {
                            let stdout = String::from_utf8_lossy(&out.stdout);
                            if stdout.contains(&pid.to_string()) {
                                return Ok(serde_json::json!({
                                    "status": "already_running",
                                    "sentinelPid": pid,
                                    "appPid": app_pid,
                                }));
                            }
                        }
                    }
                    #[cfg(not(windows))]
                    {
                        let output = std::process::Command::new("kill")
                            .args(["-0", &pid.to_string()])
                            .output();
                        if let Ok(out) = output {
                            if out.status.success() {
                                return Ok(serde_json::json!({
                                    "status": "already_running",
                                    "sentinelPid": pid,
                                    "appPid": app_pid,
                                }));
                            }
                        }
                    }
                }
            }
        }
    }

    // Spawn sentinel as a detached hidden process
    let mut cmd = std::process::Command::new("node");
    cmd.arg(sentinel_script.to_string_lossy().to_string())
        .arg(&project_path)
        .arg(app_pid.to_string())
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());

    // Hide console window on Windows
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let child = cmd.spawn()
        .map_err(|e| format!("Failed to spawn sentinel: {}", e))?;

    let sentinel_pid = child.id();

    Ok(serde_json::json!({
        "status": "spawned",
        "sentinelPid": sentinel_pid,
        "appPid": app_pid,
    }))
}

#[tauri::command]
fn get_sentinel_status(project_path: &str) -> Result<Value, String> {
    let data = read_json_file(project_path, "sentinel.json")
        .unwrap_or_else(|_| serde_json::json!({"status": "not_running"}));

    // Verify the sentinel PID is actually alive
    if let Some(pid) = data["pid"].as_u64() {
        #[cfg(windows)]
        {
            let output = std::process::Command::new("tasklist")
                .args(["/FI", &format!("PID eq {}", pid), "/NH"])
                .output();
            if let Ok(out) = output {
                let stdout = String::from_utf8_lossy(&out.stdout);
                if !stdout.contains(&pid.to_string()) {
                    return Ok(serde_json::json!({"status": "dead", "lastPid": pid}));
                }
            }
        }
        #[cfg(not(windows))]
        {
            let output = std::process::Command::new("kill")
                .args(["-0", &pid.to_string()])
                .output();
            if let Ok(out) = output {
                if !out.status.success() {
                    return Ok(serde_json::json!({"status": "dead", "lastPid": pid}));
                }
            }
        }
    }

    Ok(data)
}

#[tauri::command]
fn get_watchers(project_path: &str) -> Result<Value, String> {
    read_json_file(project_path, "watchers.json")
}

#[tauri::command]
fn kill_watcher(project_path: &str, watcher_id: String) -> Result<(), String> {
    let mut data = read_json_file(project_path, "watchers.json")?;

    let active = data["active"]
        .as_array_mut()
        .ok_or("watchers.json missing active array")?;

    let idx = active
        .iter()
        .position(|w| w["id"].as_str() == Some(watcher_id.as_str()))
        .ok_or_else(|| format!("Watcher {} not found in active list", watcher_id))?;

    let pid = active[idx]["pid"]
        .as_u64()
        .ok_or("Watcher missing pid")?;

    #[cfg(windows)]
    std::process::Command::new("taskkill")
        .args(["/F", "/PID", &pid.to_string()])
        .output()
        .map_err(|e| format!("taskkill failed: {}", e))?;

    #[cfg(not(windows))]
    std::process::Command::new("kill")
        .args(["-9", &pid.to_string()])
        .output()
        .map_err(|e| format!("kill failed: {}", e))?;

    let mut watcher = active.remove(idx);
    watcher["status"] = serde_json::json!("killed");

    data["completed"]
        .as_array_mut()
        .ok_or("watchers.json missing completed array")?
        .push(watcher);

    write_json_file(project_path, "watchers.json", &data)
}

#[tauri::command]
fn save_shared_file(project_path: String, filename: String, data: Vec<u8>) -> Result<String, String> {
    let dir = std::path::Path::new(&project_path)
        .join(".hello-world")
        .join("shared-files");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut path = dir.join(&filename);
    if path.exists() {
        let stem = path.file_stem().unwrap_or_default().to_string_lossy().to_string();
        let ext = path.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
        let mut i = 1u32;
        while path.exists() {
            path = dir.join(format!("{}_{}{}", stem, i, ext));
            i += 1;
        }
    }
    std::fs::write(&path, &data).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().replace('\\', "/").to_owned())
}

#[tauri::command]
fn get_timeline(project_path: &str) -> Result<String, String> {
    let path = std::path::Path::new(project_path)
        .join(".hello-world")
        .join("timeline.md");
    std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read timeline.md: {}", e))
}

#[tauri::command]
fn get_chatroom(project_path: &str) -> Result<String, String> {
    let path = std::path::Path::new(project_path)
        .join(".hello-world")
        .join("chatroom.json");
    if !path.exists() {
        return Ok(r#"{"session":{"id":"","topic":"","status":"idle","startedAt":"","startedBy":"claude","waitingForInput":false,"roundNumber":0},"agents":[],"messages":[]}"#.to_string());
    }
    std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read chatroom.json: {}", e))
}

#[tauri::command]
fn post_pat_chatroom_message(project_path: &str, message: String) -> Result<(), String> {
    let path = std::path::Path::new(project_path)
        .join(".hello-world")
        .join("chatroom.json");
    let raw = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read chatroom.json: {}", e))?;
    let mut data: serde_json::Value = serde_json::from_str(&raw)
        .map_err(|e| format!("Failed to parse chatroom.json: {}", e))?;
    // Set pendingPatMessage on the session
    if let Some(session) = data.get_mut("session") {
        session["pendingPatMessage"] = serde_json::Value::String(message.clone());
        session["waitingForInput"] = serde_json::Value::Bool(false);
    }
    // Also append to messages directly so Pat sees it immediately
    if let Some(messages) = data.get_mut("messages").and_then(|m| m.as_array_mut()) {
        let ms = epoch_ms();
        let now = ms.to_string(); // epoch ms — new Date(ms) works fine in JS
        let id = format!("msg_{}", ms);
        messages.push(serde_json::json!({
            "id": id,
            "agentId": "pat",
            "text": message,
            "timestamp": now,
            "type": "pat"
        }));
    }
    let out = serde_json::to_string_pretty(&data)
        .map_err(|e| format!("Serialize error: {}", e))?;
    std::fs::write(&path, out)
        .map_err(|e| format!("Write error: {}", e))?;
    Ok(())
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
    resolved["resolvedAt"] = serde_json::json!(utc_now_iso());

    data["resolved"]
        .as_array_mut()
        .ok_or("approvals.json missing resolved array")?
        .push(resolved);

    write_json_file(project_path, "approvals.json", &data)
}

// ── Question answering ───────────────────────────────────────────

#[tauri::command]
fn answer_question(project_path: &str, id: String, answer: String) -> Result<Value, String> {
    let mut data = read_json_file(project_path, "questions.json")?;

    let questions = data["questions"]
        .as_array_mut()
        .ok_or("questions.json missing questions array")?;

    let q = questions
        .iter_mut()
        .find(|q| q["id"].as_str() == Some(id.as_str()))
        .ok_or_else(|| format!("Question not found: {}", id))?;

    q["status"] = serde_json::json!("answered");
    q["answer"] = serde_json::json!(answer);
    q["answeredAt"] = serde_json::json!(utc_now_iso());

    let result = q.clone();
    write_json_file(project_path, "questions.json", &data)?;
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

/// Strip ANSI/VT escape sequences from raw PTY bytes and return plain UTF-8 text.
fn strip_ansi(input: &[u8]) -> String {
    let text = String::from_utf8_lossy(input);
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '\x1b' => match chars.peek().copied() {
                Some('[') => {
                    chars.next();
                    for nc in chars.by_ref() {
                        if nc.is_ascii_alphabetic() || nc == '~' { break; }
                    }
                }
                Some(']') => {
                    chars.next();
                    loop {
                        match chars.next() {
                            Some('\x07') | None => break,
                            Some('\x1b') => { chars.next(); break; }
                            _ => {}
                        }
                    }
                }
                Some('(') | Some(')') | Some('*') | Some('+') => {
                    chars.next(); chars.next();
                }
                Some('P') | Some('X') | Some('^') | Some('_') => {
                    chars.next();
                    loop {
                        match chars.next() {
                            Some('\x1b') => { chars.next(); break; }
                            None => break,
                            _ => {}
                        }
                    }
                }
                _ => { chars.next(); }
            },
            '\r' | '\x00' => {}
            '\x08' => { out.pop(); }
            c if !c.is_control() => { out.push(c); }
            _ => {}
        }
    }
    out
}

/// Returns true if a stripped PTY line is worth forwarding to Buddy.
fn should_emit_pty_line(line: &str) -> bool {
    let t = line.trim();
    let char_len = t.chars().count();
    if char_len < 4 || char_len > 150 { return false; }
    if t.starts_with('{') || t.starts_with('[') { return false; }
    if t.contains("<tool_") || t.contains("</") { return false; }
    if !t.chars().any(|c| c.is_alphanumeric()) { return false; }
    // Skip terminal prompts (e.g. "C:\Users\Patri>")
    if t.ends_with('>') && t.contains('\\') { return false; }
    // Skip lines that are all the same char (spinners, dividers)
    if t.len() > 2 {
        let first = t.chars().next().unwrap();
        if t.chars().all(|c| c == first) { return false; }
    }
    true
}

struct PtyState {
    writer: Box<dyn Write + Send>,
    master: Box<dyn portable_pty::MasterPty + Send>,
}

static PTY_STATE: Mutex<Option<PtyState>> = Mutex::new(None);

fn build_project_context(project_path: &str) -> String {
    let config = read_json_file(project_path, "config.json").ok();
    let tasks_data = read_json_file(project_path, "tasks.json").ok();
    let questions_data = read_json_file(project_path, "questions.json").ok();
    let workflow = read_json_file(project_path, "workflow.json").ok();

    let name = config.as_ref()
        .and_then(|c| c["config"]["name"].as_str())
        .unwrap_or("Unknown Project");

    let phase = workflow.as_ref()
        .and_then(|w| w["phase"].as_str())
        .unwrap_or("idle");

    let active_tasks: Vec<String> = tasks_data.as_ref()
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

    let open_questions: Vec<String> = questions_data.as_ref()
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
fn start_pty_session(app: tauri::AppHandle, project_path: Option<String>) -> Result<bool, String> {
    // Idempotent — if a session is already running, return false so frontend knows to set status ready
    if PTY_STATE.lock().map_err(|_| "Lock poisoned")?.is_some() {
        return Ok(false);
    }

    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".to_string());

    let pty_system = native_pty_system();
    let pty_pair = pty_system
        .openpty(PtySize { rows: 24, cols: 220, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| format!("PTY open failed: {e}"))?;

    let mut cmd = CommandBuilder::new("cmd");

    // helloworld.cmd already injects the CEO system prompt — don't double up
    cmd.args(["/c", "helloworld"]);

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

    // Set state BEFORE spawning thread — prevents race where thread clears state
    // before we've written it, causing respawn checks to fail
    *PTY_STATE.lock().map_err(|_| "Lock poisoned")? = Some(PtyState {
        writer,
        master: pty_pair.master,
    });

    // Background thread: stream raw PTY output to frontend + extract lines for Buddy feed
    // When the process dies, clear PTY_STATE so the next start_pty_session call respawns
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        let mut reader = reader;
        let mut line_buf: Vec<u8> = Vec::new();
        let mut last_line = String::new();
        let mut last_emit = std::time::Instant::now();
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => {
                    if let Ok(mut guard) = PTY_STATE.lock() {
                        *guard = None;
                    }
                    let _ = app.emit("pty-died", ());
                    break;
                }
                Ok(n) => {
                    // Emit raw bytes to terminal view (unchanged)
                    let encoded = base64_encode(&buf[..n]);
                    let _ = app.emit("pty-data", encoded);

                    // Extract clean lines for Buddy feed
                    for &byte in &buf[..n] {
                        if byte == b'\n' {
                            if !line_buf.is_empty() {
                                let text = strip_ansi(&line_buf);
                                if should_emit_pty_line(&text) {
                                    let display: String = text.trim().chars().take(60).collect();
                                    let now = std::time::Instant::now();
                                    let elapsed = now.duration_since(last_emit).as_millis();
                                    let is_dup = display == last_line && elapsed < 500;
                                    if !is_dup && elapsed >= 30 {
                                        let _ = app.emit("hw-pty-line", &display);
                                        last_line = display;
                                        last_emit = now;
                                    }
                                }
                                line_buf.clear();
                            }
                        } else if byte != b'\r' && line_buf.len() < 512 {
                            line_buf.push(byte);
                        }
                    }
                }
            }
        }
    });

    Ok(true)
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

// ── Loopback HTTP notify listener ────────────────────────────────
//
// MCP server POSTs to http://127.0.0.1:<port>/notify after every tool call.
// Body: { "files": ["state.json", ...], "tool": "hw_add_task", "summary": "..." }
// We emit hw-files-changed (for tab refresh) and hw-tool-summary (for buddy).
// Port is written to .hello-world/sync.json so the MCP server can discover it.

fn start_notify_listener(app: tauri::AppHandle, project_path: String) {
    use std::net::TcpListener;
    use std::io::{BufRead, BufReader, Read, Write};

    std::thread::spawn(move || {
        let listener = match TcpListener::bind("127.0.0.1:0") {
            Ok(l) => l,
            Err(_) => return,
        };

        let port = match listener.local_addr() {
            Ok(addr) => addr.port(),
            Err(_) => return,
        };

        // Write port + pid to sync.json so MCP server can discover us
        let pid = std::process::id();
        let sync = serde_json::json!({ "port": port, "pid": pid });
        let sync_path = PathBuf::from(&project_path).join(".hello-world").join("sync.json");
        if let Ok(contents) = serde_json::to_string_pretty(&sync) {
            let _ = fs::write(&sync_path, contents);
        }

        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { continue };
            let app_handle = app.clone();

            std::thread::spawn(move || {
                let mut reader = BufReader::new(&stream);

                // Read HTTP request line: "POST /path HTTP/1.1"
                let mut request_line = String::new();
                if reader.read_line(&mut request_line).is_err() { return; }
                let request_line = request_line.trim().to_string();

                let method = request_line
                    .split_whitespace()
                    .next()
                    .unwrap_or("POST")
                    .to_uppercase();
                let path = request_line
                    .split_whitespace()
                    .nth(1)
                    .unwrap_or("/")
                    .to_string();

                // Handle CORS preflight (OPTIONS)
                if method == "OPTIONS" {
                    let resp = "HTTP/1.1 204 No Content\r\n\
                        Access-Control-Allow-Origin: *\r\n\
                        Access-Control-Allow-Methods: POST, OPTIONS\r\n\
                        Access-Control-Allow-Headers: Content-Type\r\n\
                        Access-Control-Max-Age: 86400\r\n\r\n";
                    let _ = stream.write_all(resp.as_bytes());
                    return;
                }

                // Read headers until blank line
                let mut content_length: usize = 0;
                loop {
                    let mut line = String::new();
                    if reader.read_line(&mut line).is_err() { return; }
                    let line = line.trim_end_matches(|c| c == '\r' || c == '\n').to_string();
                    if line.is_empty() { break; }
                    let lower = line.to_lowercase();
                    if lower.starts_with("content-length:") {
                        content_length = lower["content-length:".len()..].trim().parse().unwrap_or(0);
                    }
                }

                // Read body
                let payload: Value = if content_length > 0 {
                    let mut body = vec![0u8; content_length];
                    if reader.read_exact(&mut body).is_err() {
                        return;
                    }
                    serde_json::from_slice(&body).unwrap_or(serde_json::json!({}))
                } else {
                    serde_json::json!({})
                };

                // ── Route by path ──────────────────────────────
                // Default: notify handler
                if let Some(files) = payload["files"].as_array() {
                    let names: Vec<String> = files.iter()
                        .filter_map(|f| f.as_str().map(String::from))
                        .collect();
                    if !names.is_empty() {
                        let _ = app_handle.emit("hw-files-changed", &names);
                    }
                }
                if payload["summary"].is_string() {
                    let _ = app_handle.emit("hw-tool-summary", &payload);
                }
                let _ = stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n");
            });
        }
    });
}

// ── File watcher ─────────────────────────────────────────────────

#[tauri::command]
fn start_watching(app: tauri::AppHandle, project_path: String) -> Result<(), String> {
    let watch_path = PathBuf::from(&project_path).join(".hello-world");

    if !watch_path.exists() {
        return Err(format!("{} does not exist", watch_path.display()));
    }

    // Start the loopback HTTP listener for MCP server notifications
    start_notify_listener(app.clone(), project_path.clone());

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
                                if (name_str.ends_with(".json") || name_str.ends_with(".md")) && !changed_files.contains(&name_str) {
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
            get_fullsweep,
            get_approvals,
            get_research,
            get_extracted_research,
            get_deliberations,
            get_workflow,
            get_direction,
            get_usage,
            get_claude_usage,
            mark_direction_note_read,
            get_mode,
            set_mode,
            spawn_sentinel,
            get_sentinel_status,
            get_watchers,
            kill_watcher,
            save_shared_file,
            get_timeline,
            get_chatroom,
            post_pat_chatroom_message,
            get_chat_history,
            append_chat_message,
            send_claude_message,
            reset_chat_session,
            start_pty_session,
            write_pty_input,
            resize_pty,
            start_watching,
            get_capabilities,
            resolve_approval,
            answer_question,
        ])
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { .. } = event {
                    // Run session-end hook to generate summary from activity log
                    if let Some(project_path) = get_app_project_path() {
                        let hook_path = PathBuf::from(&project_path)
                            .join(".claude")
                            .join("hooks")
                            .join("session-end.mjs");
                        if hook_path.exists() {
                            let _ = std::process::Command::new("node")
                                .arg(&hook_path)
                                .current_dir(&project_path)
                                .stdout(std::process::Stdio::null())
                                .stderr(std::process::Stdio::null())
                                .status(); // blocks until done (< 1 sec)
                        } else {
                            // Fallback: just stamp endedAt if hook doesn't exist
                            let sessions_path = PathBuf::from(&project_path)
                                .join(".hello-world")
                                .join("sessions.json");
                            if let Ok(contents) = fs::read_to_string(&sessions_path) {
                                if let Ok(mut data) = serde_json::from_str::<Value>(&contents) {
                                    if let Some(sessions) = data.get_mut("sessions").and_then(|s| s.as_array_mut()) {
                                        if let Some(latest) = sessions.last_mut() {
                                            if latest.get("endedAt").and_then(|v| v.as_str()).is_none() {
                                                latest["endedAt"] = Value::String(utc_now_iso());
                                                if let Ok(out) = serde_json::to_string_pretty(&data) {
                                                    let _ = fs::write(&sessions_path, out);
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                if let tauri::WindowEvent::Destroyed = event {
                    window.app_handle().exit(0);
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
