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
    CreateWindowExW, DefWindowProcW, GetWindowLongW, KillTimer, LoadCursorW, RegisterClassExW,
    SetParent, SetTimer, SetWindowLongW, SetWindowPos, ShowWindow as WinShowWindow, CS_HREDRAW,
    CS_VREDRAW, GWL_STYLE, HWND_BOTTOM, HWND_TOP, IDC_ARROW, MA_NOACTIVATE, SWP_NOACTIVATE,
    SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW, SW_HIDE, SW_SHOW, WM_CONTEXTMENU, WM_ERASEBKGND,
    WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MOUSEACTIVATE, WM_MOUSEMOVE, WM_MOUSEWHEEL, WM_PAINT,
    WM_RBUTTONDOWN, WM_RBUTTONUP, WM_TIMER, WNDCLASSEXW, WS_CHILD, WS_CLIPSIBLINGS,
    WS_OVERLAPPEDWINDOW, WS_VISIBLE,
};

use super::ownership;
use super::{CameraInput, SceneState, SelectedFace, UndoHistory};
extern "system" {
    fn SetCapture(hwnd: HWND) -> HWND;
    fn ReleaseCapture() -> windows_sys::Win32::Foundation::BOOL;
}

pub static VP_CAM: OnceLock<Arc<Mutex<CameraInput>>> = OnceLock::new();
pub static VP_STATE: OnceLock<Arc<Mutex<SceneState>>> = OnceLock::new();
pub static VP_UNDO: OnceLock<Arc<Mutex<UndoHistory>>> = OnceLock::new();
pub static VP_APP: OnceLock<tauri::AppHandle> = OnceLock::new();

pub fn InitViewportInput(
    cam: Arc<Mutex<CameraInput>>,
    state: Arc<Mutex<SceneState>>,
    undo: Arc<Mutex<UndoHistory>>,
    app: tauri::AppHandle,
) {
    VP_CAM.set(cam).ok();
    VP_STATE.set(state).ok();
    VP_UNDO.set(undo).ok();
    VP_APP.set(app).ok();
}

#[derive(Clone, Copy, Default, PartialEq)]
enum DragMode {
    #[default]
    None,
    Orbit,
    Pan,
    GizmoDrag,
}

struct DragState {
    mode: DragMode,
    last_x: i16,
    last_y: i16,
    start_x: i16,
    start_y: i16,
    has_dragged: bool,
    fly_timer: usize,
}

impl Default for DragState {
    fn default() -> Self {
        Self {
            mode: DragMode::None,
            last_x: 0,
            last_y: 0,
            start_x: 0,
            start_y: 0,
            has_dragged: false,
            fly_timer: 0,
        }
    }
}

thread_local! {
    static DRAG:       RefCell<DragState> = RefCell::new(DragState::default());
    static GIZMO_AXIS: RefCell<String>    = RefCell::new(String::new());
}

fn MarkEditInteraction() {
    if let Some(sa) = VP_STATE.get() {
        if let Ok(mut s) = sa.lock() {
            s.last_edit_interaction = std::time::Instant::now();
        }
    }
}

fn RayAabb(o: glam::Vec3, d: glam::Vec3, mn: glam::Vec3, mx: glam::Vec3) -> Option<f32> {
    let NonZero = |v: f32| {
        if v.abs() < 1e-8 {
            1e-8_f32.copysign(v)
        } else {
            v
        }
    };
    let d = glam::Vec3::new(NonZero(d.x), NonZero(d.y), NonZero(d.z));
    let inv = 1.0 / d;
    let mut tmin = (mn.x - o.x) * inv.x;
    let mut tmax = (mx.x - o.x) * inv.x;
    if inv.x < 0.0 {
        std::mem::swap(&mut tmin, &mut tmax);
    }
    let mut tymin = (mn.y - o.y) * inv.y;
    let mut tymax = (mx.y - o.y) * inv.y;
    if inv.y < 0.0 {
        std::mem::swap(&mut tymin, &mut tymax);
    }
    if tmin > tymax || tymin > tmax {
        return None;
    }
    if tymin > tmin {
        tmin = tymin;
    }
    if tymax < tmax {
        tmax = tymax;
    }
    let mut tzmin = (mn.z - o.z) * inv.z;
    let mut tzmax = (mx.z - o.z) * inv.z;
    if inv.z < 0.0 {
        std::mem::swap(&mut tzmin, &mut tzmax);
    }
    if tmin > tzmax || tzmin > tmax {
        return None;
    }
    if tzmin > tmin {
        tmin = tzmin;
    }
    if tzmax < tmax {
        tmax = tzmax;
    }
    if tmax < 0.0 {
        None
    } else {
        Some(tmin.max(0.0))
    }
}

