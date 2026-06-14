use tauri::{AppHandle, State};

use super::RendererState;
use crate::renderer::ownership::ApplyOwnershipMerge;
use crate::renderer::{window as nyx_window, SelectedFace};
use crate::state::AppState;

fn RayAabbIntersect(
    origin: glam::Vec3,
    dir: glam::Vec3,
    min: glam::Vec3,
    max: glam::Vec3,
) -> Option<f32> {
    let InvDir = 1.0 / dir;
    let mut tmin = (min.x - origin.x) * InvDir.x;
    let mut tmax = (max.x - origin.x) * InvDir.x;
    if InvDir.x < 0.0 {
        std::mem::swap(&mut tmin, &mut tmax);
    }

    let mut tymin = (min.y - origin.y) * InvDir.y;
    let mut tymax = (max.y - origin.y) * InvDir.y;
    if InvDir.y < 0.0 {
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

    let mut tzmin = (min.z - origin.z) * InvDir.z;
    let mut tzmax = (max.z - origin.z) * InvDir.z;
    if InvDir.z < 0.0 {
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
        return None;
    }
    Some(tmin.max(0.0))
}

fn DistRaySegment(
    ray_origin: glam::Vec3,
    ray_dir: glam::Vec3,
    p0: glam::Vec3,
    p1: glam::Vec3,
) -> f32 {
    let u = ray_dir;
    let v = p1 - p0;
    let w = ray_origin - p0;

    let a = u.dot(u);
    let b = u.dot(v);
    let c = v.dot(v);
    let d = u.dot(w);
    let e = v.dot(w);

    let den = a * c - b * b;
    let mut sc;
    let mut tc;

    if den < 1e-4 {
        sc = 0.0;
        tc = if b > c { d / b } else { e / c };
    } else {
        sc = (b * e - c * d) / den;
        tc = (a * e - b * d) / den;
    }

    if tc < 0.0 {
        tc = 0.0;
        sc = -d / a;
    } else if tc > 1.0 {
        tc = 1.0;
        sc = (b - d) / a;
    }

    let dp = w + u * sc - v * tc;
    dp.length()
}

fn ClosestTOnLine(
    ray_o: glam::Vec3,
    ray_d: glam::Vec3,
    line_o: glam::Vec3,
    line_d: glam::Vec3,
) -> f32 {
    let w = ray_o - line_o;
    let b = ray_d.dot(line_d);
    let d = ray_d.dot(w);
    let e = line_d.dot(w);
    let den = 1.0 - b * b;
    if den.abs() < 1e-6 {
        return e;
    }
    (e - b * d) / den
}

fn PushUndo(state: &crate::renderer::SceneState, undo: &mut crate::renderer::UndoHistory) {
    undo.undo_stack.push(state.commands.clone());
    if undo.undo_stack.len() > 50 {
        undo.undo_stack.remove(0);
    }
    undo.redo_stack.clear();
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
    Command
        .get("Bounds")
        .or_else(|| Command.get("Size"))
        .and_then(|Object| Object.get(Field))
        .and_then(|Value| Value.as_f64())
        .map(|Value| Value as f32)
        .unwrap_or(Fallback)
}

fn MeshPoint(Value: &serde_json::Value) -> Option<[f32; 3]> {
    Some([
        Value.get("X")?.as_f64()? as f32,
        Value.get("Y")?.as_f64()? as f32,
        Value.get("Z")?.as_f64()? as f32,
    ])
}

fn SubdivideMeshCommand(Command: &mut serde_json::Value) -> Result<(), String> {
    if Command.get("Cmd").and_then(|Value| Value.as_str()) != Some("AddMesh") {
        return Err("Selected object is not a mesh".to_string());
    }

    let SourceVertices = Command
        .get("Vertices")
        .and_then(|Value| Value.as_array())
        .ok_or("Mesh has no vertices")?;
    let SourceIndices = Command
        .get("Indices")
        .and_then(|Value| Value.as_array())
        .ok_or("Mesh has no indices")?;

    let mut Vertices: Vec<[f32; 3]> = SourceVertices
        .iter()
        .map(|Value| MeshPoint(Value).ok_or("Invalid mesh vertex"))
        .collect::<Result<Vec<_>, _>>()?;
    let Indices: Vec<u32> = SourceIndices
        .iter()
        .map(|Value| {
            Value
                .as_u64()
                .map(|Index| Index as u32)
                .ok_or("Invalid mesh index")
        })
        .collect::<Result<Vec<_>, _>>()?;
    if Indices.len() < 3 {
        return Err("Mesh has no faces to subdivide".to_string());
    }

    let mut Midpoints: std::collections::HashMap<(u32, u32), u32> =
        std::collections::HashMap::new();
    let mut NewIndices: Vec<u32> = Vec::with_capacity(Indices.len() * 4);
    let mut Midpoint = |A: u32, B: u32, Vertices: &mut Vec<[f32; 3]>| -> Result<u32, String> {
        let Key = if A < B { (A, B) } else { (B, A) };
        if let Some(Index) = Midpoints.get(&Key) {
            return Ok(*Index);
        }
        let PA = *Vertices
            .get(A as usize)
            .ok_or("Mesh index exceeds vertex count")?;
        let PB = *Vertices
            .get(B as usize)
            .ok_or("Mesh index exceeds vertex count")?;
        let Point = [
            (PA[0] + PB[0]) * 0.5,
            (PA[1] + PB[1]) * 0.5,
            (PA[2] + PB[2]) * 0.5,
        ];
        let Index = Vertices.len() as u32;
        Vertices.push(Point);
        Midpoints.insert(Key, Index);
        Ok(Index)
    };

    for Triangle in Indices.chunks(3) {
        if Triangle.len() != 3 {
            continue;
        }
        let A = Triangle[0];
        let B = Triangle[1];
        let C = Triangle[2];
        let AB = Midpoint(A, B, &mut Vertices)?;
        let BC = Midpoint(B, C, &mut Vertices)?;
        let CA = Midpoint(C, A, &mut Vertices)?;
        NewIndices.extend_from_slice(&[A, AB, CA, AB, B, BC, CA, BC, C, AB, BC, CA]);
    }

    let mut Min = [f32::MAX; 3];
    let mut Max = [f32::MIN; 3];
    for Vertex in &Vertices {
        for I in 0..3 {
            if Vertex[I] < Min[I] {
                Min[I] = Vertex[I];
            }
            if Vertex[I] > Max[I] {
                Max[I] = Vertex[I];
            }
        }
    }

    Command["Vertices"] = serde_json::json!(Vertices
        .iter()
        .map(|Vertex| serde_json::json!({"X": Vertex[0], "Y": Vertex[1], "Z": Vertex[2]}))
        .collect::<Vec<_>>());
    Command["Indices"] = serde_json::json!(NewIndices);
    Command["Bounds"] = serde_json::json!({
        "X": (Max[0] - Min[0]).max(0.001),
        "Y": (Max[1] - Min[1]).max(0.001),
        "Z": (Max[2] - Min[2]).max(0.001),
    });
    let Level = Command
        .get("SubdivisionLevel")
        .and_then(|Value| Value.as_u64())
        .unwrap_or(0)
        + 1;
    Command["SubdivisionLevel"] = serde_json::json!(Level);
    if let Some(Object) = Command.as_object_mut() {
        Object.remove("Normals");
    }
    Ok(())
}

fn UpdateMeshBounds(Command: &mut serde_json::Value, Vertices: &[[f32; 3]]) {
    if Vertices.is_empty() {
        Command["Bounds"] = serde_json::json!({
            "X": 0.001,
            "Y": 0.001,
            "Z": 0.001,
        });
        return;
    }
    let mut Min = [f32::MAX; 3];
    let mut Max = [f32::MIN; 3];
    for Vertex in Vertices {
        for I in 0..3 {
            if Vertex[I] < Min[I] {
                Min[I] = Vertex[I];
            }
            if Vertex[I] > Max[I] {
                Max[I] = Vertex[I];
            }
        }
    }
    Command["Bounds"] = serde_json::json!({
        "X": (Max[0] - Min[0]).max(0.001),
        "Y": (Max[1] - Min[1]).max(0.001),
        "Z": (Max[2] - Min[2]).max(0.001),
    });
}

fn ExtrudeMeshFaceCommand(
    Command: &mut serde_json::Value,
    FaceIndex: usize,
    Distance: f32,
) -> Result<usize, String> {
    if Command.get("Cmd").and_then(|Value| Value.as_str()) != Some("AddMesh") {
        return Err("Selected object is not a mesh".to_string());
    }
    if Distance.abs() <= 0.0001 {
        return Err("Extrude distance is too small".to_string());
    }

    let SourceVertices = Command
        .get("Vertices")
        .and_then(|Value| Value.as_array())
        .ok_or("Mesh has no vertices")?;
    let SourceIndices = Command
        .get("Indices")
        .and_then(|Value| Value.as_array())
        .ok_or("Mesh has no indices")?;
    let mut Vertices: Vec<[f32; 3]> = SourceVertices
        .iter()
        .map(|Value| MeshPoint(Value).ok_or("Invalid mesh vertex"))
        .collect::<Result<Vec<_>, _>>()?;
    let mut Indices: Vec<u32> = SourceIndices
        .iter()
        .map(|Value| {
            Value
                .as_u64()
                .map(|Index| Index as u32)
                .ok_or("Invalid mesh index")
        })
        .collect::<Result<Vec<_>, _>>()?;

    let Offset = FaceIndex * 3;
    if Offset + 2 >= Indices.len() {
        return Err("Selected face index is out of range".to_string());
    }
    let AIndex = Indices[Offset];
    let BIndex = Indices[Offset + 1];
    let CIndex = Indices[Offset + 2];
    let A = *Vertices
        .get(AIndex as usize)
        .ok_or("Mesh index exceeds vertex count")?;
    let B = *Vertices
        .get(BIndex as usize)
        .ok_or("Mesh index exceeds vertex count")?;
    let C = *Vertices
        .get(CIndex as usize)
        .ok_or("Mesh index exceeds vertex count")?;

    let Normal = (glam::Vec3::new(B[0], B[1], B[2]) - glam::Vec3::new(A[0], A[1], A[2]))
        .cross(glam::Vec3::new(C[0], C[1], C[2]) - glam::Vec3::new(A[0], A[1], A[2]))
        .normalize_or_zero();
    if Normal.length_squared() <= 0.000001 {
        return Err("Selected face has no usable normal".to_string());
    }
    let OffsetVec = Normal * Distance;
    let PushOffset = |Vertex: [f32; 3], Vertices: &mut Vec<[f32; 3]>| -> u32 {
        let Index = Vertices.len() as u32;
        Vertices.push([
            Vertex[0] + OffsetVec.x,
            Vertex[1] + OffsetVec.y,
            Vertex[2] + OffsetVec.z,
        ]);
        Index
    };
    let A2 = PushOffset(A, &mut Vertices);
    let B2 = PushOffset(B, &mut Vertices);
    let C2 = PushOffset(C, &mut Vertices);
    let NewFaceIndex = Indices.len() / 3;
    Indices.extend_from_slice(&[
        A2, B2, C2, AIndex, BIndex, B2, AIndex, B2, A2, BIndex, CIndex, C2, BIndex, C2, B2, CIndex,
        AIndex, A2, CIndex, A2, C2,
    ]);

    Command["Vertices"] = serde_json::json!(Vertices
        .iter()
        .map(|Vertex| serde_json::json!({"X": Vertex[0], "Y": Vertex[1], "Z": Vertex[2]}))
        .collect::<Vec<_>>());
    Command["Indices"] = serde_json::json!(Indices);
    UpdateMeshBounds(Command, &Vertices);
    let Count = Command
        .get("ExtrusionCount")
        .and_then(|Value| Value.as_u64())
        .unwrap_or(0)
        + 1;
    Command["ExtrusionCount"] = serde_json::json!(Count);
    if let Some(Object) = Command.as_object_mut() {
        Object.remove("Normals");
    }
    Ok(NewFaceIndex)
}

fn DeleteMeshFaceCommand(Command: &mut serde_json::Value, FaceIndex: usize) -> Result<(), String> {
    if Command.get("Cmd").and_then(|Value| Value.as_str()) != Some("AddMesh") {
        return Err("Selected object is not a mesh".to_string());
    }
    let SourceVertices = Command
        .get("Vertices")
        .and_then(|Value| Value.as_array())
        .ok_or("Mesh has no vertices")?;
    let SourceIndices = Command
        .get("Indices")
        .and_then(|Value| Value.as_array())
        .ok_or("Mesh has no indices")?;
    let Vertices: Vec<[f32; 3]> = SourceVertices
        .iter()
        .map(|Value| MeshPoint(Value).ok_or("Invalid mesh vertex"))
        .collect::<Result<Vec<_>, _>>()?;
    let mut Indices: Vec<u32> = SourceIndices
        .iter()
        .map(|Value| {
            Value
                .as_u64()
                .map(|Index| Index as u32)
                .ok_or("Invalid mesh index")
        })
        .collect::<Result<Vec<_>, _>>()?;
    let Offset = FaceIndex * 3;
    if Offset + 2 >= Indices.len() {
        return Err("Selected face index is out of range".to_string());
    }
    Indices.drain(Offset..Offset + 3);

    let mut Remap: std::collections::HashMap<u32, u32> = std::collections::HashMap::new();
    let mut NewVertices: Vec<[f32; 3]> = Vec::new();
    let mut NewIndices: Vec<u32> = Vec::with_capacity(Indices.len());
    for Index in Indices {
        if (Index as usize) >= Vertices.len() {
            return Err("Mesh index exceeds vertex count".to_string());
        }
        let NewIndex = match Remap.get(&Index) {
            Some(Value) => *Value,
            None => {
                let Value = NewVertices.len() as u32;
                NewVertices.push(Vertices[Index as usize]);
                Remap.insert(Index, Value);
                Value
            }
        };
        NewIndices.push(NewIndex);
    }

    Command["Vertices"] = serde_json::json!(NewVertices
        .iter()
        .map(|Vertex| serde_json::json!({"X": Vertex[0], "Y": Vertex[1], "Z": Vertex[2]}))
        .collect::<Vec<_>>());
    Command["Indices"] = serde_json::json!(NewIndices);
    UpdateMeshBounds(Command, &NewVertices);
    let Count = Command
        .get("DeletedFaceCount")
        .and_then(|Value| Value.as_u64())
        .unwrap_or(0)
        + 1;
    Command["DeletedFaceCount"] = serde_json::json!(Count);
    if let Some(Object) = Command.as_object_mut() {
        Object.remove("Normals");
    }
    Ok(())
}

#[tauri::command]
pub fn renderer_camera_orbit(
    dx: f32,
    dy: f32,
    renderer: State<'_, RendererState>,
) -> Result<(), String> {
    let r = renderer.lock().map_err(|e| e.to_string())?;
    let mut ci = r.camera_input.lock().map_err(|e| e.to_string())?;
    ci.orbit_dx += dx;
    ci.orbit_dy += dy;
    Ok(())
}

#[tauri::command]
pub fn renderer_camera_pan(
    dx: f32,
    dy: f32,
    renderer: State<'_, RendererState>,
) -> Result<(), String> {
    let r = renderer.lock().map_err(|e| e.to_string())?;
    let mut ci = r.camera_input.lock().map_err(|e| e.to_string())?;
    ci.pan_dx += dx;
    ci.pan_dy += dy;
    Ok(())
}

#[tauri::command]
pub fn renderer_camera_zoom(delta: f32, renderer: State<'_, RendererState>) -> Result<(), String> {
    let r = renderer.lock().map_err(|e| e.to_string())?;
    let mut ci = r.camera_input.lock().map_err(|e| e.to_string())?;
    ci.zoom += delta;
    Ok(())
}

#[tauri::command]
pub fn renderer_camera_wasd(
    forward: f32,
    right: f32,
    up: f32,
    renderer: State<'_, RendererState>,
) -> Result<(), String> {
    let r = renderer.lock().map_err(|e| e.to_string())?;
    let mut ci = r.camera_input.lock().map_err(|e| e.to_string())?;
    ci.forward += forward;
    ci.right += right;
    ci.up += up;
    Ok(())
}

#[tauri::command]
pub fn renderer_camera_right_mouse(
    _down: bool,
    _renderer: State<'_, RendererState>,
) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub fn renderer_gizmo_hit_test(
    x: f32,
    y: f32,
    width: f32,
    height: f32,
    renderer: State<'_, RendererState>,
) -> Result<Option<String>, String> {
    let r = renderer.lock().map_err(|e| e.to_string())?;
    let s = r.state.lock().map_err(|e| e.to_string())?;

    let sel = match &s.selected {
        Some(id) => id.clone(),
        None => return Ok(None),
    };

    let NdcX = (x / width) * 2.0 - 1.0;
    let NdcY = 1.0 - (y / height) * 2.0;
    let (origin, dir) = s.camera.GetRay(NdcX, NdcY);

    for cmd in &s.commands {
        if !IsEditableObject(cmd) {
            continue;
        }
        if cmd.get("Id").and_then(|v| v.as_str()) != Some(sel.as_str()) {
            continue;
        }

        let gf = |k: &str, f: &str| -> f32 {
            cmd.get(k)
                .and_then(|o| o.get(f))
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0) as f32
        };
        let c = glam::Vec3::new(
            gf("Position", "X"),
            gf("Position", "Y"),
            gf("Position", "Z"),
        );
        let sx = ObjectExtent(cmd, "X", 2.0);
        let sy = ObjectExtent(cmd, "Y", 2.0);
        let sz = ObjectExtent(cmd, "Z", 2.0);

        match s.gizmo_mode.as_str() {
            "rotate" => {
                let radius = sx.max(sy).max(sz) * 0.5 + 0.8;
                let thr = 0.4_f32;
                let TestRing = |PlaneNormal: glam::Vec3| -> Option<f32> {
                    let denom = PlaneNormal.dot(dir);
                    if denom.abs() < 1e-6 {
                        return None;
                    }
                    let t = PlaneNormal.dot(c - origin) / denom;
                    if t < 0.0 {
                        return None;
                    }
                    let hit = origin + dir * t;
                    let dist = ((hit - c).length() - radius).abs();
                    if dist < thr {
                        Some(dist)
                    } else {
                        None
                    }
                };
                let dx = TestRing(glam::Vec3::X);
                let dy = TestRing(glam::Vec3::Y);
                let dz = TestRing(glam::Vec3::Z);
                let best = [("X", dx), ("Y", dy), ("Z", dz)]
                    .into_iter()
                    .filter_map(|(ax, d)| d.map(|v| (ax, v)))
                    .min_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));
                if let Some((ax, _)) = best {
                    return Ok(Some(ax.into()));
                }
            }
            "scale" => {
                let len = 6.0_f32;
                let thr = 1.0_f32;
                let tips = [
                    ("X", c + glam::Vec3::X * len),
                    ("Y", c + glam::Vec3::Y * len),
                    ("Z", c + glam::Vec3::Z * len),
                ];
                let best = tips
                    .iter()
                    .map(|(ax, tip)| {
                        let v = *tip - origin;
                        let t = v.dot(dir);
                        let d = (v - dir * t).length();
                        (ax, d)
                    })
                    .filter(|(_, d)| *d < thr)
                    .min_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));
                if let Some((ax, _)) = best {
                    return Ok(Some((*ax).into()));
                }
            }
            _ => {
                let len = 6.0_f32;
                let dx = DistRaySegment(origin, dir, c, c + glam::Vec3::X * len);
                let dy = DistRaySegment(origin, dir, c, c + glam::Vec3::Y * len);
                let dz = DistRaySegment(origin, dir, c, c + glam::Vec3::Z * len);
                let thr = 0.8_f32;
                if dx < thr && dx < dy && dx < dz {
                    return Ok(Some("X".into()));
                }
                if dy < thr && dy < dz {
                    return Ok(Some("Y".into()));
                }
                if dz < thr {
                    return Ok(Some("Z".into()));
                }
            }
        }
        break;
    }

    Ok(None)
}

