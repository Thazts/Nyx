use bytemuck::{Pod, Zeroable};
use wgpu::util::DeviceExt;

#[repr(C)]
#[derive(Copy, Clone, Pod, Zeroable)]
pub(crate) struct Vertex {
    pub position: [f32; 3],
    pub normal: [f32; 3],
}

#[repr(C)]
#[derive(Copy, Clone, Pod, Zeroable)]
pub(crate) struct Instance {
    pub position: [f32; 3],
    pub size: [f32; 3],
    pub color: [f32; 3],
    pub rotation: [f32; 4],
}
pub(crate) struct MeshDraw {
    pub vertex_buf: wgpu::Buffer,
    pub index_buf: wgpu::Buffer,
    pub index_count: u32,
    pub instance_buf: wgpu::Buffer,
}
pub(crate) fn ReadInstance(
    Command: &serde_json::Value,
    DefaultSize: [f32; 3],
    DefaultColor: [f32; 3],
) -> Instance {
    let CFrame = Command.get("CFrame");
    Instance {
        position: ReadVec3(Command.get("Position"), [0.0, 0.0, 0.0]),
        size: ReadVec3(Command.get("Size"), DefaultSize),
        color: ReadColor(Command.get("Color"), DefaultColor),
        rotation: EulerToQuat(
            ReadF32(CFrame, "RX", 0.0),
            ReadF32(CFrame, "RY", 0.0),
            ReadF32(CFrame, "RZ", 0.0),
        ),
    }
}

pub(crate) fn EulerToQuat(rx: f32, ry: f32, rz: f32) -> [f32; 4] {
    let (cx, sx) = ((rx * 0.5).cos(), (rx * 0.5).sin());
    let (cy, sy) = ((ry * 0.5).cos(), (ry * 0.5).sin());
    let (cz, sz) = ((rz * 0.5).cos(), (rz * 0.5).sin());
    let w = cy * cx * cz + sy * sx * sz;
    let x = cy * sx * cz + sy * cx * sz;
    let y = sy * cx * cz - cy * sx * sz;
    let z = cy * cx * sz - sy * sx * cz;
    let len = (x * x + y * y + z * z + w * w).sqrt();
    if len < 1e-6 {
        return [0.0, 0.0, 0.0, 1.0];
    }
    [x / len, y / len, z / len, w / len]
}

pub(crate) fn ReadF32(Value: Option<&serde_json::Value>, Key: &str, Fallback: f32) -> f32 {
    Value
        .and_then(|Object| Object.get(Key))
        .and_then(|Value| Value.as_f64())
        .map(|Value| Value as f32)
        .unwrap_or(Fallback)
}

pub(crate) fn ReadVec3(Value: Option<&serde_json::Value>, Fallback: [f32; 3]) -> [f32; 3] {
    [
        ReadF32(Value, "X", Fallback[0]),
        ReadF32(Value, "Y", Fallback[1]),
        ReadF32(Value, "Z", Fallback[2]),
    ]
}
pub(crate) fn ReadColor(Value: Option<&serde_json::Value>, Fallback: [f32; 3]) -> [f32; 3] {
    [
        ReadF32(Value, "R", Fallback[0]),
        ReadF32(Value, "G", Fallback[1]),
        ReadF32(Value, "B", Fallback[2]),
    ]
}

pub(crate) fn ReadPoint(Value: &serde_json::Value) -> Option<[f32; 3]> {
    if let Some(Array) = Value.as_array() {
        if Array.len() >= 3 {
            return Some([
                Array[0].as_f64()? as f32,
                Array[1].as_f64()? as f32,
                Array[2].as_f64()? as f32,
            ]);
        }
    }
    Some([
        Value.get("X")?.as_f64()? as f32,
        Value.get("Y")?.as_f64()? as f32,
        Value.get("Z")?.as_f64()? as f32,
    ])
}

pub(crate) fn QuatRotate(Value: [f32; 3], Quat: [f32; 4]) -> [f32; 3] {
    let Q = glam::Quat::from_xyzw(Quat[0], Quat[1], Quat[2], Quat[3]);
    let V = Q * glam::Vec3::new(Value[0], Value[1], Value[2]);
    [V.x, V.y, V.z]
}

pub(crate) fn TransformPoint(
    Point: [f32; 3],
    Position: [f32; 3],
    Size: [f32; 3],
    Quat: [f32; 4],
) -> [f32; 3] {
    let Rotated = QuatRotate(
        [Point[0] * Size[0], Point[1] * Size[1], Point[2] * Size[2]],
        Quat,
    );
    [
        Rotated[0] + Position[0],
        Rotated[1] + Position[1],
        Rotated[2] + Position[2],
    ]
}

