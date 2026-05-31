use std::cell::RefCell;
use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::sync::{Arc, Mutex, OnceLock};

use tauri::Manager as _;

use windows_sys::Win32::Foundation::HWND;
use windows_sys::Win32::Graphics::Gdi::ValidateRect;
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, RegisterClassExW,
    GetWindowLongW, SetWindowLongW, SetParent, SetWindowPos, ShowWindow,
    SetTimer, KillTimer,
    WNDCLASSEXW,
    CS_HREDRAW, CS_VREDRAW,
    WS_CHILD, WS_CLIPSIBLINGS, WS_OVERLAPPEDWINDOW, WS_VISIBLE,
    HWND_BOTTOM, HWND_TOP,
    SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW,
    SW_HIDE, SW_SHOW, GWL_STYLE,
    WM_ERASEBKGND, WM_MOUSEACTIVATE, WM_PAINT,
    WM_LBUTTONDOWN, WM_LBUTTONUP, WM_RBUTTONDOWN, WM_RBUTTONUP,
    WM_MOUSEMOVE, WM_MOUSEWHEEL, WM_TIMER, WM_CONTEXTMENU,
    MA_NOACTIVATE,
    IDC_ARROW, LoadCursorW,
};

use super::{CameraInput, SceneState, UndoHistory};
extern "system" {
    fn SetCapture(hwnd: HWND) -> HWND;
    fn ReleaseCapture() -> windows_sys::Win32::Foundation::BOOL;
}

pub static VP_CAM:   OnceLock<Arc<Mutex<CameraInput>>> = OnceLock::new();
pub static VP_STATE: OnceLock<Arc<Mutex<SceneState>>>  = OnceLock::new();
pub static VP_UNDO:  OnceLock<Arc<Mutex<UndoHistory>>> = OnceLock::new();
pub static VP_APP:   OnceLock<tauri::AppHandle>        = OnceLock::new();

pub fn init_viewport_input(
    cam:   Arc<Mutex<CameraInput>>,
    state: Arc<Mutex<SceneState>>,
    undo:  Arc<Mutex<UndoHistory>>,
    app:   tauri::AppHandle,
) {
    VP_CAM.set(cam).ok();
    VP_STATE.set(state).ok();
    VP_UNDO.set(undo).ok();
    VP_APP.set(app).ok();
}