fn RaySegDist(ro: glam::Vec3, rd: glam::Vec3, p0: glam::Vec3, p1: glam::Vec3) -> f32 {
    let v = p1 - p0;
    let w = ro - p0;
    let a = rd.dot(rd);
    let b = rd.dot(v);
    let c = v.dot(v);
    let d = rd.dot(w);
    let e = v.dot(w);
    let den = a * c - b * b;
    let (mut sc, mut tc) = if den < 1e-4 {
        (0.0, if b > c { d / b } else { e / c })
    } else {
        ((b * e - c * d) / den, (a * e - b * d) / den)
    };
    if tc < 0.0 {
        tc = 0.0;
        sc = -d / a;
    } else if tc > 1.0 {
        tc = 1.0;
        sc = (b - d) / a;
    }
    (w + rd * sc - v * tc).length()
}

fn ClosestT(ro: glam::Vec3, rd: glam::Vec3, lo: glam::Vec3, ld: glam::Vec3) -> f32 {
    let w = ro - lo;
    let b = rd.dot(ld);
    let d = rd.dot(w);
    let e = ld.dot(w);
    let den = 1.0 - b * b;
    if den.abs() < 1e-6 {
        return e;
    }
    (e - b * d) / den
}

fn GizmoMetrics(sx: f32, sy: f32, sz: f32) -> (f32, f32, f32, f32) {
    let MaxSize = sx.max(sy).max(sz).max(0.001);
    let len = (MaxSize * 0.9).clamp(6.0, 600.0);
    let MovePick = (len * 0.08).clamp(0.8, 40.0);
    let ScalePick = (len * 0.12).clamp(1.0, 50.0);
    let RotatePick = ((MaxSize * 0.5 + (len * 0.06).clamp(0.35, 24.0)) * 0.04).clamp(0.4, 40.0);
    (len, MovePick, ScalePick, RotatePick)
}

fn IsEditableObject(Command: &serde_json::Value) -> bool {
    matches!(
        Command.get("Cmd").and_then(|Value| Value.as_str()),
        Some("AddPart") | Some("AddMesh")
    )
}

fn ObjectScalar(Command: &serde_json::Value, Key: &str, Field: &str, Fallback: f32) -> f32 {
    Command
        .get(Key)
        .and_then(|Object| Object.get(Field))
        .and_then(|Value| Value.as_f64())
        .map(|Value| Value as f32)
        .unwrap_or(Fallback)
}

fn ObjectExtent(Command: &serde_json::Value, Field: &str, Fallback: f32) -> f32 {
    let Base = Command
        .get("Bounds")
        .or_else(|| Command.get("Size"))
        .and_then(|Object| Object.get(Field))
        .and_then(|Value| Value.as_f64())
        .map(|Value| Value as f32)
        .unwrap_or(Fallback);
    if Command.get("Bounds").is_some() {
        Base * ObjectScalar(Command, "Size", Field, 1.0).abs().max(0.001)
    } else {
        Base
    }
}

fn MeshPoint(Value: &serde_json::Value) -> Option<[f32; 3]> {
    Some([
        Value.get("X")?.as_f64()? as f32,
        Value.get("Y")?.as_f64()? as f32,
        Value.get("Z")?.as_f64()? as f32,
    ])
}

fn EulerToQuat(rx: f32, ry: f32, rz: f32) -> glam::Quat {
    let (cx, sx) = ((rx * 0.5).cos(), (rx * 0.5).sin());
    let (cy, sy) = ((ry * 0.5).cos(), (ry * 0.5).sin());
    let (cz, sz) = ((rz * 0.5).cos(), (rz * 0.5).sin());
    glam::Quat::from_xyzw(
        cy * sx * cz + sy * cx * sz,
        sy * cx * cz - cy * sx * sz,
        cy * cx * sz - sy * sx * cz,
        cy * cx * cz + sy * sx * sz,
    )
    .normalize()
}