#[tauri::command]
pub fn renderer_gizmo_drag(
    axis: String,
    prev_x: f32,
    prev_y: f32,
    curr_x: f32,
    curr_y: f32,
    width: f32,
    height: f32,
    renderer: State<'_, RendererState>,
) -> Result<Option<[f32; 3]>, String> {
    let r = renderer.lock().map_err(|e| e.to_string())?;
    let mut s = r.state.lock().map_err(|e| e.to_string())?;
    s.last_edit_interaction = std::time::Instant::now();

    let sel = match s.selected.clone() {
        Some(id) => id,
        None => return Ok(None),
    };

    if !s.drag_undo_pushed {
        let mut u = r.undo.lock().map_err(|e| e.to_string())?;
        PushUndo(&s, &mut u);
        s.drag_undo_pushed = true;
    }

    let AxisDir = match axis.as_str() {
        "X" => glam::Vec3::X,
        "Y" => glam::Vec3::Y,
        "Z" => glam::Vec3::Z,
        _ => return Ok(None),
    };

    let PartPos = {
        let mut found = None;
        for cmd in &s.commands {
            if !IsEditableObject(cmd) {
                continue;
            }
            if cmd.get("Id").and_then(|v| v.as_str()) != Some(sel.as_str()) {
                continue;
            }
            let f = |k: &str, ff: &str| -> f32 {
                cmd.get(k)
                    .and_then(|o| o.get(ff))
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.0) as f32
            };
            found = Some(glam::Vec3::new(
                f("Position", "X"),
                f("Position", "Y"),
                f("Position", "Z"),
            ));
            break;
        }
        match found {
            Some(p) => p,
            None => return Ok(None),
        }
    };

    let ToNdc =
        |sx: f32, sy: f32| -> (f32, f32) { ((sx / width) * 2.0 - 1.0, 1.0 - (sy / height) * 2.0) };
    let (pnx, pny) = ToNdc(prev_x, prev_y);
    let (cnx, cny) = ToNdc(curr_x, curr_y);
    let (po, pd) = s.camera.GetRay(pnx, pny);
    let (co, cd) = s.camera.GetRay(cnx, cny);

    let TPrev = ClosestTOnLine(po, pd, PartPos, AxisDir);
    let TCurr = ClosestTOnLine(co, cd, PartPos, AxisDir);
    let NewPos = PartPos + AxisDir * (TCurr - TPrev);

    for cmd in &mut s.commands {
        if !IsEditableObject(cmd) {
            continue;
        }
        if cmd.get("Id").and_then(|v| v.as_str()) != Some(sel.as_str()) {
            continue;
        }
        if let Some(p) = cmd.get_mut("Position") {
            *p = serde_json::json!({"X": NewPos.x, "Y": NewPos.y, "Z": NewPos.z});
        }
        break;
    }

    let mut physics = std::mem::take(&mut s.physics);
    let profile = s.profile.clone();
    physics.Reconcile(&s.commands, &profile);
    s.physics = physics;
    s.dirty = true;
    Ok(Some([NewPos.x, NewPos.y, NewPos.z]))
}