#[derive(Clone, Copy, Default, PartialEq)]
enum DragMode { #[default] None, Orbit, Pan, GizmoDrag }

struct DragState {
    mode:        DragMode,
    last_x:      i16,
    last_y:      i16,
    start_x:     i16,
    start_y:     i16,
    has_dragged: bool,
    fly_timer:   usize,
}

impl Default for DragState {
    fn default() -> Self {
        Self { mode: DragMode::None, last_x: 0, last_y: 0,
               start_x: 0, start_y: 0, has_dragged: false, fly_timer: 0 }
    }
}

thread_local! {
    static DRAG:       RefCell<DragState> = RefCell::new(DragState::default());
    static GIZMO_AXIS: RefCell<String>    = RefCell::new(String::new());
}

fn ray_aabb(o: glam::Vec3, d: glam::Vec3, mn: glam::Vec3, mx: glam::Vec3) -> Option<f32> {
    let inv = 1.0 / d;
    let mut tmin = (mn.x - o.x) * inv.x;
    let mut tmax = (mx.x - o.x) * inv.x;
    if inv.x < 0.0 { std::mem::swap(&mut tmin, &mut tmax); }
    let mut tymin = (mn.y - o.y) * inv.y;
    let mut tymax = (mx.y - o.y) * inv.y;
    if inv.y < 0.0 { std::mem::swap(&mut tymin, &mut tymax); }
    if tmin > tymax || tymin > tmax { return None; }
    if tymin > tmin { tmin = tymin; }
    if tymax < tmax { tmax = tymax; }
    let mut tzmin = (mn.z - o.z) * inv.z;
    let mut tzmax = (mx.z - o.z) * inv.z;
    if inv.z < 0.0 { std::mem::swap(&mut tzmin, &mut tzmax); }
    if tmin > tzmax || tzmin > tmax { return None; }
    if tzmin > tmin { tmin = tzmin; }
    if tzmax < tmax { tmax = tzmax; }
    if tmax < 0.0 { None } else { Some(tmin.max(0.0)) }
}

fn ray_seg_dist(ro: glam::Vec3, rd: glam::Vec3, p0: glam::Vec3, p1: glam::Vec3) -> f32 {
    let v = p1 - p0; let w = ro - p0;
    let a = rd.dot(rd); let b = rd.dot(v); let c = v.dot(v);
    let d = rd.dot(w); let e = v.dot(w);
    let den = a * c - b * b;
    let (mut sc, mut tc) = if den < 1e-4 {
        (0.0, if b > c { d / b } else { e / c })
    } else {
        ((b * e - c * d) / den, (a * e - b * d) / den)
    };
    if tc < 0.0 { tc = 0.0; sc = -d / a; }
    else if tc > 1.0 { tc = 1.0; sc = (b - d) / a; }
    (w + rd * sc - v * tc).length()
}

fn closest_t(ro: glam::Vec3, rd: glam::Vec3, lo: glam::Vec3, ld: glam::Vec3) -> f32 {
    let w = ro - lo; let b = rd.dot(ld); let d = rd.dot(w); let e = ld.dot(w);
    let den = 1.0 - b * b;
    if den.abs() < 1e-6 { return e; }
    (e - b * d) / den
}

fn push_undo(s: &SceneState, u: &mut UndoHistory) {
    u.undo_stack.push(s.commands.clone());
    if u.undo_stack.len() > 50 { u.undo_stack.remove(0); }
    u.redo_stack.clear();
}

fn part_pos(s: &SceneState, id: &str) -> Option<glam::Vec3> {
    for cmd in &s.commands {
        if cmd.get("Cmd").and_then(|v| v.as_str()) != Some("AddPart") { continue; }
        if cmd.get("Id").and_then(|v| v.as_str())  != Some(id)        { continue; }
        let f = |k: &str, ff: &str| cmd.get(k).and_then(|o| o.get(ff))
            .and_then(|v| v.as_f64()).unwrap_or(0.0) as f32;
        return Some(glam::Vec3::new(f("Position","X"), f("Position","Y"), f("Position","Z")));
    }
    None
}

fn gizmo_hit(s: &SceneState, ndc_x: f32, ndc_y: f32) -> Option<String> {
    let sel = s.selected.as_ref()?.clone();
    let (o, d) = s.camera.get_ray(ndc_x, ndc_y);

    for cmd in &s.commands {
        if cmd.get("Cmd").and_then(|v| v.as_str()) != Some("AddPart") { continue; }
        if cmd.get("Id").and_then(|v| v.as_str())  != Some(sel.as_str()) { continue; }
        let gf = |k: &str, f: &str| -> f32 {
            cmd.get(k).and_then(|o| o.get(f)).and_then(|v| v.as_f64()).unwrap_or(0.0) as f32
        };
        let c  = glam::Vec3::new(gf("Position","X"), gf("Position","Y"), gf("Position","Z"));
        let sx = gf("Size","X"); let sy = gf("Size","Y"); let sz = gf("Size","Z");

        return match s.gizmo_mode.as_str() {
            "rotate" => {
                let r = sx.max(sy).max(sz) * 0.5 + 0.8;
                let test = |n: glam::Vec3| -> Option<f32> {
                    let den = n.dot(d);
                    if den.abs() < 1e-6 { return None; }
                    let t = n.dot(c - o) / den;
                    if t < 0.0 { return None; }
                    let dist = ((o + d * t - c).length() - r).abs();
                    if dist < 0.4 { Some(dist) } else { None }
                };
                let opts = [("X", test(glam::Vec3::X)), ("Y", test(glam::Vec3::Y)), ("Z", test(glam::Vec3::Z))];
                opts.into_iter().filter_map(|(ax, v)| v.map(|q| (ax, q)))
                    .min_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal))
                    .map(|(ax, _)| ax.into())
            }
            "scale" => {
                let len = 6.0_f32;
                let tips = [("X", c + glam::Vec3::X*len), ("Y", c + glam::Vec3::Y*len), ("Z", c + glam::Vec3::Z*len)];
                tips.iter().map(|(ax, tip)| { let v = *tip - o; let t = v.dot(d); (*ax, (v - d*t).length()) })
                    .filter(|(_, dist)| *dist < 1.0)
                    .min_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal))
                    .map(|(ax, _)| ax.into())
            }
            _ => {
                let len = 6.0_f32;
                let dx = ray_seg_dist(o, d, c, c + glam::Vec3::X*len);
                let dy = ray_seg_dist(o, d, c, c + glam::Vec3::Y*len);
                let dz = ray_seg_dist(o, d, c, c + glam::Vec3::Z*len);
                if dx < 0.8 && dx < dy && dx < dz { Some("X".into()) }
                else if dy < 0.8 && dy < dz       { Some("Y".into()) }
                else if dz < 0.8                  { Some("Z".into()) }
                else                              { None }
            }
        };
    }
    None
}