fn TransformPoint(Command: &serde_json::Value, Point: [f32; 3]) -> glam::Vec3 {
    let Position = glam::Vec3::new(
        ObjectScalar(Command, "Position", "X", 0.0),
        ObjectScalar(Command, "Position", "Y", 0.0),
        ObjectScalar(Command, "Position", "Z", 0.0),
    );
    let Size = glam::Vec3::new(
        ObjectScalar(Command, "Size", "X", 1.0),
        ObjectScalar(Command, "Size", "Y", 1.0),
        ObjectScalar(Command, "Size", "Z", 1.0),
    );
    let CFrame = Command.get("CFrame");
    let Rotation = EulerToQuat(
        CFrame
            .and_then(|Object| Object.get("RX"))
            .and_then(|Value| Value.as_f64())
            .unwrap_or(0.0) as f32,
        CFrame
            .and_then(|Object| Object.get("RY"))
            .and_then(|Value| Value.as_f64())
            .unwrap_or(0.0) as f32,
        CFrame
            .and_then(|Object| Object.get("RZ"))
            .and_then(|Value| Value.as_f64())
            .unwrap_or(0.0) as f32,
    );
    Position + Rotation * (glam::Vec3::new(Point[0], Point[1], Point[2]) * Size)
}

fn RayTriangle(
    Origin: glam::Vec3,
    Direction: glam::Vec3,
    A: glam::Vec3,
    B: glam::Vec3,
    C: glam::Vec3,
) -> Option<f32> {
    let E1 = B - A;
    let E2 = C - A;
    let P = Direction.cross(E2);
    let Det = E1.dot(P);
    if Det.abs() < 1e-6 {
        return None;
    }
    let InvDet = 1.0 / Det;
    let T = Origin - A;
    let U = T.dot(P) * InvDet;
    if !(0.0..=1.0).contains(&U) {
        return None;
    }
    let Q = T.cross(E1);
    let V = Direction.dot(Q) * InvDet;
    if V < 0.0 || U + V > 1.0 {
        return None;
    }
    let HitT = E2.dot(Q) * InvDet;
    if HitT >= 0.0 {
        Some(HitT)
    } else {
        None
    }
}

fn PushUndo(s: &SceneState, u: &mut UndoHistory) {
    u.undo_stack.push(s.commands.clone());
    if u.undo_stack.len() > 50 {
        u.undo_stack.remove(0);
    }
    u.redo_stack.clear();
}

fn PartPos(s: &SceneState, id: &str) -> Option<glam::Vec3> {
    for cmd in &s.commands {
        if !IsEditableObject(cmd) {
            continue;
        }
        if cmd.get("Id").and_then(|v| v.as_str()) != Some(id) {
            continue;
        }
        return Some(glam::Vec3::new(
            ObjectScalar(cmd, "Position", "X", 0.0),
            ObjectScalar(cmd, "Position", "Y", 0.0),
            ObjectScalar(cmd, "Position", "Z", 0.0),
        ));
    }
    None
}

fn ReconcilePhysics(s: &mut SceneState) {
    let mut physics = std::mem::take(&mut s.physics);
    let profile = s.profile.clone();
    physics.Reconcile(&s.commands, &profile);
    s.physics = physics;
}

fn ClaimTransform(s: &mut SceneState, id: &str) {
    let mut Ordinal = 0usize;
    let mut Claim: Option<(ownership::OwnedTransform, ownership::PartSignature, bool)> = None;
    for cmd in &s.commands {
        if !IsEditableObject(cmd) {
            continue;
        }
        let ThisOrdinal = Ordinal;
        Ordinal += 1;
        if cmd.get("Id").and_then(|v| v.as_str()) == Some(id) {
            let mut Transform = ownership::ReadTransform(cmd);
            Transform.has_rotation = true;
            Transform.has_size = true;
            let UserOwnable = cmd
                .get("UserOwnable")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            Claim = Some((
                Transform,
                ownership::SignatureOf(cmd, ThisOrdinal),
                UserOwnable,
            ));
            break;
        }
    }
    let Some((Transform, Signature, UserOwnable)) = Claim else {
        return;
    };
    match s.ownership.get_mut(id) {
        Some(Existing) => {
            Existing.phase = ownership::OwnershipPhase::Held;
            Existing.transform = Transform;
            Existing.signature = Signature;
            Existing.user_ownable = UserOwnable;
            Existing.missing_ticks = 0;
        }
        None => {
            s.ownership.insert(
                id.to_string(),
                ownership::PartOwnership::held(Transform, Signature, UserOwnable),
            );
        }
    }
}

