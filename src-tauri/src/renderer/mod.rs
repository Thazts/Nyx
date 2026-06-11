use std::sync::{Arc, Mutex};
use std::time::Instant;

pub mod camera;
pub mod gizmo;
pub mod mesh;
pub mod physics;
pub mod pipeline;
pub mod scene;
pub mod window;

use camera::OrbitalCamera;
use scene::SceneRenderer;

#[derive(Default)]
pub struct CameraInput {
    pub orbit_dx: f32,
    pub orbit_dy: f32,
    pub pan_dx: f32,
    pub pan_dy: f32,
    pub zoom: f32,
    pub forward: f32,
    pub right: f32,
    pub up: f32,
}

#[derive(Debug, Clone)]
pub struct SelectedFace {
    pub part_id: String,
    pub face_index: usize,
}

#[derive(Debug, Clone)]
pub struct SceneState {
    pub commands: Vec<serde_json::Value>,
    pub profile: String,
    pub physics: physics::PhysicsWorld,
    pub bounds: (i32, i32, u32, u32),
    pub visible: bool,
    pub dirty: bool,
    pub camera: OrbitalCamera,
    pub selected: Option<String>,
    pub selected_face: Option<SelectedFace>,
    pub gizmo_mode: String,
    pub drag_undo_pushed: bool,
    pub skip_camera_meta: bool,
    pub last_edit_interaction: Instant,
}

impl Default for SceneState {
    fn default() -> Self {
        Self {
            commands: Vec::new(),
            profile: "roblox".to_string(),
            physics: physics::PhysicsWorld::default(),
            bounds: (0, 0, 1, 1),
            visible: false,
            dirty: false,
            camera: OrbitalCamera::default(),
            selected: None,
            selected_face: None,
            gizmo_mode: "move".to_string(),
            drag_undo_pushed: false,
            skip_camera_meta: false,
            last_edit_interaction: Instant::now() - std::time::Duration::from_secs(60),
        }
    }
}

#[derive(Default)]
pub struct UndoHistory {
    pub undo_stack: Vec<Vec<serde_json::Value>>,
    pub redo_stack: Vec<Vec<serde_json::Value>>,
}

pub struct NyxRenderer {
    pub hwnd: isize,
    pub state: Arc<Mutex<SceneState>>,
    pub camera_input: Arc<Mutex<CameraInput>>,
    pub undo: Arc<Mutex<UndoHistory>>,
}

struct DirtySceneSnapshot {
    commands: Vec<serde_json::Value>,
    selected: Option<String>,
    selected_face: Option<SelectedFace>,
    gizmo_mode: String,
    skip_camera_meta: bool,
    camera: OrbitalCamera,
}

impl NyxRenderer {
    pub fn new(ParentHwnd: isize, app_handle: tauri::AppHandle) -> Result<Self, String> {
        let hwnd = window::CreateChildWindow(ParentHwnd)?;
        let state = Arc::new(Mutex::new(SceneState::default()));
        let CameraInput = Arc::new(Mutex::new(CameraInput::default()));
        let undo = Arc::new(Mutex::new(UndoHistory::default()));
        window::InitViewportInput(
            Arc::clone(&CameraInput),
            Arc::clone(&state),
            Arc::clone(&undo),
            app_handle,
        );

        let StateT = Arc::clone(&state);
        let InputT = Arc::clone(&CameraInput);
        std::thread::Builder::new()
            .name("nyx-renderer".into())
            .spawn(move || RenderLoop(hwnd, StateT, InputT))
            .map_err(|e| e.to_string())?;

        Ok(NyxRenderer {
            hwnd,
            state,
            camera_input: CameraInput,
            undo,
        })
    }
}

const MAX_FPS: f32 = 240.0;
const MAX_REBUILD_FPS: f32 = 120.0;