fn click_select(s: &mut SceneState, ndc_x: f32, ndc_y: f32) -> Option<String> {
    let (o, d) = s.camera.get_ray(ndc_x, ndc_y);
    let mut best_t = f32::MAX;
    let mut best_id: Option<String> = None;
    for cmd in &s.commands {
        if cmd.get("Cmd").and_then(|v| v.as_str()) != Some("AddPart") { continue; }
        let gf = |k: &str, f: &str, def: f32| cmd.get(k).and_then(|o| o.get(f))
            .and_then(|v| v.as_f64()).map(|v| v as f32).unwrap_or(def);
        let c = glam::Vec3::new(gf("Position","X",0.), gf("Position","Y",0.), gf("Position","Z",0.));
        let e = glam::Vec3::new(gf("Size","X",1.), gf("Size","Y",1.), gf("Size","Z",1.)) * 0.5;
        if let Some(t) = ray_aabb(o, d, c - e, c + e) {
            if t < best_t {
                best_t = t;
                best_id = cmd.get("Id").and_then(|v| v.as_str()).map(|s| s.to_string());
            }
        }
    }
    s.selected = best_id.clone();
    s.dirty    = true;
    best_id
}

fn do_move_drag(s: &mut SceneState, u: &mut UndoHistory, axis: &str,
                pnx: f32, pny: f32, cnx: f32, cny: f32) {
    let sel = match s.selected.clone() { Some(id) => id, None => return };
    if !s.drag_undo_pushed { push_undo(s, u); s.drag_undo_pushed = true; }
    let ad = match axis { "X" => glam::Vec3::X, "Y" => glam::Vec3::Y, _ => glam::Vec3::Z };
    let pp = match part_pos(s, &sel) { Some(p) => p, None => return };
    let (po, pd) = s.camera.get_ray(pnx, pny);
    let (co, cd) = s.camera.get_ray(cnx, cny);
    let np = pp + ad * (closest_t(co, cd, pp, ad) - closest_t(po, pd, pp, ad));
    for cmd in &mut s.commands {
        if cmd.get("Cmd").and_then(|v| v.as_str()) != Some("AddPart") { continue; }
        if cmd.get("Id").and_then(|v| v.as_str())  != Some(sel.as_str()) { continue; }
        if let Some(p) = cmd.get_mut("Position") {
            *p = serde_json::json!({"X": np.x, "Y": np.y, "Z": np.z});
        }
        break;
    }
    s.dirty = true;
}

fn do_rotate_drag(s: &mut SceneState, u: &mut UndoHistory, axis: &str,
                  pnx: f32, pny: f32, cnx: f32, cny: f32) {
    let sel = match s.selected.clone() { Some(id) => id, None => return };
    if !s.drag_undo_pushed { push_undo(s, u); s.drag_undo_pushed = true; }
    let pn = match axis { "X" => glam::Vec3::X, "Y" => glam::Vec3::Y, _ => glam::Vec3::Z };
    let pp = match part_pos(s, &sel) { Some(p) => p, None => return };
    let (po, pd) = s.camera.get_ray(pnx, pny);
    let (co, cd) = s.camera.get_ray(cnx, cny);
    let isect = |ro: glam::Vec3, rd: glam::Vec3| -> Option<glam::Vec3> {
        let den = pn.dot(rd);
        if den.abs() < 1e-6 { return None; }
        let t = pn.dot(pp - ro) / den;
        if t < 0.0 { None } else { Some(ro + rd * t) }
    };
    let (prev_pt, curr_pt) = match (isect(po, pd), isect(co, cd)) { (Some(a), Some(b)) => (a, b), _ => return };
    let vp = prev_pt - pp; let vc = curr_pt - pp;
    if vp.length() < 1e-6 || vc.length() < 1e-6 { return; }
    let angle = vp.normalize().cross(vc.normalize()).dot(pn).atan2(vp.normalize().dot(vc.normalize()).clamp(-1.0, 1.0));
    let rk = match axis { "X" => "RX", "Y" => "RY", _ => "RZ" };
    for cmd in &mut s.commands {
        if cmd.get("Cmd").and_then(|v| v.as_str()) != Some("AddPart") { continue; }
        if cmd.get("Id").and_then(|v| v.as_str())  != Some(sel.as_str()) { continue; }
        let cur: f32 = cmd.get("CFrame").and_then(|cf| cf.get(rk)).and_then(|v| v.as_f64()).unwrap_or(0.0) as f32;
        let mut ncf = cmd.get("CFrame").cloned().unwrap_or_else(|| serde_json::json!({"RX":0,"RY":0,"RZ":0}));
        ncf[rk] = serde_json::json!(cur + angle);
        cmd["CFrame"] = ncf;
        break;
    }
    s.dirty = true;
}