fn GizmoHit(s: &SceneState, NdcX: f32, NdcY: f32) -> Option<String> {
    let sel = s.selected.as_ref()?.clone();
    let (o, d) = s.camera.GetRay(NdcX, NdcY);

    for cmd in &s.commands {
        if !IsEditableObject(cmd) {
            continue;
        }
        if cmd.get("Id").and_then(|v| v.as_str()) != Some(sel.as_str()) {
            continue;
        }
        let c = glam::Vec3::new(
            ObjectScalar(cmd, "Position", "X", 0.0),
            ObjectScalar(cmd, "Position", "Y", 0.0),
            ObjectScalar(cmd, "Position", "Z", 0.0),
        );
        let sx = ObjectExtent(cmd, "X", 2.0);
        let sy = ObjectExtent(cmd, "Y", 2.0);
        let sz = ObjectExtent(cmd, "Z", 2.0);
        let (len, MovePick, ScalePick, RotatePick) = GizmoMetrics(sx, sy, sz);

        return match s.gizmo_mode.as_str() {
            "rotate" => {
                let r =
                    (sx.max(sy).max(sz) * 0.5 + (len * 0.06).clamp(0.35, 24.0)).clamp(1.2, 1200.0);
                let test = |n: glam::Vec3| -> Option<f32> {
                    let den = n.dot(d);
                    if den.abs() < 1e-6 {
                        return None;
                    }
                    let t = n.dot(c - o) / den;
                    if t < 0.0 {
                        return None;
                    }
                    let dist = ((o + d * t - c).length() - r).abs();
                    if dist < RotatePick {
                        Some(dist)
                    } else {
                        None
                    }
                };
                let opts = [
                    ("X", test(glam::Vec3::X)),
                    ("Y", test(glam::Vec3::Y)),
                    ("Z", test(glam::Vec3::Z)),
                ];
                opts.into_iter()
                    .filter_map(|(ax, v)| v.map(|q| (ax, q)))
                    .min_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal))
                    .map(|(ax, _)| ax.into())
            }
            "scale" => {
                let tips = [
                    ("X", c + glam::Vec3::X * len),
                    ("Y", c + glam::Vec3::Y * len),
                    ("Z", c + glam::Vec3::Z * len),
                ];
                tips.iter()
                    .map(|(ax, tip)| {
                        let v = *tip - o;
                        let t = v.dot(d);
                        (*ax, (v - d * t).length())
                    })
                    .filter(|(_, dist)| *dist < ScalePick)
                    .min_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal))
                    .map(|(ax, _)| ax.into())
            }
            _ => {
                let dx = RaySegDist(o, d, c, c + glam::Vec3::X * len);
                let dy = RaySegDist(o, d, c, c + glam::Vec3::Y * len);
                let dz = RaySegDist(o, d, c, c + glam::Vec3::Z * len);
                if dx < MovePick && dx < dy && dx < dz {
                    Some("X".into())
                } else if dy < MovePick && dy < dz {
                    Some("Y".into())
                } else if dz < MovePick {
                    Some("Z".into())
                } else {
                    None
                }
            }
        };
    }
    None
}

fn PickMeshFace(
    Command: &serde_json::Value,
    Origin: glam::Vec3,
    Direction: glam::Vec3,
) -> Option<(f32, usize)> {
    if Command.get("Cmd").and_then(|Value| Value.as_str()) != Some("AddMesh") {
        return None;
    }
    let SourceVertices = Command.get("Vertices").and_then(|Value| Value.as_array())?;
    let SourceIndices = Command.get("Indices").and_then(|Value| Value.as_array())?;
    let mut Best: Option<(f32, usize)> = None;
    for (FaceIndex, Triangle) in SourceIndices.chunks(3).enumerate() {
        if Triangle.len() != 3 {
            continue;
        }
        let AIndex = Triangle[0].as_u64()? as usize;
        let BIndex = Triangle[1].as_u64()? as usize;
        let CIndex = Triangle[2].as_u64()? as usize;
        let A = TransformPoint(Command, MeshPoint(SourceVertices.get(AIndex)?)?);
        let B = TransformPoint(Command, MeshPoint(SourceVertices.get(BIndex)?)?);
        let C = TransformPoint(Command, MeshPoint(SourceVertices.get(CIndex)?)?);
        if let Some(T) = RayTriangle(Origin, Direction, A, B, C) {
            if Best.map(|(BestT, _)| T < BestT).unwrap_or(true) {
                Best = Some((T, FaceIndex));
            }
        }
    }
    Best
}

