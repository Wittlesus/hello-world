use std::fs;
use std::path::PathBuf;
use std::time::Duration;
use serde_json::Value;
use tauri::Emitter;
use notify_debouncer_mini::{new_debouncer, DebouncedEventKind};

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
            start_watching,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