fn do_scale_drag(s: &mut SceneState, u: &mut UndoHistory, axis: &str,
                 pnx: f32, pny: f32, cnx: f32, cny: f32) {
    let sel = match s.selected.clone() { Some(id) => id, None => return };
    if !s.drag_undo_pushed { push_undo(s, u); s.drag_undo_pushed = true; }
    let ad = match axis { "X" => glam::Vec3::X, "Y" => glam::Vec3::Y, _ => glam::Vec3::Z };
    let pp = match part_pos(s, &sel) { Some(p) => p, None => return };
    let (po, pd) = s.camera.get_ray(pnx, pny);
    let (co, cd) = s.camera.get_ray(cnx, cny);
    let delta = closest_t(co, cd, pp, ad) - closest_t(po, pd, pp, ad);
    for cmd in &mut s.commands {
        if cmd.get("Cmd").and_then(|v| v.as_str()) != Some("AddPart") { continue; }
        if cmd.get("Id").and_then(|v| v.as_str())  != Some(sel.as_str()) { continue; }
        if let Some(so) = cmd.get_mut("Size") {
            let cur = so.get(axis).and_then(|v| v.as_f64()).unwrap_or(1.0) as f32;
            so[axis] = serde_json::json!((cur + delta * 2.0).max(0.05));
        }
        break;
    }
    s.dirty = true;
}

fn wide(s: &str) -> Vec<u16> {
    OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
}

unsafe fn key_held(vk: i32) -> f32 {
    if (GetAsyncKeyState(vk) as u16) & 0x8000 != 0 { 1.0 } else { 0.0 }
}