#[tauri::command]
pub fn renderer_click(
    x: f32,
    y: f32,
    width: f32,
    height: f32,
    renderer: State<'_, RendererState>,
    app_state: State<'_, AppState>,
) -> Result<Option<String>, String> {
    let r = renderer.lock().map_err(|e| e.to_string())?;
    let mut s = r.state.lock().map_err(|e| e.to_string())?;

    let NdcX = (x / width) * 2.0 - 1.0;
    let NdcY = 1.0 - (y / height) * 2.0;

    let (origin, dir) = s.camera.GetRay(NdcX, NdcY);

    let mut ClosestT = f32::MAX;
    let mut SelectedId = None;

    for cmd in &s.commands {
        if IsEditableObject(cmd) {
            let px = ObjectScalar(cmd, "Position", "X", 0.0);
            let py = ObjectScalar(cmd, "Position", "Y", 0.0);
            let pz = ObjectScalar(cmd, "Position", "Z", 0.0);

            let sx = ObjectExtent(cmd, "X", 1.0);
            let sy = ObjectExtent(cmd, "Y", 1.0);
            let sz = ObjectExtent(cmd, "Z", 1.0);

            let center = glam::Vec3::new(px, py, pz);
            let extents = glam::Vec3::new(sx, sy, sz) * 0.5;

            let min = center - extents;
            let max = center + extents;

            if let Some(t) = RayAabbIntersect(origin, dir, min, max) {
                if t < ClosestT {
                    ClosestT = t;
                    if let Some(id) = cmd.get("Id").and_then(|v| v.as_str()) {
                        SelectedId = Some(id.to_string());
                    }
                }
            }
        }
    }

    s.selected = SelectedId.clone();
    s.dirty = true;
    *app_state
        .selected_part_id
        .lock()
        .map_err(|e| e.to_string())? = SelectedId.clone();

    Ok(SelectedId)
}