pub(crate) fn AddFace(Vertices: &mut Vec<Vertex>, Indices: &mut Vec<u32>, Points: &[[f32; 3]]) {
    if Points.len() < 3 {
        return;
    }
    let A = glam::Vec3::new(Points[0][0], Points[0][1], Points[0][2]);
    let B = glam::Vec3::new(Points[1][0], Points[1][1], Points[1][2]);
    let C = glam::Vec3::new(Points[2][0], Points[2][1], Points[2][2]);
    let Normal = (B - A).cross(C - A).normalize_or_zero();
    let Normal = if Normal.length_squared() <= 0.000001 {
        [0.0, 1.0, 0.0]
    } else {
        [Normal.x, Normal.y, Normal.z]
    };
    let Base = Vertices.len() as u32;
    for Point in Points {
        Vertices.push(Vertex {
            position: *Point,
            normal: Normal,
        });
    }
    for I in 1..(Points.len() - 1) {
        Indices.extend_from_slice(&[Base, Base + I as u32, Base + I as u32 + 1]);
    }
}

pub(crate) fn CubeMesh() -> (Vec<Vertex>, Vec<u32>) {
    let faces: &[([f32; 3], [[f32; 3]; 4])] = &[
        (
            [0., 0., 1.],
            [
                [-0.5, -0.5, 0.5],
                [0.5, -0.5, 0.5],
                [0.5, 0.5, 0.5],
                [-0.5, 0.5, 0.5],
            ],
        ),
        (
            [0., 0., -1.],
            [
                [0.5, -0.5, -0.5],
                [-0.5, -0.5, -0.5],
                [-0.5, 0.5, -0.5],
                [0.5, 0.5, -0.5],
            ],
        ),
        (
            [-1., 0., 0.],
            [
                [-0.5, -0.5, -0.5],
                [-0.5, -0.5, 0.5],
                [-0.5, 0.5, 0.5],
                [-0.5, 0.5, -0.5],
            ],
        ),
        (
            [1., 0., 0.],
            [
                [0.5, -0.5, 0.5],
                [0.5, -0.5, -0.5],
                [0.5, 0.5, -0.5],
                [0.5, 0.5, 0.5],
            ],
        ),
        (
            [0., 1., 0.],
            [
                [-0.5, 0.5, 0.5],
                [0.5, 0.5, 0.5],
                [0.5, 0.5, -0.5],
                [-0.5, 0.5, -0.5],
            ],
        ),
        (
            [0., -1., 0.],
            [
                [-0.5, -0.5, -0.5],
                [0.5, -0.5, -0.5],
                [0.5, -0.5, 0.5],
                [-0.5, -0.5, 0.5],
            ],
        ),
    ];

    let mut verts: Vec<Vertex> = Vec::with_capacity(24);
    let mut idx: Vec<u32> = Vec::with_capacity(36);

    for (normal, quad) in faces {
        let base = verts.len() as u32;
        for pos in quad {
            verts.push(Vertex {
                position: *pos,
                normal: *normal,
            });
        }
        idx.extend_from_slice(&[base, base + 1, base + 2, base, base + 2, base + 3]);
    }

    (verts, idx)
}

pub(crate) fn SphereMesh() -> (Vec<Vertex>, Vec<u32>) {
    let Segments = 32usize;
    let Rings = 16usize;
    let mut Vertices = Vec::with_capacity((Segments + 1) * (Rings + 1));
    let mut Indices = Vec::with_capacity(Segments * Rings * 6);
    for Ring in 0..=Rings {
        let V = Ring as f32 / Rings as f32;
        let Phi = V * std::f32::consts::PI;
        let Y = Phi.cos() * 0.5;
        let R = Phi.sin() * 0.5;
        for Segment in 0..=Segments {
            let U = Segment as f32 / Segments as f32;
            let Theta = U * std::f32::consts::TAU;
            let X = Theta.cos() * R;
            let Z = Theta.sin() * R;
            let Normal = glam::Vec3::new(X, Y, Z).normalize_or_zero();
            Vertices.push(Vertex {
                position: [X, Y, Z],
                normal: [Normal.x, Normal.y, Normal.z],
            });
        }
    }
    for Ring in 0..Rings {
        for Segment in 0..Segments {
            let A = (Ring * (Segments + 1) + Segment) as u32;
            let B = A + Segments as u32 + 1;
            Indices.extend_from_slice(&[A, B, A + 1, A + 1, B, B + 1]);
        }
    }
    (Vertices, Indices)
}