unsafe extern "system" fn wnd_proc(
    hwnd: HWND, msg: u32, wparam: usize, lparam: isize,
) -> isize {
    match msg {
        WM_PAINT        => { ValidateRect(hwnd, std::ptr::null()); 0 }
        WM_ERASEBKGND   => 1,
        WM_CONTEXTMENU  => 0,
        WM_MOUSEACTIVATE => MA_NOACTIVATE as isize,

        WM_LBUTTONDOWN => {
            let x = (lparam & 0xFFFF) as i16;
            let y = ((lparam >> 16) & 0xFFFF) as i16;
            let axis = VP_STATE.get().and_then(|sa| sa.lock().ok()).and_then(|s| {
                let (_, _, w, h) = s.bounds;
                if w == 0 || h == 0 { return None; }
                let nx = (x as f32 / w as f32) * 2.0 - 1.0;
                let ny = 1.0 - (y as f32 / h as f32) * 2.0;
                gizmo_hit(&s, nx, ny)
            });

            DRAG.with(|d| {
                let mut dr = d.borrow_mut();
                dr.start_x = x; dr.start_y = y;
                dr.last_x  = x; dr.last_y  = y;
                dr.has_dragged = false;
                dr.mode = if axis.is_some() { DragMode::GizmoDrag } else { DragMode::Orbit };
            });
            GIZMO_AXIS.with(|g| *g.borrow_mut() = axis.unwrap_or_default());
            SetCapture(hwnd);
            0
        }

        WM_MOUSEMOVE => {
            let x = (lparam & 0xFFFF) as i16;
            let y = ((lparam >> 16) & 0xFFFF) as i16;

            let (mode, prev_x, prev_y, axis) = DRAG.with(|d| {
                let mut dr = d.borrow_mut();
                let px = dr.last_x; let py = dr.last_y;
                dr.last_x = x; dr.last_y = y;
                if (x - dr.start_x).abs() > 2 || (y - dr.start_y).abs() > 2 {
                    dr.has_dragged = true;
                }
                let ax = GIZMO_AXIS.with(|g| g.borrow().clone());
                (dr.mode, px, py, ax)
            });

            let dx = (x - prev_x) as f32;
            let dy = (y - prev_y) as f32;

            match mode {
                DragMode::Orbit => {
                    if let Some(ci) = VP_CAM.get() {
                        if let Ok(mut ci) = ci.lock() { ci.orbit_dx += dx; ci.orbit_dy += dy; }
                    }
                }
                DragMode::Pan => {
                    if let Some(ci) = VP_CAM.get() {
                        if let Ok(mut ci) = ci.lock() { ci.pan_dx += dx; ci.pan_dy += dy; }
                    }
                }
                DragMode::GizmoDrag => {
                    if let (Some(sa), Some(ua)) = (VP_STATE.get(), VP_UNDO.get()) {
                        if let (Ok(mut s), Ok(mut u)) = (sa.lock(), ua.lock()) {
                            let (_, _, w, h) = s.bounds;
                            if w > 0 && h > 0 {
                                let ndc = |px: i16, py: i16| -> (f32, f32) {
                                    ((px as f32 / w as f32) * 2.0 - 1.0,
                                     1.0 - (py as f32 / h as f32) * 2.0)
                                };
                                let (pnx, pny) = ndc(prev_x, prev_y);
                                let (cnx, cny) = ndc(x, y);
                                let gm = s.gizmo_mode.clone();
                                match gm.as_str() {
                                    "move"   => do_move_drag(&mut s, &mut u, &axis, pnx, pny, cnx, cny),
                                    "rotate" => do_rotate_drag(&mut s, &mut u, &axis, pnx, pny, cnx, cny),
                                    "scale"  => do_scale_drag(&mut s, &mut u, &axis, pnx, pny, cnx, cny),
                                    _ => {}
                                }
                            }
                        }
                    }
                }
                DragMode::None => {}
            }
            0
        }

        WM_LBUTTONUP => {
            let x = (lparam & 0xFFFF) as i16;
            let y = ((lparam >> 16) & 0xFFFF) as i16;
            ReleaseCapture();

            let (had_drag, mode) = DRAG.with(|d| {
                let mut dr = d.borrow_mut();
                let hd = dr.has_dragged;
                let m  = dr.mode;
                dr.mode = DragMode::None;
                (hd, m)
            });

            if mode == DragMode::GizmoDrag {
                if let Some(sa) = VP_STATE.get() {
                    if let Ok(mut s) = sa.lock() { s.drag_undo_pushed = false; }
                }
            }

            if !had_drag {
                if let Some(sa) = VP_STATE.get() {
                    if let Ok(mut s) = sa.lock() {
                        let (_, _, w, h) = s.bounds;
                        if w > 0 && h > 0 {
                            let nx = (x as f32 / w as f32) * 2.0 - 1.0;
                            let ny = 1.0 - (y as f32 / h as f32) * 2.0;
                            let sel = click_select(&mut s, nx, ny);
                            if let Some(app) = VP_APP.get() {
                                let _ = app.emit_all("vp-selected", sel);
                            }
                        }
                    }
                }
            }
            0
        }

        WM_RBUTTONDOWN => {
            let x = (lparam & 0xFFFF) as i16;
            let y = ((lparam >> 16) & 0xFFFF) as i16;
            let timer = SetTimer(hwnd, 1, 16, None) as usize;
            DRAG.with(|d| {
                let mut dr = d.borrow_mut();
                dr.mode = DragMode::Pan;
                dr.last_x = x; dr.last_y = y;
                dr.start_x = x; dr.start_y = y;
                dr.has_dragged = false;
                dr.fly_timer = timer;
            });
            SetCapture(hwnd);
            0
        }

        WM_RBUTTONUP => {
            ReleaseCapture();
            DRAG.with(|d| {
                let mut dr = d.borrow_mut();
                dr.mode = DragMode::None;
                if dr.fly_timer != 0 { KillTimer(hwnd, dr.fly_timer); dr.fly_timer = 0; }
            });
            0
        }

        WM_MOUSEWHEEL => {
            let delta = (wparam >> 16) as i16;
            if let Some(ci) = VP_CAM.get() {
                if let Ok(mut ci) = ci.lock() { ci.zoom += delta as f32 / 120.0; }
            }
            0
        }

        WM_TIMER => {
            if wparam == 1 {
                let fwd = key_held(0x57) - key_held(0x53); // W, S
                let rgt = key_held(0x44) - key_held(0x41); // D, A
                let up  = key_held(0x45) - key_held(0x51); // E, Q
                if fwd != 0.0 || rgt != 0.0 || up != 0.0 {
                    if let Some(ci) = VP_CAM.get() {
                        if let Ok(mut ci) = ci.lock() {
                            ci.forward += fwd; ci.right += rgt; ci.up += up;
                        }
                    }
                }
            }
            0
        }

        _ => DefWindowProcW(hwnd, msg, wparam, lparam),
    }
}