fn ClickSelect(s: &mut SceneState, NdcX: f32, NdcY: f32) -> Option<String> {
    let (o, d) = s.camera.GetRay(NdcX, NdcY);
    let mut BestT = f32::MAX;
    let mut BestId: Option<String> = None;
    let mut BestFace: Option<SelectedFace> = None;
    for cmd in &s.commands {
        if !IsEditableObject(cmd) {
            continue;
        }
        if let Some((T, FaceIndex)) = PickMeshFace(cmd, o, d) {
            if T < BestT {
                BestT = T;
                BestId = cmd
                    .get("Id")
                    .and_then(|Value| Value.as_str())
                    .map(|Value| Value.to_string());
                BestFace = BestId.as_ref().map(|PartId| SelectedFace {
                    part_id: PartId.clone(),
                    face_index: FaceIndex,
                });
                continue;
            }
        }
        let c = glam::Vec3::new(
            ObjectScalar(cmd, "Position", "X", 0.0),
            ObjectScalar(cmd, "Position", "Y", 0.0),
            ObjectScalar(cmd, "Position", "Z", 0.0),
        );
        let e = glam::Vec3::new(
            ObjectExtent(cmd, "X", 1.0),
            ObjectExtent(cmd, "Y", 1.0),
            ObjectExtent(cmd, "Z", 1.0),
        ) * 0.5;
        if let Some(t) = RayAabb(o, d, c - e, c + e) {
            if t < BestT {
                BestT = t;
                BestId = cmd
                    .get("Id")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                BestFace = None;
            }
        }
    }
    s.selected = BestId.clone();
    s.selected_face = BestFace;
    s.dirty = true;
    BestId
}

fn DoMoveDrag(
    s: &mut SceneState,
    u: &mut UndoHistory,
    axis: &str,
    pnx: f32,
    pny: f32,
    cnx: f32,
    cny: f32,
) {
    let sel = match s.selected.clone() {
        Some(id) => id,
        None => return,
    };
    if !s.drag_undo_pushed {
        PushUndo(s, u);
        s.drag_undo_pushed = true;
    }
    let ad = match axis {
        "X" => glam::Vec3::X,
        "Y" => glam::Vec3::Y,
        _ => glam::Vec3::Z,
    };
    let pp = match PartPos(s, &sel) {
        Some(p) => p,
        None => return,
    };
    let (po, pd) = s.camera.GetRay(pnx, pny);
    let (co, cd) = s.camera.GetRay(cnx, cny);
    let np = pp + ad * (ClosestT(co, cd, pp, ad) - ClosestT(po, pd, pp, ad));
    for cmd in &mut s.commands {
        if !IsEditableObject(cmd) {
            continue;
        }
        if cmd.get("Id").and_then(|v| v.as_str()) != Some(sel.as_str()) {
            continue;
        }
        if let Some(p) = cmd.get_mut("Position") {
            *p = serde_json::json!({"X": np.x, "Y": np.y, "Z": np.z});
        }
        let mut cf = cmd
            .get("CFrame")
            .cloned()
            .unwrap_or_else(|| serde_json::json!({"RX":0,"RY":0,"RZ":0}));
        cf["X"] = serde_json::json!(np.x);
        cf["Y"] = serde_json::json!(np.y);
        cf["Z"] = serde_json::json!(np.z);
        cmd["CFrame"] = cf;
        break;
    }
    ClaimTransform(s, &sel);
    ReconcilePhysics(s);
    s.dirty = true;
}