pub(crate) fn CylinderMesh() -> (Vec<Vertex>, Vec<u32>) {
    let Segments = 32usize;
    let mut Vertices = Vec::new();
    let mut Indices = Vec::new();
    for Segment in 0..Segments {
        let A0 = Segment as f32 / Segments as f32 * std::f32::consts::TAU;
        let A1 = (Segment + 1) as f32 / Segments as f32 * std::f32::consts::TAU;
        let P0 = [A0.cos() * 0.5, -0.5, A0.sin() * 0.5];
        let P1 = [A1.cos() * 0.5, -0.5, A1.sin() * 0.5];
        let P2 = [A1.cos() * 0.5, 0.5, A1.sin() * 0.5];
        let P3 = [A0.cos() * 0.5, 0.5, A0.sin() * 0.5];
        AddFace(&mut Vertices, &mut Indices, &[P0, P1, P2, P3]);
        AddFace(&mut Vertices, &mut Indices, &[[0.0, 0.5, 0.0], P3, P2]);
        AddFace(&mut Vertices, &mut Indices, &[[0.0, -0.5, 0.0], P1, P0]);
    }
    (Vertices, Indices)
}

pub(crate) fn ConeMesh() -> (Vec<Vertex>, Vec<u32>) {
    let Segments = 32usize;
    let mut Vertices = Vec::new();
    let mut Indices = Vec::new();
    for Segment in 0..Segments {
        let A0 = Segment as f32 / Segments as f32 * std::f32::consts::TAU;
        let A1 = (Segment + 1) as f32 / Segments as f32 * std::f32::consts::TAU;
        let P0 = [A0.cos() * 0.5, -0.5, A0.sin() * 0.5];
        let P1 = [A1.cos() * 0.5, -0.5, A1.sin() * 0.5];
        AddFace(&mut Vertices, &mut Indices, &[P0, P1, [0.0, 0.5, 0.0]]);
        AddFace(&mut Vertices, &mut Indices, &[[0.0, -0.5, 0.0], P1, P0]);
    }
    (Vertices, Indices)
}

pub(crate) fn WedgeMesh() -> (Vec<Vertex>, Vec<u32>) {
    let mut Vertices = Vec::new();
    let mut Indices = Vec::new();
    let P = [
        [-0.5, -0.5, -0.5],
        [0.5, -0.5, -0.5],
        [0.5, -0.5, 0.5],
        [-0.5, -0.5, 0.5],
        [-0.5, 0.5, -0.5],
        [0.5, 0.5, -0.5],
    ];
    AddFace(&mut Vertices, &mut Indices, &[P[0], P[1], P[2], P[3]]);
    AddFace(&mut Vertices, &mut Indices, &[P[0], P[4], P[5], P[1]]);
    AddFace(&mut Vertices, &mut Indices, &[P[0], P[3], P[4]]);
    AddFace(&mut Vertices, &mut Indices, &[P[1], P[5], P[2]]);
    AddFace(&mut Vertices, &mut Indices, &[P[3], P[2], P[5], P[4]]);
    (Vertices, Indices)
}

pub(crate) fn TorusMesh() -> (Vec<Vertex>, Vec<u32>) {
    let MajorSegments = 32usize;
    let MinorSegments = 12usize;
    let Major = 0.34_f32;
    let Minor = 0.16_f32;
    let mut Vertices = Vec::new();
    let mut Indices = Vec::new();
    for I in 0..=MajorSegments {
        let U = I as f32 / MajorSegments as f32 * std::f32::consts::TAU;
        let Center = glam::Vec3::new(U.cos() * Major, 0.0, U.sin() * Major);
        for J in 0..=MinorSegments {
            let V = J as f32 / MinorSegments as f32 * std::f32::consts::TAU;
            let Normal = glam::Vec3::new(U.cos() * V.cos(), V.sin(), U.sin() * V.cos());
            let Pos = Center + Normal * Minor;
            Vertices.push(Vertex {
                position: [Pos.x, Pos.y, Pos.z],
                normal: [Normal.x, Normal.y, Normal.z],
            });
        }
    }
    for I in 0..MajorSegments {
        for J in 0..MinorSegments {
            let A = (I * (MinorSegments + 1) + J) as u32;
            let B = A + MinorSegments as u32 + 1;
            Indices.extend_from_slice(&[A, B, A + 1, A + 1, B, B + 1]);
        }
    }
    (Vertices, Indices)
}

pub(crate) const SHAPE_COUNT: usize = 6;

pub(crate) fn ShapeIndex(Shape: &str) -> usize {
    match Shape {
        "Sphere" | "Ball" => 1,
        "Cylinder" => 2,
        "Cone" => 3,
        "Wedge" | "WedgePart" => 4,
        "Torus" => 5,
        _ => 0,
    }
}

pub(crate) fn UnitShapeMesh(Index: usize) -> (Vec<Vertex>, Vec<u32>) {
    match Index {
        1 => SphereMesh(),
        2 => CylinderMesh(),
        3 => ConeMesh(),
        4 => WedgeMesh(),
        5 => TorusMesh(),
        _ => CubeMesh(),
    }
}