fn RenderLoop(hwnd: isize, state: Arc<Mutex<SceneState>>, CameraInput: Arc<Mutex<CameraInput>>) {
    let mut render = match pipeline::RenderState::new(hwnd, 1, 1) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("NyxRenderer init failed: {e}");
            return;
        }
    };
    let FrameBudget = std::time::Duration::from_secs_f32(1.0 / MAX_FPS);
    let RebuildBudget = std::time::Duration::from_secs_f32(1.0 / MAX_REBUILD_FPS);
    let mut LastRebuild = Instant::now() - RebuildBudget;

    let format = render.config.format;
    let mut SceneRenderer = SceneRenderer::new(&render.device, format, 1, 1);
    let mut sky = wgpu::Color {
        r: 0.39,
        g: 0.58,
        b: 0.93,
        a: 1.0,
    };
    let mut LastFrame = Instant::now();

    loop {
        let now = Instant::now();
        let FrameDt = now.duration_since(LastFrame).as_secs_f32();
        LastFrame = now;

        let input = {
            let mut ci = CameraInput.lock().unwrap();
            std::mem::take(&mut *ci)
        };

        let HasCameraInput = input.orbit_dx != 0.0
            || input.orbit_dy != 0.0
            || input.pan_dx != 0.0
            || input.pan_dy != 0.0
            || input.zoom != 0.0
            || input.forward != 0.0
            || input.right != 0.0
            || input.up != 0.0;

        let AllowRebuild = LastRebuild.elapsed() >= RebuildBudget;
        let (visible, bounds, mut camera, dirty_snapshot, RebuildPending) = {
            let mut s = state.lock().unwrap();
            s.camera.orbit(input.orbit_dx, input.orbit_dy);
            s.camera.pan(input.pan_dx, input.pan_dy);
            s.camera.zoom(input.zoom);
            s.camera.WasdMove(input.forward, input.right, input.up);

            if s.visible {
                let mut physics = std::mem::take(&mut s.physics);
                if physics.StepCommands(&mut s.commands, FrameDt) {
                    s.dirty = true;
                }
                s.physics = physics;
            }

            let dirty_snapshot = if s.dirty && AllowRebuild {
                s.dirty = false;
                Some(DirtySceneSnapshot {
                    commands: s.commands.clone(),
                    selected: s.selected.clone(),
                    selected_face: s.selected_face.clone(),
                    gizmo_mode: s.gizmo_mode.clone(),
                    skip_camera_meta: s.skip_camera_meta,
                    camera: s.camera.clone(),
                })
            } else {
                None
            };
            let RebuildPending = s.dirty;
            (
                s.visible,
                s.bounds,
                s.camera.clone(),
                dirty_snapshot,
                RebuildPending,
            )
        };
        let dirty = dirty_snapshot.is_some();

        let (_, _, w, h) = bounds;
        if w != render.width || h != render.height {
            render.resize(w, h);
            SceneRenderer.resize(&render.device, format, w, h);
        }
        if let Some(mut snapshot) = dirty_snapshot {
            LastRebuild = Instant::now();
            ProcessMetaCommands(
                &snapshot.commands,
                &mut snapshot.camera,
                &mut sky,
                snapshot.skip_camera_meta,
            );
            UpdateCameraClip(&snapshot.commands, &mut snapshot.camera);
            camera = snapshot.camera.clone();

            SceneRenderer.LoadCommands(&render.device, &render.queue, &snapshot.commands);
            SceneRenderer.LoadGizmo(
                &render.queue,
                snapshot.selected.as_deref(),
                snapshot.selected_face.as_ref(),
                &snapshot.commands,
                &snapshot.gizmo_mode,
            );
        }

        let needs_render = HasCameraInput || dirty;

        if visible && render.width > 0 && render.height > 0 {
            camera.aspect = render.width as f32 / render.height as f32;
            if needs_render {
                let SkyLinear = wgpu::Color {
                    r: sky.r.powf(2.2),
                    g: sky.g.powf(2.2),
                    b: sky.b.powf(2.2),
                    a: 1.0,
                };
                {
                    let mut s = state.lock().unwrap();
                    if !s.dirty {
                        if dirty && !s.skip_camera_meta {
                            s.skip_camera_meta = true;
                        }
                        s.camera = camera.clone();
                    }
                }
                let uniform = camera.ToUniform([
                    SkyLinear.r as f32,
                    SkyLinear.g as f32,
                    SkyLinear.b as f32,
                ]);
                SceneRenderer.UpdateCamera(&render.queue, &uniform);
                SceneRenderer.render(&render.surface.0, &render.device, &render.queue, SkyLinear);
                std::thread::sleep(FrameBudget.saturating_sub(now.elapsed()).max(
                    std::time::Duration::from_millis(1),
                ));
            } else if RebuildPending {
                std::thread::sleep(std::time::Duration::from_millis(2));
            } else {
                if let Ok(mut s) = state.try_lock() {
                    s.camera.aspect = camera.aspect;
                }
                std::thread::sleep(std::time::Duration::from_millis(14));
            }
        } else {
            std::thread::sleep(std::time::Duration::from_millis(16));
        }
    }
}

fn ProcessMetaCommands(
    commands: &[serde_json::Value],
    camera: &mut OrbitalCamera,
    sky: &mut wgpu::Color,
    SkipCameraMeta: bool,
) {
    for cmd in commands {
        match cmd.get("Cmd").and_then(|v| v.as_str()) {
            Some("SetSkybox") => {
                if let Some(col) = cmd.get("Color") {
                    sky.r = col.get("R").and_then(|v| v.as_f64()).unwrap_or(0.39);
                    sky.g = col.get("G").and_then(|v| v.as_f64()).unwrap_or(0.58);
                    sky.b = col.get("B").and_then(|v| v.as_f64()).unwrap_or(0.93);
                }
            }
            Some("SetCamera") if !SkipCameraMeta => {
                let pos = cmd.get("Position");
                let look = cmd.get("LookAt");
                let f = |obj: Option<&serde_json::Value>, k: &str, d: f64| -> f32 {
                    obj.and_then(|o| o.get(k))
                        .and_then(|v| v.as_f64())
                        .unwrap_or(d) as f32
                };
                camera.SetFromEyeTarget(
                    [f(pos, "X", 18.0), f(pos, "Y", 14.0), f(pos, "Z", 18.0)],
                    [f(look, "X", 0.0), f(look, "Y", 3.0), f(look, "Z", 0.0)],
                );
            }
            _ => {}
        }
    }
}

fn UpdateCameraClip(commands: &[serde_json::Value], camera: &mut OrbitalCamera) {
    let eye = camera.eye();
    let mut far = 2000.0_f32;

    for cmd in commands {
        let Cmd = cmd.get("Cmd").and_then(|v| v.as_str());
        if Cmd != Some("AddPart") && Cmd != Some("AddMesh") {
            continue;
        }

        let pos = cmd.get("Position");
        let size = cmd.get("Bounds").or_else(|| cmd.get("Size"));
        let f = |obj: Option<&serde_json::Value>, key: &str, fallback: f64| -> f32 {
            obj.and_then(|o| o.get(key))
                .and_then(|v| v.as_f64())
                .unwrap_or(fallback) as f32
        };

        let center = glam::Vec3::new(f(pos, "X", 0.0), f(pos, "Y", 0.0), f(pos, "Z", 0.0));
        let extent =
            glam::Vec3::new(f(size, "X", 1.0), f(size, "Y", 1.0), f(size, "Z", 1.0)).length() * 0.5;
        far = far.max((center - eye).length() + extent + 100.0);
    }

    camera.far = far.clamp(2000.0, 500_000.0);
}