#[tauri::command]
pub fn renderer_set_on_top(
    on_top: bool,
    app: AppHandle,
    renderer: State<'_, RendererState>,
) -> Result<(), String> {
    let hwnd = renderer.lock().map_err(|e| e.to_string())?.hwnd;
    app.run_on_main_thread(move || {
        nyx_window::SetZOrder(hwnd, on_top);
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn renderer_load_scene(
    commands: Vec<serde_json::Value>,
    profile: String,
    renderer: State<'_, RendererState>,
    app_state: State<'_, AppState>,
) -> Result<(), String> {
    let r = renderer.lock().map_err(|e| e.to_string())?;
    let mut s = r.state.lock().map_err(|e| e.to_string())?;
    let mut physics = std::mem::take(&mut s.physics);
    physics.Reset(&commands, &profile);
    s.commands = commands.clone();
    s.profile = profile.clone();
    s.physics = physics;
    s.selected = None;
    s.selected_face = None;
    s.dirty = true;
    *app_state.scene_commands.lock().map_err(|e| e.to_string())? = commands;
    *app_state.scene_profile.lock().map_err(|e| e.to_string())? = Some(profile);
    *app_state
        .selected_part_id
        .lock()
        .map_err(|e| e.to_string())? = None;
    Ok(())
}

pub(crate) fn ApplyLiveScene(
    renderer: &RendererState,
    app_state: &AppState,
    mut commands: Vec<serde_json::Value>,
    profile: &str,
) -> Result<bool, String> {
    {
        let r = renderer.lock().map_err(|e| e.to_string())?;
        let mut s = r.state.lock().map_err(|e| e.to_string())?;
        // No global edit gate: the scene clock and every other part keep running
        // while the user manipulates one part. Conflicts are resolved per-part by
        // the ownership merge below — held parts are pinned, released parts ease
        // back, and a no-op while nothing is owned (the common case).
        ApplyOwnershipMerge(&mut commands, &mut s.ownership, std::time::Instant::now());
        let mut physics = std::mem::take(&mut s.physics);
        physics.Reconcile(&commands, profile);
        s.commands = commands.clone();
        s.profile = profile.to_string();
        s.physics = physics;
        s.skip_camera_meta = true;
        s.dirty = true;
    }
    *app_state.scene_commands.lock().map_err(|e| e.to_string())? = commands;
    *app_state.scene_profile.lock().map_err(|e| e.to_string())? = Some(profile.to_string());
    Ok(true)
}

#[tauri::command]
pub fn renderer_set_bounds(
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    app: AppHandle,
    renderer: State<'_, RendererState>,
) -> Result<(), String> {
    let hwnd = {
        let r = renderer.lock().map_err(|e| e.to_string())?;
        let mut s = r.state.lock().map_err(|e| e.to_string())?;
        s.bounds = (x, y, width, height);
        r.hwnd
    };
    app.run_on_main_thread(move || {
        nyx_window::SetWindowBounds(hwnd, x, y, width, height);
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn renderer_set_visible(
    visible: bool,
    app: AppHandle,
    renderer: State<'_, RendererState>,
    app_state: State<'_, AppState>,
) -> Result<(), String> {
    let hwnd = {
        let r = renderer.lock().map_err(|e| e.to_string())?;
        let mut s = r.state.lock().map_err(|e| e.to_string())?;
        s.visible = visible;
        r.hwnd
    };
    *app_state
        .viewport_visible
        .lock()
        .map_err(|e| e.to_string())? = visible;
    app.run_on_main_thread(move || {
        nyx_window::ShowWindow(hwnd, visible);
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn renderer_detach(app: AppHandle, renderer: State<'_, RendererState>) -> Result<(), String> {
    let hwnd = renderer.lock().map_err(|e| e.to_string())?.hwnd;
    app.run_on_main_thread(move || {
        nyx_window::DetachWindow(hwnd);
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn renderer_attach(
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    app: AppHandle,
    renderer: State<'_, RendererState>,
) -> Result<(), String> {
    use tauri::Manager;
    let hwnd = renderer.lock().map_err(|e| e.to_string())?.hwnd;
    let ParentHwnd = {
        use raw_window_handle::{HasRawWindowHandle, RawWindowHandle};
        match app
            .get_window("main")
            .ok_or("main window not found")?
            .raw_window_handle()
        {
            RawWindowHandle::Win32(h) => h.hwnd as isize,
            _ => return Err("Not a Win32 window".to_string()),
        }
    };
    app.run_on_main_thread(move || {
        nyx_window::AttachWindow(hwnd, ParentHwnd, x, y, width, height);
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn renderer_get_part(
    id: String,
    renderer: State<'_, RendererState>,
) -> Result<Option<serde_json::Value>, String> {
    let r = renderer.lock().map_err(|e| e.to_string())?;
    let s = r.state.lock().map_err(|e| e.to_string())?;
    for cmd in &s.commands {
        if !IsEditableObject(cmd) {
            continue;
        }
        if cmd.get("Id").and_then(|v| v.as_str()) == Some(id.as_str()) {
            return Ok(Some(cmd.clone()));
        }
    }
    Ok(None)
}

#[tauri::command]
pub fn renderer_set_part_properties(
    id: String,
    position: Option<serde_json::Value>,
    size: Option<serde_json::Value>,
    color: Option<serde_json::Value>,
    rotation: Option<serde_json::Value>,
    renderer: State<'_, RendererState>,
) -> Result<(), String> {
    let r = renderer.lock().map_err(|e| e.to_string())?;
    let mut s = r.state.lock().map_err(|e| e.to_string())?;
    s.last_edit_interaction = std::time::Instant::now();
    {
        let mut u = r.undo.lock().map_err(|e| e.to_string())?;
        PushUndo(&s, &mut u);
    }
    for cmd in &mut s.commands {
        if !IsEditableObject(cmd) {
            continue;
        }
        if cmd.get("Id").and_then(|v| v.as_str()) != Some(id.as_str()) {
            continue;
        }
        if let Some(p) = position {
            cmd["Position"] = p;
        }
        if let Some(sz) = size {
            cmd["Size"] = sz;
        }
        if let Some(c) = color {
            cmd["Color"] = c;
        }
        if let Some(rot) = rotation {
            let CurCf = cmd.get("CFrame").cloned().unwrap_or(serde_json::json!({}));
            let mut NewCf = CurCf;
            if let Some(rx) = rot.get("RX") {
                NewCf["RX"] = rx.clone();
            }
            if let Some(ry) = rot.get("RY") {
                NewCf["RY"] = ry.clone();
            }
            if let Some(rz) = rot.get("RZ") {
                NewCf["RZ"] = rz.clone();
            }
            if let Some(pos) = cmd.get("Position") {
                NewCf["X"] = pos.get("X").cloned().unwrap_or(serde_json::json!(0.0));
                NewCf["Y"] = pos.get("Y").cloned().unwrap_or(serde_json::json!(0.0));
                NewCf["Z"] = pos.get("Z").cloned().unwrap_or(serde_json::json!(0.0));
            }
            cmd["CFrame"] = NewCf;
        }
        break;
    }
    let mut physics = std::mem::take(&mut s.physics);
    let profile = s.profile.clone();
    physics.Reconcile(&s.commands, &profile);
    s.physics = physics;
    s.dirty = true;
    Ok(())
}

#[tauri::command]
pub fn renderer_set_gizmo_mode(
    mode: String,
    renderer: State<'_, RendererState>,
    app_state: State<'_, AppState>,
) -> Result<(), String> {
    let r = renderer.lock().map_err(|e| e.to_string())?;
    let mut s = r.state.lock().map_err(|e| e.to_string())?;
    s.gizmo_mode = mode.clone();
    s.dirty = true;
    *app_state.gizmo_mode.lock().map_err(|e| e.to_string())? = mode;
    Ok(())
}

#[tauri::command]
pub fn renderer_rotate_drag(
    axis: String,
    prev_x: f32,
    prev_y: f32,
    curr_x: f32,
    curr_y: f32,
    width: f32,
    height: f32,
    renderer: State<'_, RendererState>,
) -> Result<Option<[f32; 3]>, String> {
    let r = renderer.lock().map_err(|e| e.to_string())?;
    let mut s = r.state.lock().map_err(|e| e.to_string())?;

    let sel = match s.selected.clone() {
        Some(id) => id,
        None => return Ok(None),
    };

    s.last_edit_interaction = std::time::Instant::now();
    if !s.drag_undo_pushed {
        let mut u = r.undo.lock().map_err(|e| e.to_string())?;
        PushUndo(&s, &mut u);
        s.drag_undo_pushed = true;
    }

    let PlaneNormal = match axis.as_str() {
        "X" => glam::Vec3::X,
        "Y" => glam::Vec3::Y,
        "Z" => glam::Vec3::Z,
        _ => return Ok(None),
    };

    let PartPos = {
        let mut found = None;
        for cmd in &s.commands {
            if !IsEditableObject(cmd) {
                continue;
            }
            if cmd.get("Id").and_then(|v| v.as_str()) != Some(sel.as_str()) {
                continue;
            }
            let f = |k: &str, ff: &str| -> f32 {
                cmd.get(k)
                    .and_then(|o| o.get(ff))
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.0) as f32
            };
            found = Some(glam::Vec3::new(
                f("Position", "X"),
                f("Position", "Y"),
                f("Position", "Z"),
            ));
            break;
        }
        match found {
            Some(p) => p,
            None => return Ok(None),
        }
    };

    let ToNdc =
        |sx: f32, sy: f32| -> (f32, f32) { ((sx / width) * 2.0 - 1.0, 1.0 - (sy / height) * 2.0) };
    let (pnx, pny) = ToNdc(prev_x, prev_y);
    let (cnx, cny) = ToNdc(curr_x, curr_y);
    let (po, pd) = s.camera.GetRay(pnx, pny);
    let (co, cd) = s.camera.GetRay(cnx, cny);

    let PlaneIntersect = |ray_o: glam::Vec3, ray_d: glam::Vec3| -> Option<glam::Vec3> {
        let denom = PlaneNormal.dot(ray_d);
        if denom.abs() < 1e-6 {
            return None;
        }
        let t = PlaneNormal.dot(PartPos - ray_o) / denom;
        if t < 0.0 {
            return None;
        }
        Some(ray_o + ray_d * t)
    };

    let PrevPt = match PlaneIntersect(po, pd) {
        Some(p) => p,
        None => return Ok(None),
    };
    let CurrPt = match PlaneIntersect(co, cd) {
        Some(p) => p,
        None => return Ok(None),
    };

    let VPrev = PrevPt - PartPos;
    let VCurr = CurrPt - PartPos;
    if VPrev.length() < 1e-6 || VCurr.length() < 1e-6 {
        return Ok(None);
    }
    let VPrev = VPrev.normalize();
    let VCurr = VCurr.normalize();

    let CosA = VPrev.dot(VCurr).clamp(-1.0, 1.0);
    let SinA = VPrev.cross(VCurr).dot(PlaneNormal);
    let angle = SinA.atan2(CosA);

    let RotKey = match axis.as_str() {
        "X" => "RX",
        "Y" => "RY",
        _ => "RZ",
    };
    let mut result = None;
    for cmd in &mut s.commands {
        if !IsEditableObject(cmd) {
            continue;
        }
        if cmd.get("Id").and_then(|v| v.as_str()) != Some(sel.as_str()) {
            continue;
        }
        let cur: f32 = cmd
            .get("CFrame")
            .and_then(|cf| cf.get(RotKey))
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0) as f32;
        let NewR = cur + angle;
        let cf = cmd.get("CFrame").cloned().unwrap_or_else(|| {
            let pos = cmd.get("Position").cloned().unwrap_or(serde_json::json!({}));
            serde_json::json!({ "X": pos["X"], "Y": pos["Y"], "Z": pos["Z"], "RX": 0, "RY": 0, "RZ": 0 })
        });
        let mut NewCf = cf;
        NewCf[RotKey] = serde_json::json!(NewR);
        let rx = if RotKey == "RX" {
            NewR
        } else {
            NewCf.get("RX").and_then(|v| v.as_f64()).unwrap_or(0.0) as f32
        };
        let ry = if RotKey == "RY" {
            NewR
        } else {
            NewCf.get("RY").and_then(|v| v.as_f64()).unwrap_or(0.0) as f32
        };
        let rz = if RotKey == "RZ" {
            NewR
        } else {
            NewCf.get("RZ").and_then(|v| v.as_f64()).unwrap_or(0.0) as f32
        };
        cmd["CFrame"] = NewCf;
        result = Some([rx, ry, rz]);
        break;
    }
    let mut physics = std::mem::take(&mut s.physics);
    let profile = s.profile.clone();
    physics.Reconcile(&s.commands, &profile);
    s.physics = physics;
    s.dirty = true;
    Ok(result)
}

#[tauri::command]
pub fn renderer_scale_drag(
    axis: String,
    prev_x: f32,
    prev_y: f32,
    curr_x: f32,
    curr_y: f32,
    width: f32,
    height: f32,
    renderer: State<'_, RendererState>,
) -> Result<Option<[f32; 3]>, String> {
    let r = renderer.lock().map_err(|e| e.to_string())?;
    let mut s = r.state.lock().map_err(|e| e.to_string())?;
    s.last_edit_interaction = std::time::Instant::now();

    let sel = match s.selected.clone() {
        Some(id) => id,
        None => return Ok(None),
    };

    if !s.drag_undo_pushed {
        let mut u = r.undo.lock().map_err(|e| e.to_string())?;
        PushUndo(&s, &mut u);
        s.drag_undo_pushed = true;
    }

    let AxisDir = match axis.as_str() {
        "X" => glam::Vec3::X,
        "Y" => glam::Vec3::Y,
        "Z" => glam::Vec3::Z,
        _ => return Ok(None),
    };

    let PartPos = {
        let mut found = None;
        for cmd in &s.commands {
            if !IsEditableObject(cmd) {
                continue;
            }
            if cmd.get("Id").and_then(|v| v.as_str()) != Some(sel.as_str()) {
                continue;
            }
            let f = |k: &str, ff: &str| -> f32 {
                cmd.get(k)
                    .and_then(|o| o.get(ff))
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.0) as f32
            };
            found = Some(glam::Vec3::new(
                f("Position", "X"),
                f("Position", "Y"),
                f("Position", "Z"),
            ));
            break;
        }
        match found {
            Some(p) => p,
            None => return Ok(None),
        }
    };

    let ToNdc =
        |sx: f32, sy: f32| -> (f32, f32) { ((sx / width) * 2.0 - 1.0, 1.0 - (sy / height) * 2.0) };
    let (pnx, pny) = ToNdc(prev_x, prev_y);
    let (cnx, cny) = ToNdc(curr_x, curr_y);
    let (po, pd) = s.camera.GetRay(pnx, pny);
    let (co, cd) = s.camera.GetRay(cnx, cny);

    let TPrev = ClosestTOnLine(po, pd, PartPos, AxisDir);
    let TCurr = ClosestTOnLine(co, cd, PartPos, AxisDir);
    let delta = TCurr - TPrev;

    let SizeKey = axis.as_str();
    let mut result = None;
    for cmd in &mut s.commands {
        if !IsEditableObject(cmd) {
            continue;
        }
        if cmd.get("Id").and_then(|v| v.as_str()) != Some(sel.as_str()) {
            continue;
        }
        if let Some(size_obj) = cmd.get_mut("Size") {
            let cur: f32 = size_obj
                .get(SizeKey)
                .and_then(|v| v.as_f64())
                .unwrap_or(1.0) as f32;
            let NewS = (cur + delta * 2.0).max(0.05);
            size_obj[SizeKey] = serde_json::json!(NewS);
            let sx = size_obj.get("X").and_then(|v| v.as_f64()).unwrap_or(1.0) as f32;
            let sy = size_obj.get("Y").and_then(|v| v.as_f64()).unwrap_or(1.0) as f32;
            let sz = size_obj.get("Z").and_then(|v| v.as_f64()).unwrap_or(1.0) as f32;
            result = Some([sx, sy, sz]);
        }
        break;
    }
    let mut physics = std::mem::take(&mut s.physics);
    let profile = s.profile.clone();
    physics.Reconcile(&s.commands, &profile);
    s.physics = physics;
    s.dirty = true;
    Ok(result)
}

#[tauri::command]
pub fn renderer_undo(renderer: State<'_, RendererState>) -> Result<(), String> {
    let r = renderer.lock().map_err(|e| e.to_string())?;
    let mut s = r.state.lock().map_err(|e| e.to_string())?;
    let mut u = r.undo.lock().map_err(|e| e.to_string())?;
    if let Some(prev) = u.undo_stack.pop() {
        u.redo_stack.push(s.commands.clone());
        s.commands = prev;
        s.selected = None;
        s.selected_face = None;
        let mut physics = std::mem::take(&mut s.physics);
        let profile = s.profile.clone();
        physics.Reconcile(&s.commands, &profile);
        s.physics = physics;
        s.dirty = true;
    }
    Ok(())
}

#[tauri::command]
pub fn renderer_redo(renderer: State<'_, RendererState>) -> Result<(), String> {
    let r = renderer.lock().map_err(|e| e.to_string())?;
    let mut s = r.state.lock().map_err(|e| e.to_string())?;
    let mut u = r.undo.lock().map_err(|e| e.to_string())?;
    if let Some(next) = u.redo_stack.pop() {
        u.undo_stack.push(s.commands.clone());
        s.commands = next;
        s.selected = None;
        s.selected_face = None;
        let mut physics = std::mem::take(&mut s.physics);
        let profile = s.profile.clone();
        physics.Reconcile(&s.commands, &profile);
        s.physics = physics;
        s.dirty = true;
    }
    Ok(())
}

#[tauri::command]
pub fn renderer_delete_part(id: String, renderer: State<'_, RendererState>) -> Result<(), String> {
    let r = renderer.lock().map_err(|e| e.to_string())?;
    let mut s = r.state.lock().map_err(|e| e.to_string())?;
    {
        let mut u = r.undo.lock().map_err(|e| e.to_string())?;
        PushUndo(&s, &mut u);
    }
    s.commands.retain(|cmd| {
        !(IsEditableObject(cmd) && cmd.get("Id").and_then(|v| v.as_str()) == Some(id.as_str()))
    });
    if s.selected.as_deref() == Some(id.as_str()) {
        s.selected = None;
        s.selected_face = None;
    }
    let mut physics = std::mem::take(&mut s.physics);
    let profile = s.profile.clone();
    physics.Reconcile(&s.commands, &profile);
    s.physics = physics;
    s.dirty = true;
    Ok(())
}

/// Hand a user-owned ("Kept") part back to the script: it eases from where the
/// user left it onto the script's current path so it resumes its previous
/// movement, then ownership is released. No-op if the part is not kept.
#[tauri::command]
pub fn renderer_return_to_script(
    id: String,
    app: AppHandle,
    renderer: State<'_, RendererState>,
) -> Result<(), String> {
    use tauri::Manager;
    let kept = {
        let r = renderer.lock().map_err(|e| e.to_string())?;
        let mut s = r.state.lock().map_err(|e| e.to_string())?;
        if let Some(owned) = s.ownership.get_mut(&id) {
            owned.resume(std::time::Instant::now());
            s.dirty = true;
        }
        crate::renderer::ownership::KeptIds(&s.ownership)
    };
    let _ = app.emit_all("vp-ownership", kept);
    Ok(())
}

#[tauri::command]
pub fn renderer_subdivide_selected(renderer: State<'_, RendererState>) -> Result<(), String> {
    let r = renderer.lock().map_err(|e| e.to_string())?;
    let mut s = r.state.lock().map_err(|e| e.to_string())?;
    let SelectedId = s
        .selected
        .clone()
        .ok_or_else(|| "No selected mesh".to_string())?;
    {
        let mut u = r.undo.lock().map_err(|e| e.to_string())?;
        PushUndo(&s, &mut u);
    }
    let mut Found = false;
    for Command in &mut s.commands {
        if Command.get("Id").and_then(|Value| Value.as_str()) != Some(SelectedId.as_str()) {
            continue;
        }
        SubdivideMeshCommand(Command)?;
        Found = true;
        break;
    }
    if !Found {
        return Err("Selected mesh not found".to_string());
    }
    s.selected_face = None;
    s.dirty = true;
    Ok(())
}

#[tauri::command]
pub fn renderer_extrude_selected_face(
    distance: f32,
    renderer: State<'_, RendererState>,
) -> Result<serde_json::Value, String> {
    let r = renderer.lock().map_err(|e| e.to_string())?;
    let mut s = r.state.lock().map_err(|e| e.to_string())?;
    let Face = s
        .selected_face
        .clone()
        .ok_or_else(|| "No selected face".to_string())?;
    {
        let mut u = r.undo.lock().map_err(|e| e.to_string())?;
        PushUndo(&s, &mut u);
    }
    let mut NewFaceIndex = None;
    for Command in &mut s.commands {
        if Command.get("Id").and_then(|Value| Value.as_str()) != Some(Face.part_id.as_str()) {
            continue;
        }
        NewFaceIndex = Some(ExtrudeMeshFaceCommand(Command, Face.face_index, distance)?);
        break;
    }
    let FaceIndex = NewFaceIndex.ok_or_else(|| "Selected face mesh not found".to_string())?;
    s.selected = Some(Face.part_id.clone());
    s.selected_face = Some(SelectedFace {
        part_id: Face.part_id.clone(),
        face_index: FaceIndex,
    });
    s.dirty = true;
    Ok(serde_json::json!({
        "PartId": Face.part_id,
        "FaceIndex": FaceIndex,
    }))
}

#[tauri::command]
pub fn renderer_delete_selected_face(renderer: State<'_, RendererState>) -> Result<(), String> {
    let r = renderer.lock().map_err(|e| e.to_string())?;
    let mut s = r.state.lock().map_err(|e| e.to_string())?;
    let Face = s
        .selected_face
        .clone()
        .ok_or_else(|| "No selected face".to_string())?;
    {
        let mut u = r.undo.lock().map_err(|e| e.to_string())?;
        PushUndo(&s, &mut u);
    }
    let mut Found = false;
    for Command in &mut s.commands {
        if Command.get("Id").and_then(|Value| Value.as_str()) != Some(Face.part_id.as_str()) {
            continue;
        }
        DeleteMeshFaceCommand(Command, Face.face_index)?;
        Found = true;
        break;
    }
    if !Found {
        return Err("Selected face mesh not found".to_string());
    }
    s.selected = Some(Face.part_id);
    s.selected_face = None;
    s.dirty = true;
    Ok(())
}

#[tauri::command]
pub fn renderer_frame_selected(renderer: State<'_, RendererState>) -> Result<(), String> {
    let r = renderer.lock().map_err(|e| e.to_string())?;
    let mut s = r.state.lock().map_err(|e| e.to_string())?;

    let TargetPos: Option<glam::Vec3>;
    let TargetSize: f32;

    if let Some(sel_id) = s.selected.clone() {
        let mut FoundPos = None;
        let mut FoundSize = 4.0_f32;
        for cmd in &s.commands {
            if !IsEditableObject(cmd) {
                continue;
            }
            if cmd.get("Id").and_then(|v| v.as_str()) != Some(sel_id.as_str()) {
                continue;
            }
            let gf = |k: &str, f: &str, d: f64| -> f32 {
                cmd.get(k)
                    .and_then(|o| o.get(f))
                    .and_then(|v| v.as_f64())
                    .unwrap_or(d) as f32
            };
            let px = gf("Position", "X", 0.0);
            let py = gf("Position", "Y", 0.0);
            let pz = gf("Position", "Z", 0.0);
            let sx = ObjectExtent(cmd, "X", 2.0);
            let sy = ObjectExtent(cmd, "Y", 2.0);
            let sz = ObjectExtent(cmd, "Z", 2.0);
            FoundPos = Some(glam::Vec3::new(px, py, pz));
            FoundSize = sx.max(sy).max(sz);
            break;
        }
        TargetPos = FoundPos;
        TargetSize = FoundSize;
    } else {
        let mut min = glam::Vec3::splat(f32::MAX);
        let mut max = glam::Vec3::splat(f32::MIN);
        let mut any = false;
        for cmd in &s.commands {
            if !IsEditableObject(cmd) {
                continue;
            }
            let gf = |k: &str, f: &str, d: f64| -> f32 {
                cmd.get(k)
                    .and_then(|o| o.get(f))
                    .and_then(|v| v.as_f64())
                    .unwrap_or(d) as f32
            };
            let p = glam::Vec3::new(
                gf("Position", "X", 0.0),
                gf("Position", "Y", 0.0),
                gf("Position", "Z", 0.0),
            );
            let h = glam::Vec3::new(
                ObjectExtent(cmd, "X", 2.0),
                ObjectExtent(cmd, "Y", 2.0),
                ObjectExtent(cmd, "Z", 2.0),
            ) * 0.5;
            min = min.min(p - h);
            max = max.max(p + h);
            any = true;
        }
        if any {
            let center = (min + max) * 0.5;
            TargetPos = Some(center);
            TargetSize = (max - min).length();
        } else {
            return Ok(());
        }
    }

    if let Some(pos) = TargetPos {
        let dist = TargetSize * 2.5 + 5.0;
        let eye = pos + glam::Vec3::new(dist * 0.6, dist * 0.5, dist * 0.6);
        s.camera.SetFromEyeTarget(eye.to_array(), pos.to_array());
        s.dirty = true;
    }
    Ok(())
}

#[tauri::command]
pub fn renderer_end_drag(renderer: State<'_, RendererState>) -> Result<(), String> {
    let r = renderer.lock().map_err(|e| e.to_string())?;
    let mut s = r.state.lock().map_err(|e| e.to_string())?;
    s.last_edit_interaction = std::time::Instant::now();
    s.drag_undo_pushed = false;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ExtrudesMeshFace() {
        let mut Command = serde_json::json!({
            "Cmd": "AddMesh",
            "Id": "mesh",
            "Name": "Mesh",
            "Position": {"X": 0.0, "Y": 0.0, "Z": 0.0},
            "Size": {"X": 1.0, "Y": 1.0, "Z": 1.0},
            "Bounds": {"X": 1.0, "Y": 1.0, "Z": 0.001},
            "Vertices": [
                {"X": 0.0, "Y": 0.0, "Z": 0.0},
                {"X": 1.0, "Y": 0.0, "Z": 0.0},
                {"X": 0.0, "Y": 1.0, "Z": 0.0}
            ],
            "Indices": [0, 1, 2]
        });
        let FaceIndex = ExtrudeMeshFaceCommand(&mut Command, 0, 0.5).expect("face should extrude");
        assert_eq!(FaceIndex, 1);
        assert_eq!(
            Command
                .get("Vertices")
                .and_then(|Value| Value.as_array())
                .map(Vec::len),
            Some(6)
        );
        assert_eq!(
            Command
                .get("Indices")
                .and_then(|Value| Value.as_array())
                .map(Vec::len),
            Some(24)
        );
    }

    #[test]
    fn DeletesMeshFace() {
        let mut Command = serde_json::json!({
            "Cmd": "AddMesh",
            "Id": "mesh",
            "Name": "Mesh",
            "Position": {"X": 0.0, "Y": 0.0, "Z": 0.0},
            "Size": {"X": 1.0, "Y": 1.0, "Z": 1.0},
            "Bounds": {"X": 1.0, "Y": 1.0, "Z": 0.001},
            "Vertices": [
                {"X": 0.0, "Y": 0.0, "Z": 0.0},
                {"X": 1.0, "Y": 0.0, "Z": 0.0},
                {"X": 1.0, "Y": 1.0, "Z": 0.0},
                {"X": 0.0, "Y": 1.0, "Z": 0.0}
            ],
            "Indices": [0, 1, 2, 0, 2, 3]
        });
        DeleteMeshFaceCommand(&mut Command, 0).expect("face should delete");
        assert_eq!(
            Command
                .get("Vertices")
                .and_then(|Value| Value.as_array())
                .map(Vec::len),
            Some(3)
        );
        assert_eq!(
            Command
                .get("Indices")
                .and_then(|Value| Value.as_array())
                .map(Vec::len),
            Some(3)
        );
    }
}
