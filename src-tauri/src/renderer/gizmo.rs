use bytemuck::{Pod, Zeroable};

use super::mesh::{EulerToQuat, ReadF32, ReadPoint, ReadVec3, TransformPoint};
use super::SelectedFace;

#[repr(C)]
#[derive(Copy, Clone, Pod, Zeroable)]
pub(crate) struct GizmoVertex {
    pub position: [f32; 3],
    pub color: [f32; 3],
}

#[repr(C)]
#[derive(Copy, Clone, Pod, Zeroable)]
pub(crate) struct GridVertex {
    pub position: [f32; 3],
}

pub(crate) fn GridQuad() -> (Vec<GridVertex>, Vec<u16>) {
    let size = 2000.0_f32;
    let verts = vec![
        GridVertex {
            position: [-size, 0.0, -size],
        },
        GridVertex {
            position: [size, 0.0, -size],
        },
        GridVertex {
            position: [size, 0.0, size],
        },
        GridVertex {
            position: [-size, 0.0, size],
        },
    ];
    let idx = vec![0u16, 1, 2, 0, 2, 3];
    (verts, idx)
}

pub(crate) fn GizmoMetrics(sx: f32, sy: f32, sz: f32) -> (f32, f32, f32, f32) {
    let MaxSize = sx.max(sy).max(sz).max(0.001);
    let len = (MaxSize * 0.9).clamp(6.0, 600.0);
    let handle = (len * 0.06).clamp(0.35, 24.0);
    let arrow = (len * 0.07).clamp(0.4, 28.0);
    let radius = (MaxSize * 0.5 + handle).clamp(1.2, 1200.0);
    (len, handle, arrow, radius)
}

pub(crate) fn AppendSelectedFaceOutline(
    Verts: &mut Vec<GizmoVertex>,
    Face: &SelectedFace,
    Commands: &[serde_json::Value],
) {
    let Some(Command) = Commands.iter().find(|Command| {
        Command.get("Cmd").and_then(|Value| Value.as_str()) == Some("AddMesh")
            && Command.get("Id").and_then(|Value| Value.as_str()) == Some(Face.part_id.as_str())
    }) else {
        return;
    };
    let Some(SourceVertices) = Command.get("Vertices").and_then(|Value| Value.as_array()) else {
        return;
    };
    let Some(SourceIndices) = Command.get("Indices").and_then(|Value| Value.as_array()) else {
        return;
    };
    let TriangleOffset = Face.face_index * 3;
    if TriangleOffset + 2 >= SourceIndices.len() {
        return;
    }
    let Position = ReadVec3(Command.get("Position"), [0.0, 0.0, 0.0]);
    let Size = ReadVec3(Command.get("Size"), [1.0, 1.0, 1.0]);
    let CFrame = Command.get("CFrame");
    let Quat = EulerToQuat(
        ReadF32(CFrame, "RX", 0.0),
        ReadF32(CFrame, "RY", 0.0),
        ReadF32(CFrame, "RZ", 0.0),
    );
    let mut Points = Vec::with_capacity(3);
    for I in 0..3 {
        let Some(Index) = SourceIndices[TriangleOffset + I].as_u64() else {
            return;
        };
        let Some(Point) = SourceVertices.get(Index as usize).and_then(ReadPoint) else {
            return;
        };
        Points.push(TransformPoint(Point, Position, Size, Quat));
    }
    let Color = [1.0_f32, 0.74, 0.16];
    for (A, B) in [(0usize, 1usize), (1, 2), (2, 0)] {
        Verts.push(GizmoVertex {
            position: Points[A],
            color: Color,
        });
        Verts.push(GizmoVertex {
            position: Points[B],
            color: Color,
        });
    }
}