fn DoRotateDrag(
    s: &mut SceneState,
    u: &mut UndoHistory,
    axis: &str,
    pnx: f32,
    pny: f32,
    cnx: f32,
    cny: f32,
) {
    let sel = match s.selected.clone() {
        Some(id) => id,
        None => return,
    };
    if !s.drag_undo_pushed {
        PushUndo(s, u);
        s.drag_undo_pushed = true;
    }
    let pn = match axis {
        "X" => glam::Vec3::X,
        "Y" => glam::Vec3::Y,
        _ => glam::Vec3::Z,
    };
    let pp = match PartPos(s, &sel) {
        Some(p) => p,
        None => return,
    };
    let (po, pd) = s.camera.GetRay(pnx, pny);
    let (co, cd) = s.camera.GetRay(cnx, cny);
    let isect = |ro: glam::Vec3, rd: glam::Vec3| -> Option<glam::Vec3> {
        let den = pn.dot(rd);
        if den.abs() < 1e-6 {
            return None;
        }
        let t = pn.dot(pp - ro) / den;
        if t < 0.0 {
            None
        } else {
            Some(ro + rd * t)
        }
    };
    let (PrevPt, CurrPt) = match (isect(po, pd), isect(co, cd)) {
        (Some(a), Some(b)) => (a, b),
        _ => return,
    };
    let vp = PrevPt - pp;
    let vc = CurrPt - pp;
    if vp.length() < 1e-6 || vc.length() < 1e-6 {
        return;
    }
    let angle = vp
        .normalize()
        .cross(vc.normalize())
        .dot(pn)
        .atan2(vp.normalize().dot(vc.normalize()).clamp(-1.0, 1.0));
    let rk = match axis {
        "X" => "RX",
        "Y" => "RY",
        _ => "RZ",
    };
    for cmd in &mut s.commands {
        if !IsEditableObject(cmd) {
            continue;
        }
        if cmd.get("Id").and_then(|v| v.as_str()) != Some(sel.as_str()) {
            continue;
        }
        let cur: f32 = cmd
            .get("CFrame")
            .and_then(|cf| cf.get(rk))
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0) as f32;
        let mut ncf = cmd
            .get("CFrame")
            .cloned()
            .unwrap_or_else(|| serde_json::json!({"RX":0,"RY":0,"RZ":0}));
        ncf[rk] = serde_json::json!(cur + angle);
        cmd["CFrame"] = ncf;
        break;
    }
    ClaimTransform(s, &sel);
    ReconcilePhysics(s);
    s.dirty = true;
}

fn DoScaleDrag(
    s: &mut SceneState,
    u: &mut UndoHistory,
    axis: &str,
    pnx: f32,
    pny: f32,
    cnx: f32,
    cny: f32,
) {
    let sel = match s.selected.clone() {
        Some(id) => id,
        None => return,
    };
    if !s.drag_undo_pushed {
        PushUndo(s, u);
        s.drag_undo_pushed = true;
    }
    let ad = match axis {
        "X" => glam::Vec3::X,
        "Y" => glam::Vec3::Y,
        _ => glam::Vec3::Z,
    };
    let pp = match PartPos(s, &sel) {
        Some(p) => p,
        None => return,
    };
    let (po, pd) = s.camera.GetRay(pnx, pny);
    let (co, cd) = s.camera.GetRay(cnx, cny);
    let delta = ClosestT(co, cd, pp, ad) - ClosestT(po, pd, pp, ad);
    for cmd in &mut s.commands {
        if !IsEditableObject(cmd) {
            continue;
        }
        if cmd.get("Id").and_then(|v| v.as_str()) != Some(sel.as_str()) {
            continue;
        }
        if let Some(so) = cmd.get_mut("Size") {
            let cur = so.get(axis).and_then(|v| v.as_f64()).unwrap_or(1.0) as f32;
            so[axis] = serde_json::json!((cur + delta * 2.0).max(0.05));
        }
        break;
    }
    ClaimTransform(s, &sel);
    ReconcilePhysics(s);
    s.dirty = true;
}