pub(crate) fn BuildMeshGeometry(Command: &serde_json::Value) -> Option<(Vec<Vertex>, Vec<u32>)> {
    let SourceVertices = Command.get("Vertices")?.as_array()?;
    let mut Points = Vec::with_capacity(SourceVertices.len());
    for SourceVertex in SourceVertices {
        Points.push(ReadPoint(SourceVertex)?);
    }
    if Points.len() < 3 {
        return None;
    }

    let mut Indices = Vec::new();
    if let Some(SourceIndices) = Command.get("Indices").and_then(|Value| Value.as_array()) {
        for SourceIndex in SourceIndices {
            let Index = SourceIndex.as_u64()? as usize;
            if Index >= Points.len() {
                return None;
            }
            Indices.push(Index as u32);
        }
    } else {
        for Index in 0..Points.len() {
            Indices.push(Index as u32);
        }
    }
    if Indices.len() < 3 {
        return None;
    }
    Indices.truncate(Indices.len() / 3 * 3);

    let mut Normals = vec![glam::Vec3::ZERO; Points.len()];
    if let Some(SourceNormals) = Command.get("Normals").and_then(|Value| Value.as_array()) {
        for (Index, SourceNormal) in SourceNormals.iter().enumerate().take(Points.len()) {
            if let Some(Normal) = ReadPoint(SourceNormal) {
                Normals[Index] = glam::Vec3::new(Normal[0], Normal[1], Normal[2]);
            }
        }
    }
    for Triangle in Indices.chunks(3) {
        let A = Points[Triangle[0] as usize];
        let B = Points[Triangle[1] as usize];
        let C = Points[Triangle[2] as usize];
        let Normal = (glam::Vec3::new(B[0], B[1], B[2]) - glam::Vec3::new(A[0], A[1], A[2]))
            .cross(glam::Vec3::new(C[0], C[1], C[2]) - glam::Vec3::new(A[0], A[1], A[2]))
            .normalize_or_zero();
        for Index in Triangle {
            if Normals[*Index as usize].length_squared() <= 0.000001 {
                Normals[*Index as usize] += Normal;
            }
        }
    }

    let mut Vertices = Vec::with_capacity(Points.len());
    for (Index, Point) in Points.iter().enumerate() {
        let Normal = if Normals[Index].length_squared() <= 0.000001 {
            [0.0, 1.0, 0.0]
        } else {
            let N = Normals[Index].normalize();
            [N.x, N.y, N.z]
        };
        Vertices.push(Vertex {
            position: *Point,
            normal: Normal,
        });
    }

    Some((Vertices, Indices))
}

pub(crate) fn MakeMeshDraw(
    device: &wgpu::Device,
    Vertices: &[Vertex],
    Indices: &[u32],
) -> MeshDraw {
    let VertexBuf = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
        label: Some("mesh.vtx"),
        contents: bytemuck::cast_slice(Vertices),
        usage: wgpu::BufferUsages::VERTEX,
    });
    let IndexBuf = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
        label: Some("mesh.idx"),
        contents: bytemuck::cast_slice(Indices),
        usage: wgpu::BufferUsages::INDEX,
    });
    let InstanceBuf = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("mesh.instance"),
        size: std::mem::size_of::<Instance>() as u64,
        usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    });
    MeshDraw {
        vertex_buf: VertexBuf,
        index_buf: IndexBuf,
        index_count: Indices.len() as u32,
        instance_buf: InstanceBuf,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ReadInstanceReadsRgbColorKeys() {
        let cmd = serde_json::json!({
            "Cmd": "AddPart",
            "Position": { "X": 1.0, "Y": 2.0, "Z": 3.0 },
            "Size": { "X": 4.0, "Y": 5.0, "Z": 6.0 },
            "Color": { "R": 0.25, "G": 0.5, "B": 0.75 },
        });
        let inst = ReadInstance(&cmd, [1.0, 1.0, 1.0], [0.64, 0.64, 0.64]);
        assert_eq!(inst.position, [1.0, 2.0, 3.0]);
        assert_eq!(inst.size, [4.0, 5.0, 6.0]);
        assert_eq!(inst.color, [0.25, 0.5, 0.75]);
    }

    #[test]
    fn ReadInstanceFallsBackWhenColorMissing() {
        let cmd = serde_json::json!({ "Cmd": "AddPart" });
        let inst = ReadInstance(&cmd, [4.0, 1.2, 2.0], [0.64, 0.64, 0.64]);
        assert_eq!(inst.size, [4.0, 1.2, 2.0]);
        assert_eq!(inst.color, [0.64, 0.64, 0.64]);
        assert_eq!(inst.rotation, [0.0, 0.0, 0.0, 1.0]);
    }
}