pub(crate) fn BuildGizmoVerts(
    id: &str,
    SelectedFace: Option<&super::SelectedFace>,
    commands: &[serde_json::Value],
    gizmo_mode: &str,
) -> Vec<GizmoVertex> {
    for cmd in commands {
        let Cmd = cmd.get("Cmd").and_then(|v| v.as_str());
        if Cmd != Some("AddPart") && Cmd != Some("AddMesh") {
            continue;
        }
        if cmd.get("Id").and_then(|v| v.as_str()) != Some(id) {
            continue;
        }

        let fp = |k: &str| -> f32 {
            cmd.get("Position")
                .and_then(|o| o.get(k))
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0) as f32
        };
        let fs = |k: &str, d: f64| -> f32 {
            cmd.get("Bounds")
                .or_else(|| cmd.get("Size"))
                .and_then(|o| o.get(k))
                .and_then(|v| v.as_f64())
                .unwrap_or(d) as f32
        };
        let px = fp("X");
        let py = fp("Y");
        let pz = fp("Z");
        let sx = fs("X", 2.0);
        let sy = fs("Y", 2.0);
        let sz = fs("Z", 2.0);
        let (axis_len, handle_size, arrow_size, rotate_radius) = GizmoMetrics(sx, sy, sz);

        let mut verts: Vec<GizmoVertex> = Vec::new();

        match gizmo_mode {
            "rotate" => {
                let radius = rotate_radius;
                let segs = 32usize;
                let RingData: [([f32; 3], u8); 3] = [
                    ([1.0, 0.15, 0.15], 0),
                    ([0.15, 1.0, 0.15], 1),
                    ([0.15, 0.15, 1.0], 2),
                ];
                for (color, axis) in &RingData {
                    for i in 0..segs {
                        let a0 = (i as f32) / (segs as f32) * std::f32::consts::TAU;
                        let a1 = ((i + 1) as f32) / (segs as f32) * std::f32::consts::TAU;
                        let (p0, p1) = match axis {
                            0 => (
                                [px, py + a0.cos() * radius, pz + a0.sin() * radius],
                                [px, py + a1.cos() * radius, pz + a1.sin() * radius],
                            ),
                            1 => (
                                [px + a0.cos() * radius, py, pz + a0.sin() * radius],
                                [px + a1.cos() * radius, py, pz + a1.sin() * radius],
                            ),
                            _ => (
                                [px + a0.cos() * radius, py + a0.sin() * radius, pz],
                                [px + a1.cos() * radius, py + a1.sin() * radius, pz],
                            ),
                        };
                        verts.push(GizmoVertex {
                            position: p0,
                            color: *color,
                        });
                        verts.push(GizmoVertex {
                            position: p1,
                            color: *color,
                        });
                    }
                }
            }
            "scale" => {
                let len = axis_len;
                let hs = handle_size;
                verts.push(GizmoVertex {
                    position: [px, py, pz],
                    color: [1.0, 0.15, 0.15],
                });
                verts.push(GizmoVertex {
                    position: [px + len, py, pz],
                    color: [1.0, 0.15, 0.15],
                });
                verts.push(GizmoVertex {
                    position: [px, py, pz],
                    color: [0.15, 1.0, 0.15],
                });
                verts.push(GizmoVertex {
                    position: [px, py + len, pz],
                    color: [0.15, 1.0, 0.15],
                });
                verts.push(GizmoVertex {
                    position: [px, py, pz],
                    color: [0.15, 0.15, 1.0],
                });
                verts.push(GizmoVertex {
                    position: [px, py, pz + len],
                    color: [0.15, 0.15, 1.0],
                });
                let xc = [
                    [px + len, py + hs, pz + hs],
                    [px + len, py - hs, pz + hs],
                    [px + len, py - hs, pz - hs],
                    [px + len, py + hs, pz - hs],
                ];
                for i in 0..4 {
                    verts.push(GizmoVertex {
                        position: xc[i],
                        color: [1.0, 0.15, 0.15],
                    });
                    verts.push(GizmoVertex {
                        position: xc[(i + 1) % 4],
                        color: [1.0, 0.15, 0.15],
                    });
                }
                let yc = [
                    [px + hs, py + len, pz + hs],
                    [px - hs, py + len, pz + hs],
                    [px - hs, py + len, pz - hs],
                    [px + hs, py + len, pz - hs],
                ];
                for i in 0..4 {
                    verts.push(GizmoVertex {
                        position: yc[i],
                        color: [0.15, 1.0, 0.15],
                    });
                    verts.push(GizmoVertex {
                        position: yc[(i + 1) % 4],
                        color: [0.15, 1.0, 0.15],
                    });
                }
                let zc = [
                    [px + hs, py + hs, pz + len],
                    [px - hs, py + hs, pz + len],
                    [px - hs, py - hs, pz + len],
                    [px + hs, py - hs, pz + len],
                ];
                for i in 0..4 {
                    verts.push(GizmoVertex {
                        position: zc[i],
                        color: [0.15, 0.15, 1.0],
                    });
                    verts.push(GizmoVertex {
                        position: zc[(i + 1) % 4],
                        color: [0.15, 0.15, 1.0],
                    });
                }
            }
            _ => {
                let len = axis_len;
                verts.extend_from_slice(&[
                    GizmoVertex {
                        position: [px, py, pz],
                        color: [1.0, 0.15, 0.15],
                    },
                    GizmoVertex {
                        position: [px + len, py, pz],
                        color: [1.0, 0.15, 0.15],
                    },
                    GizmoVertex {
                        position: [px, py, pz],
                        color: [0.15, 1.0, 0.15],
                    },
                    GizmoVertex {
                        position: [px, py + len, pz],
                        color: [0.15, 1.0, 0.15],
                    },
                    GizmoVertex {
                        position: [px, py, pz],
                        color: [0.15, 0.15, 1.0],
                    },
                    GizmoVertex {
                        position: [px, py, pz + len],
                        color: [0.15, 0.15, 1.0],
                    },
                ]);
                let ah = arrow_size;
                verts.push(GizmoVertex {
                    position: [px + len, py + ah, pz],
                    color: [1.0, 0.15, 0.15],
                });
                verts.push(GizmoVertex {
                    position: [px + len, py - ah, pz],
                    color: [1.0, 0.15, 0.15],
                });
                verts.push(GizmoVertex {
                    position: [px + len, py, pz + ah],
                    color: [1.0, 0.15, 0.15],
                });
                verts.push(GizmoVertex {
                    position: [px + len, py, pz - ah],
                    color: [1.0, 0.15, 0.15],
                });
                verts.push(GizmoVertex {
                    position: [px + ah, py + len, pz],
                    color: [0.15, 1.0, 0.15],
                });
                verts.push(GizmoVertex {
                    position: [px - ah, py + len, pz],
                    color: [0.15, 1.0, 0.15],
                });
                verts.push(GizmoVertex {
                    position: [px, py + len, pz + ah],
                    color: [0.15, 1.0, 0.15],
                });
                verts.push(GizmoVertex {
                    position: [px, py + len, pz - ah],
                    color: [0.15, 1.0, 0.15],
                });
                verts.push(GizmoVertex {
                    position: [px + ah, py, pz + len],
                    color: [0.15, 0.15, 1.0],
                });
                verts.push(GizmoVertex {
                    position: [px - ah, py, pz + len],
                    color: [0.15, 0.15, 1.0],
                });
                verts.push(GizmoVertex {
                    position: [px, py + ah, pz + len],
                    color: [0.15, 0.15, 1.0],
                });
                verts.push(GizmoVertex {
                    position: [px, py - ah, pz + len],
                    color: [0.15, 0.15, 1.0],
                });
            }
        }

        let hx = sx * 0.5 + 0.04;
        let hy = sy * 0.5 + 0.04;
        let hz = sz * 0.5 + 0.04;
        let bc = [1.0_f32, 0.85, 0.0];
        let corners = [
            [px - hx, py - hy, pz - hz],
            [px + hx, py - hy, pz - hz],
            [px + hx, py + hy, pz - hz],
            [px - hx, py + hy, pz - hz],
            [px - hx, py - hy, pz + hz],
            [px + hx, py - hy, pz + hz],
            [px + hx, py + hy, pz + hz],
            [px - hx, py + hy, pz + hz],
        ];
        for (a, b) in [
            (0, 1),
            (1, 5),
            (5, 4),
            (4, 0),
            (3, 2),
            (2, 6),
            (6, 7),
            (7, 3),
            (0, 3),
            (1, 2),
            (5, 6),
            (4, 7),
        ] {
            verts.push(GizmoVertex {
                position: corners[a],
                color: bc,
            });
            verts.push(GizmoVertex {
                position: corners[b],
                color: bc,
            });
        }

        if let Some(Face) = SelectedFace {
            AppendSelectedFaceOutline(&mut verts, Face, commands);
        }

        return verts;
    }
    Vec::new()
}