fn wide(s: &str) -> Vec<u16> {
    OsStr::new(s)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

unsafe fn KeyHeld(vk: i32) -> f32 {
    if (GetAsyncKeyState(vk) as u16) & 0x8000 != 0 {
        1.0
    } else {
        0.0
    }
}

unsafe extern "system" fn WndProc(hwnd: HWND, msg: u32, wparam: usize, lparam: isize) -> isize {
    match msg {
        WM_PAINT => {
            ValidateRect(hwnd, std::ptr::null());
            0
        }
        WM_ERASEBKGND => 1,
        WM_CONTEXTMENU => 0,
        WM_MOUSEACTIVATE => MA_NOACTIVATE as isize,

        WM_LBUTTONDOWN => {
            let x = (lparam & 0xFFFF) as i16;
            let y = ((lparam >> 16) & 0xFFFF) as i16;
            let axis = VP_STATE.get().and_then(|sa| sa.lock().ok()).and_then(|s| {
                let (_, _, w, h) = s.bounds;
                if w == 0 || h == 0 {
                    return None;
                }
                let nx = (x as f32 / w as f32) * 2.0 - 1.0;
                let ny = 1.0 - (y as f32 / h as f32) * 2.0;
                GizmoHit(&s, nx, ny)
            });
            if axis.is_some() {
                MarkEditInteraction();
            }

            DRAG.with(|d| {
                let mut dr = d.borrow_mut();
                dr.start_x = x;
                dr.start_y = y;
                dr.last_x = x;
                dr.last_y = y;
                dr.has_dragged = false;
                dr.mode = if axis.is_some() {
                    DragMode::GizmoDrag
                } else {
                    DragMode::Orbit
                };
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
                let px = dr.last_x;
                let py = dr.last_y;
                dr.last_x = x;
                dr.last_y = y;
                if (x - dr.start_x).abs() > 2 || (y - dr.start_y).abs() > 2 {
                    dr.has_dragged = true;
                }
                let ax = GIZMO_AXIS.with(|g| g.borrow().clone());
                (dr.mode, px, py, ax)
            });

            let dx = (x - prev_x) as f32;
            let dy = (y - prev_y) as f32;
            if mode == DragMode::GizmoDrag && (dx != 0.0 || dy != 0.0) {
                MarkEditInteraction();
            }

            match mode {
                DragMode::Orbit => {
                    if let Some(ci) = VP_CAM.get() {
                        if let Ok(mut ci) = ci.lock() {
                            ci.orbit_dx += dx;
                            ci.orbit_dy += dy;
                        }
                    }
                }
                DragMode::Pan => {
                    if let Some(ci) = VP_CAM.get() {
                        if let Ok(mut ci) = ci.lock() {
                            ci.pan_dx += dx;
                            ci.pan_dy += dy;
                        }
                    }
                }
                DragMode::GizmoDrag => {
                    if let (Some(sa), Some(ua)) = (VP_STATE.get(), VP_UNDO.get()) {
                        if let (Ok(mut s), Ok(mut u)) = (sa.lock(), ua.lock()) {
                            let (_, _, w, h) = s.bounds;
                            if w > 0 && h > 0 {
                                let ndc = |px: i16, py: i16| -> (f32, f32) {
                                    (
                                        (px as f32 / w as f32) * 2.0 - 1.0,
                                        1.0 - (py as f32 / h as f32) * 2.0,
                                    )
                                };
                                let (pnx, pny) = ndc(prev_x, prev_y);
                                let (cnx, cny) = ndc(x, y);
                                let gm = s.gizmo_mode.clone();
                                match gm.as_str() {
                                    "move" => DoMoveDrag(&mut s, &mut u, &axis, pnx, pny, cnx, cny),
                                    "rotate" => {
                                        DoRotateDrag(&mut s, &mut u, &axis, pnx, pny, cnx, cny)
                                    }
                                    "scale" => {
                                        DoScaleDrag(&mut s, &mut u, &axis, pnx, pny, cnx, cny)
                                    }
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
                let m = dr.mode;
                dr.mode = DragMode::None;
                (hd, m)
            });

            if mode == DragMode::GizmoDrag {
                MarkEditInteraction();
                let mut KeptIds: Option<Vec<String>> = None;
                if let Some(sa) = VP_STATE.get() {
                    if let Ok(mut s) = sa.lock() {
                        s.drag_undo_pushed = false;
                        let Now = std::time::Instant::now();
                        for Owned in s.ownership.values_mut() {
                            Owned.release(Now);
                        }
                        KeptIds = Some(ownership::KeptIds(&s.ownership));
                    }
                }
                if let (Some(Ids), Some(app)) = (KeptIds, VP_APP.get()) {
                    let _ = app.emit_all("vp-ownership", Ids);
                }
            }

            if !had_drag {
                if let Some(sa) = VP_STATE.get() {
                    if let Ok(mut s) = sa.lock() {
                        let (_, _, w, h) = s.bounds;
                        if w > 0 && h > 0 {
                            let nx = (x as f32 / w as f32) * 2.0 - 1.0;
                            let ny = 1.0 - (y as f32 / h as f32) * 2.0;
                            let sel = ClickSelect(&mut s, nx, ny);
                            let Face = s.selected_face.as_ref().map(|Face| {
                                serde_json::json!({
                                    "PartId": Face.part_id,
                                    "FaceIndex": Face.face_index,
                                })
                            });
                            if let Some(app) = VP_APP.get() {
                                let _ = app.emit_all("vp-selected", sel);
                                let _ = app.emit_all("vp-face-selected", Face);
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
                dr.last_x = x;
                dr.last_y = y;
                dr.start_x = x;
                dr.start_y = y;
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
                if dr.fly_timer != 0 {
                    KillTimer(hwnd, dr.fly_timer);
                    dr.fly_timer = 0;
                }
            });
            0
        }

        WM_MOUSEWHEEL => {
            let delta = (wparam >> 16) as i16;
            if let Some(ci) = VP_CAM.get() {
                if let Ok(mut ci) = ci.lock() {
                    ci.zoom += delta as f32 / 120.0;
                }
            }
            0
        }

        WM_TIMER => {
            if wparam == 1 {
                let fwd = KeyHeld(0x57) - KeyHeld(0x53); // W, S
                let rgt = KeyHeld(0x44) - KeyHeld(0x41); // D, A
                let up = KeyHeld(0x45) - KeyHeld(0x51); // E, Q
                if fwd != 0.0 || rgt != 0.0 || up != 0.0 {
                    if let Some(ci) = VP_CAM.get() {
                        if let Ok(mut ci) = ci.lock() {
                            ci.forward += fwd;
                            ci.right += rgt;
                            ci.up += up;
                        }
                    }
                }
            }
            0
        }

        _ => DefWindowProcW(hwnd, msg, wparam, lparam),
    }
}

pub fn CreateChildWindow(ParentHwnd: isize) -> Result<isize, String> {
    unsafe {
        let ClassName = wide("NyxRendererClass");
        let instance = GetModuleHandleW(std::ptr::null());

        let wc = WNDCLASSEXW {
            cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
            style: CS_HREDRAW | CS_VREDRAW,
            lpfnWndProc: Some(WndProc),
            cbClsExtra: 0,
            cbWndExtra: 0,
            hInstance: instance,
            hIcon: 0,
            hCursor: LoadCursorW(0, IDC_ARROW),
            hbrBackground: 0,
            lpszMenuName: std::ptr::null(),
            lpszClassName: ClassName.as_ptr(),
            hIconSm: 0,
        };
        RegisterClassExW(&wc);

        let hwnd = CreateWindowExW(
            0,
            ClassName.as_ptr(),
            wide("NyxRenderer").as_ptr(),
            WS_CHILD | WS_CLIPSIBLINGS,
            0,
            0,
            1,
            1,
            ParentHwnd as HWND,
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

pub fn SetWindowBounds(hwnd: isize, x: i32, y: i32, w: u32, h: u32) {
    unsafe {
        SetWindowPos(
            hwnd as HWND,
            HWND_TOP,
            x,
            y,
            w as i32,
            h as i32,
            SWP_NOACTIVATE,
        );
    }
}

pub fn ShowWindow(hwnd: isize, visible: bool) {
    unsafe {
        if visible {
            SetWindowPos(
                hwnd as HWND,
                HWND_TOP,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW | SWP_NOACTIVATE,
            );
        } else {
            WinShowWindow(hwnd as HWND, SW_HIDE);
        }
    }
}

pub fn DetachWindow(hwnd: isize) {
    unsafe {
        let style = GetWindowLongW(hwnd as HWND, GWL_STYLE);
        SetWindowLongW(
            hwnd as HWND,
            GWL_STYLE,
            (style & !(WS_CHILD as i32)) | WS_VISIBLE as i32 | WS_OVERLAPPEDWINDOW as i32,
        );
        SetParent(hwnd as HWND, 0);
        WinShowWindow(hwnd as HWND, SW_SHOW);
    }
}

pub fn SetZOrder(hwnd: isize, on_top: bool) {
    unsafe {
        let pos = if on_top { HWND_TOP } else { HWND_BOTTOM };
        SetWindowPos(
            hwnd as HWND,
            pos,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
        );
    }
}

pub fn AttachWindow(hwnd: isize, parent: isize, x: i32, y: i32, w: u32, h: u32) {
    unsafe {
        let style = GetWindowLongW(hwnd as HWND, GWL_STYLE);
        SetWindowLongW(
            hwnd as HWND,
            GWL_STYLE,
            (style & !(WS_OVERLAPPEDWINDOW as i32)) | WS_CHILD as i32,
        );
        SetParent(hwnd as HWND, parent as HWND);
        SetWindowBounds(hwnd, x, y, w, h);
        WinShowWindow(hwnd as HWND, SW_SHOW);
    }
}