pub fn create_child_window(parent_hwnd: isize) -> Result<isize, String> {
    unsafe {
        let class_name = wide("NyxRendererClass");
        let instance = GetModuleHandleW(std::ptr::null());

        let wc = WNDCLASSEXW {
            cbSize:        std::mem::size_of::<WNDCLASSEXW>() as u32,
            style:         CS_HREDRAW | CS_VREDRAW,
            lpfnWndProc:   Some(wnd_proc),
            cbClsExtra:    0,
            cbWndExtra:    0,
            hInstance:     instance,
            hIcon:         0,
            hCursor:       LoadCursorW(0, IDC_ARROW),
            hbrBackground: 0,
            lpszMenuName:  std::ptr::null(),
            lpszClassName: class_name.as_ptr(),
            hIconSm:       0,
        };
        RegisterClassExW(&wc);

        let hwnd = CreateWindowExW(
            0,
            class_name.as_ptr(),
            wide("NyxRenderer").as_ptr(),
            WS_CHILD | WS_CLIPSIBLINGS,
            0, 0, 1, 1,
            parent_hwnd as HWND,
            0,
            instance,
            std::ptr::null(),
        );

        if hwnd == 0 {
            return Err("CreateWindowExW failed".to_string());
        }
        Ok(hwnd as isize)
    }
}

pub fn set_window_bounds(hwnd: isize, x: i32, y: i32, w: u32, h: u32) {
    unsafe {
        SetWindowPos(hwnd as HWND, HWND_TOP, x, y, w as i32, h as i32, SWP_NOACTIVATE);
    }
}

pub fn show_window(hwnd: isize, visible: bool) {
    unsafe {
        if visible {
            SetWindowPos(hwnd as HWND, HWND_TOP, 0, 0, 0, 0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW | SWP_NOACTIVATE);
        } else {
            ShowWindow(hwnd as HWND, SW_HIDE);
        }
    }
}

pub fn detach_window(hwnd: isize) {
    unsafe {
        let style = GetWindowLongW(hwnd as HWND, GWL_STYLE);
        SetWindowLongW(hwnd as HWND, GWL_STYLE,
            (style & !(WS_CHILD as i32)) | WS_VISIBLE as i32 | WS_OVERLAPPEDWINDOW as i32);
        SetParent(hwnd as HWND, 0);
        ShowWindow(hwnd as HWND, SW_SHOW);
    }
}

pub fn set_z_order(hwnd: isize, on_top: bool) {
    unsafe {
        let pos = if on_top { HWND_TOP } else { HWND_BOTTOM };
        SetWindowPos(hwnd as HWND, pos, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    }
}

pub fn attach_window(hwnd: isize, parent: isize, x: i32, y: i32, w: u32, h: u32) {
    unsafe {
        let style = GetWindowLongW(hwnd as HWND, GWL_STYLE);
        SetWindowLongW(hwnd as HWND, GWL_STYLE,
            (style & !(WS_OVERLAPPEDWINDOW as i32)) | WS_CHILD as i32);
        SetParent(hwnd as HWND, parent as HWND);
        set_window_bounds(hwnd, x, y, w, h);
        ShowWindow(hwnd as HWND, SW_SHOW);
    }
}
