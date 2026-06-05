use std::sync::{Arc, Mutex};
use std::time::Instant;

pub mod camera;
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
    // WASD movement (accumulated per frame)
    pub forward: f32,
    pub right: f32,
    pub up: f32,
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
    pub gizmo_mode: String,
    pub drag_undo_pushed: bool,
    pub skip_camera_meta: bool,
    pub last_interaction: Instant,
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
            gizmo_mode: "move".to_string(),
            drag_undo_pushed: false,
            skip_camera_meta: false,
            last_interaction: Instant::now(),
        }
    }
}

pub struct UndoHistory {
    pub undo_stack: Vec<Vec<serde_json::Value>>,
    pub redo_stack: Vec<Vec<serde_json::Value>>,
}

impl Default for UndoHistory {
    fn default() -> Self {
        Self {
            undo_stack: Vec::new(),
            redo_stack: Vec::new(),
        }
    }
}
pub struct NyxRenderer {
    pub hwnd: isize,
    pub state: Arc<Mutex<SceneState>>,
    pub camera_input: Arc<Mutex<CameraInput>>,
    pub undo: Arc<Mutex<UndoHistory>>,
}

impl NyxRenderer {
    pub fn new(parent_hwnd: isize, app_handle: tauri::AppHandle) -> Result<Self, String> {
        let hwnd = window::CreateChildWindow(parent_hwnd)?;
        let state = Arc::new(Mutex::new(SceneState::default()));
        let camera_input = Arc::new(Mutex::new(CameraInput::default()));
        let undo = Arc::new(Mutex::new(UndoHistory::default()));
        window::InitViewportInput(
            Arc::clone(&camera_input),
            Arc::clone(&state),
            Arc::clone(&undo),
            app_handle,
        );

        let state_t = Arc::clone(&state);
        let input_t = Arc::clone(&camera_input);
        std::thread::Builder::new()
            .name("nyx-renderer".into())
            .spawn(move || RenderLoop(hwnd, state_t, input_t))
            .map_err(|e| e.to_string())?;

        Ok(NyxRenderer {
            hwnd,
            state,
            camera_input,
            undo,
        })
    }
}

fn RenderLoop(hwnd: isize, state: Arc<Mutex<SceneState>>, camera_input: Arc<Mutex<CameraInput>>) {
    let mut render = match pipeline::RenderState::new(hwnd, 1, 1) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("NyxRenderer init failed: {e}");
            return;
        }
    };

    let format = render.config.format;
    let mut scene_renderer = SceneRenderer::new(&render.device, format, 1, 1);
    let mut sky = wgpu::Color {
        r: 0.39,
        g: 0.58,
        b: 0.93,
        a: 1.0,
    };
    let mut last_frame = Instant::now();

    loop {
        let now = Instant::now();
        let frame_dt = now.duration_since(last_frame).as_secs_f32();
        last_frame = now;

        let (orbit_dx, orbit_dy, pan_dx, pan_dy, zoom, forward, right, up) = {
            let mut ci = camera_input.lock().unwrap();
            let vals = (
                ci.orbit_dx,
                ci.orbit_dy,
                ci.pan_dx,
                ci.pan_dy,
                ci.zoom,
                ci.forward,
                ci.right,
                ci.up,
            );
            *ci = CameraInput::default();
            vals
        };

        let has_camera_input = orbit_dx != 0.0
            || orbit_dy != 0.0
            || pan_dx != 0.0
            || pan_dy != 0.0
            || zoom != 0.0
            || forward != 0.0
            || right != 0.0
            || up != 0.0;

        let (visible, bounds, dirty, mut camera) = {
            let mut s = state.lock().unwrap();
            s.camera.orbit(orbit_dx, orbit_dy);
            s.camera.pan(pan_dx, pan_dy);
            s.camera.zoom(zoom);
            s.camera.WasdMove(forward, right, up);

            if s.visible {
                let mut physics = std::mem::take(&mut s.physics);
                if physics.StepCommands(&mut s.commands, frame_dt) {
                    s.dirty = true;
                }
                s.physics = physics;
            }

            let dirty = s.dirty;
            if dirty {
                s.dirty = false;
            }
            (s.visible, s.bounds, dirty, s.camera.clone())
        };

        let (_, _, w, h) = bounds;
        if w != render.width || h != render.height {
            render.resize(w, h);
            scene_renderer.resize(&render.device, format, w, h);
        }
        if dirty {
            let (commands, selected, gizmo_mode, skip_camera_meta) = {
                let s = state.lock().unwrap();
                let skip_camera_meta = s.skip_camera_meta;
                (
                    s.commands.clone(),
                    s.selected.clone(),
                    s.gizmo_mode.clone(),
                    skip_camera_meta,
                )
            };
            scene_renderer.LoadCommands(&render.queue, &commands);
            scene_renderer.LoadGizmo(&render.queue, selected.as_deref(), &commands, &gizmo_mode);

            let mut s = state.lock().unwrap();
            ProcessMetaCommands(&commands, &mut s.camera, &mut sky, skip_camera_meta);
            UpdateCameraClip(&commands, &mut s.camera);
            if !skip_camera_meta {
                s.skip_camera_meta = true;
            }
            camera = s.camera.clone();
        }

        let needs_render = has_camera_input || dirty;

        if visible && render.width > 0 && render.height > 0 {
            camera.aspect = render.width as f32 / render.height as f32;
            if let Ok(mut s) = state.try_lock() {
                s.camera.aspect = camera.aspect;
            }
            if needs_render {
                let uniform = camera.ToUniform();
                scene_renderer.UpdateCamera(&render.queue, &uniform);
                scene_renderer.render(&render.surface.0, &render.device, &render.queue, sky);
                std::thread::sleep(std::time::Duration::from_millis(8));
            } else {
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
    skip_camera_meta: bool,
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
            Some("SetCamera") if !skip_camera_meta => {
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
        if cmd.get("Cmd").and_then(|v| v.as_str()) != Some("AddPart") {
            continue;
        }

        let pos = cmd.get("Position");
        let size = cmd.get("Size");
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
