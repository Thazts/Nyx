use wgpu::util::DeviceExt;
use bytemuck::{Pod, Zeroable};

use super::camera::CameraUniform;

#[repr(C)]
#[derive(Copy, Clone, Pod, Zeroable)]
struct Vertex {
    position: [f32; 3],
    normal:   [f32; 3],
}

#[repr(C)]
#[derive(Copy, Clone, Pod, Zeroable)]
struct Instance {
    position: [f32; 3],   // offset 0
    size:     [f32; 3],   // offset 12
    color:    [f32; 3],   // offset 24
    rotation: [f32; 4],   // offset 36 — quaternion XYZW; identity = [0,0,0,1]
}

fn euler_to_quat(rx: f32, ry: f32, rz: f32) -> [f32; 4] {
    // YXZ Euler order (Roblox CFrame.Angles convention: RY first, then RX, then RZ)
    let (cx, sx) = ((rx * 0.5).cos(), (rx * 0.5).sin());
    let (cy, sy) = ((ry * 0.5).cos(), (ry * 0.5).sin());
    let (cz, sz) = ((rz * 0.5).cos(), (rz * 0.5).sin());
    let w = cy * cx * cz + sy * sx * sz;
    let x = cy * sx * cz + sy * cx * sz;
    let y = sy * cx * cz - cy * sx * sz;
    let z = cy * cx * sz - sy * sx * cz;
    let len = (x*x + y*y + z*z + w*w).sqrt();
    if len < 1e-6 { return [0.0, 0.0, 0.0, 1.0]; }
    [x/len, y/len, z/len, w/len]
}

#[repr(C)]
#[derive(Copy, Clone, Pod, Zeroable)]
struct GizmoVertex {
    position: [f32; 3],
    color:    [f32; 3],
}

#[repr(C)]
#[derive(Copy, Clone, Pod, Zeroable)]
struct GridVertex {
    position: [f32; 3],
}

const DEPTH_FORMAT:   wgpu::TextureFormat = wgpu::TextureFormat::Depth32Float;
const MAX_INSTANCES:  u64                 = 4096;

fn cube_mesh() -> (Vec<Vertex>, Vec<u16>) {
    let faces: &[([f32; 3], [[f32; 3]; 4])] = &[
        ([ 0., 0., 1.], [[-0.5,-0.5, 0.5],[ 0.5,-0.5, 0.5],[ 0.5, 0.5, 0.5],[-0.5, 0.5, 0.5]]), // +Z front
        ([ 0., 0.,-1.], [[ 0.5,-0.5,-0.5],[-0.5,-0.5,-0.5],[-0.5, 0.5,-0.5],[ 0.5, 0.5,-0.5]]), // -Z back
        ([-1., 0., 0.], [[-0.5,-0.5,-0.5],[-0.5,-0.5, 0.5],[-0.5, 0.5, 0.5],[-0.5, 0.5,-0.5]]), // -X left
        ([ 1., 0., 0.], [[ 0.5,-0.5, 0.5],[ 0.5,-0.5,-0.5],[ 0.5, 0.5,-0.5],[ 0.5, 0.5, 0.5]]), // +X right
        ([ 0., 1., 0.], [[-0.5, 0.5, 0.5],[ 0.5, 0.5, 0.5],[ 0.5, 0.5,-0.5],[-0.5, 0.5,-0.5]]), // +Y top
        ([ 0.,-1., 0.], [[-0.5,-0.5,-0.5],[ 0.5,-0.5,-0.5],[ 0.5,-0.5, 0.5],[-0.5,-0.5, 0.5]]), // -Y bottom
    ];

    let mut verts: Vec<Vertex> = Vec::with_capacity(24);
    let mut idx:   Vec<u16>    = Vec::with_capacity(36);

    for (normal, quad) in faces {
        let base = verts.len() as u16;
        for pos in quad {
            verts.push(Vertex { position: *pos, normal: *normal });
        }
        idx.extend_from_slice(&[base, base+1, base+2, base, base+2, base+3]);
    }

    (verts, idx)
}

fn grid_quad() -> (Vec<GridVertex>, Vec<u16>) {
    let size = 2000.0_f32;
    let verts = vec![
        GridVertex { position: [-size, 0.0, -size] },
        GridVertex { position: [ size, 0.0, -size] },
        GridVertex { position: [ size, 0.0,  size] },
        GridVertex { position: [-size, 0.0,  size] },
    ];
    let idx = vec![0u16, 1, 2, 0, 2, 3];
    (verts, idx)
}

pub struct SceneRenderer {
    pipeline:        wgpu::RenderPipeline,
    vertex_buf:      wgpu::Buffer,
    index_buf:       wgpu::Buffer,
    index_count:     u32,
    instance_buf:    wgpu::Buffer,
    instance_count:  u32,
    camera_buf:      wgpu::Buffer,
    camera_bind_grp: wgpu::BindGroup,
    msaa_tex:        wgpu::Texture,
    msaa_view:       wgpu::TextureView,
    depth_tex:       wgpu::Texture,
    depth_view:      wgpu::TextureView,
    gizmo_pipeline:  wgpu::RenderPipeline,
    gizmo_vertex_buf: wgpu::Buffer,
    gizmo_count:     u32,
    grid_pipeline:   wgpu::RenderPipeline,
    grid_vertex_buf: wgpu::Buffer,
    grid_index_buf:  wgpu::Buffer,
    grid_index_count: u32,
}

impl SceneRenderer {
    pub fn new(
        device: &wgpu::Device,
        format: wgpu::TextureFormat,
        width:  u32,
        height: u32,
    ) -> Self {
        let (cube_verts, cube_idx) = cube_mesh();

        let vertex_buf = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label:    Some("cube.vtx"),
            contents: bytemuck::cast_slice(&cube_verts),
            usage:    wgpu::BufferUsages::VERTEX,
        });
        let index_buf = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label:    Some("cube.idx"),
            contents: bytemuck::cast_slice(&cube_idx),
            usage:    wgpu::BufferUsages::INDEX,
        });
        let index_count = cube_idx.len() as u32;

        let instance_buf = device.create_buffer(&wgpu::BufferDescriptor {
            label:              Some("instances"),
            size:               MAX_INSTANCES * std::mem::size_of::<Instance>() as u64,
            usage:              wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let camera_buf = device.create_buffer(&wgpu::BufferDescriptor {
            label:              Some("camera"),
            size:               std::mem::size_of::<CameraUniform>() as u64,
            usage:              wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let gizmo_vertex_buf = device.create_buffer(&wgpu::BufferDescriptor {
            label:              Some("gizmo_verts"),
            size:               std::mem::size_of::<GizmoVertex>() as u64 * 512,
            usage:              wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let cam_bgl = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label:   Some("cam.bgl"),
            entries: &[wgpu::BindGroupLayoutEntry {
                binding:    0,
                visibility: wgpu::ShaderStages::VERTEX | wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Buffer {
                    ty:                 wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size:   None,
                },
                count: None,
            }],
        });

        let camera_bind_grp = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label:   Some("cam.bg"),
            layout:  &cam_bgl,
            entries: &[wgpu::BindGroupEntry {
                binding:  0,
                resource: camera_buf.as_entire_binding(),
            }],
        });

        let (msaa_tex, msaa_view) = make_msaa(device, format, width.max(1), height.max(1));
        let (depth_tex, depth_view) = make_depth(device, width.max(1), height.max(1));

        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label:  Some("roblox.wgsl"),
            source: wgpu::ShaderSource::Wgsl(include_str!("shaders/roblox.wgsl").into()),
        });

        let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label:                Some("scene.layout"),
            bind_group_layouts:   &[&cam_bgl],
            push_constant_ranges: &[],
        });

        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label:  Some("scene.pipeline"),
            layout: Some(&layout),
            vertex: wgpu::VertexState {
                module:               &shader,
                entry_point:          "vs_main",
                compilation_options:  wgpu::PipelineCompilationOptions::default(),
                buffers: &[
                    wgpu::VertexBufferLayout {
                        array_stride: std::mem::size_of::<Vertex>() as wgpu::BufferAddress,
                        step_mode:    wgpu::VertexStepMode::Vertex,
                        attributes:   &wgpu::vertex_attr_array![0 => Float32x3, 1 => Float32x3],
                    },
                    wgpu::VertexBufferLayout {
                        array_stride: std::mem::size_of::<Instance>() as wgpu::BufferAddress,
                        step_mode:    wgpu::VertexStepMode::Instance,
                        attributes:   &wgpu::vertex_attr_array![
                            2 => Float32x3,  // inst_pos
                            3 => Float32x3,  // inst_size
                            4 => Float32x3,  // inst_color
                            5 => Float32x4,  // inst_rotation (quaternion)
                        ],
                    },
                ],
            },
            fragment: Some(wgpu::FragmentState {
                module:              &shader,
                entry_point:         "fs_main",
                compilation_options: wgpu::PipelineCompilationOptions::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend:      Some(wgpu::BlendState::REPLACE),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            primitive: wgpu::PrimitiveState {
                topology:           wgpu::PrimitiveTopology::TriangleList,
                strip_index_format: None,
                front_face:         wgpu::FrontFace::Ccw,
                cull_mode:          Some(wgpu::Face::Back),
                ..Default::default()
            },
            depth_stencil: Some(wgpu::DepthStencilState {
                format:              DEPTH_FORMAT,
                depth_write_enabled: true,
                depth_compare:       wgpu::CompareFunction::Less,
                stencil:             wgpu::StencilState::default(),
                bias:                wgpu::DepthBiasState::default(),
            }),
            multisample: wgpu::MultisampleState {
                count: 4,
                mask: !0,
                alpha_to_coverage_enabled: false,
            },
            multiview:   None,
        });

        let gizmo_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label:  Some("gizmo.wgsl"),
            source: wgpu::ShaderSource::Wgsl(include_str!("shaders/gizmo.wgsl").into()),
        });

        let gizmo_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label:  Some("gizmo.pipeline"),
            layout: Some(&layout),
            vertex: wgpu::VertexState {
                module:               &gizmo_shader,
                entry_point:          "vs_main",
                compilation_options:  wgpu::PipelineCompilationOptions::default(),
                buffers: &[wgpu::VertexBufferLayout {
                    array_stride: std::mem::size_of::<GizmoVertex>() as wgpu::BufferAddress,
                    step_mode:    wgpu::VertexStepMode::Vertex,
                    attributes:   &wgpu::vertex_attr_array![0 => Float32x3, 1 => Float32x3],
                }],
            },
            fragment: Some(wgpu::FragmentState {
                module:              &gizmo_shader,
                entry_point:         "fs_main",
                compilation_options: wgpu::PipelineCompilationOptions::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend:      Some(wgpu::BlendState::REPLACE),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            primitive: wgpu::PrimitiveState {
                topology:           wgpu::PrimitiveTopology::LineList,
                strip_index_format: None,
                front_face:         wgpu::FrontFace::Ccw,
                cull_mode:          None,
                ..Default::default()
            },
            depth_stencil: Some(wgpu::DepthStencilState {
                format:              DEPTH_FORMAT,
                depth_write_enabled: false,
                depth_compare:       wgpu::CompareFunction::Always,
                stencil:             wgpu::StencilState::default(),
                bias:                wgpu::DepthBiasState::default(),
            }),
            multisample: wgpu::MultisampleState {
                count: 4,
                mask: !0,
                alpha_to_coverage_enabled: false,
            },
            multiview:   None,
        });
        let grid_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label:  Some("grid.wgsl"),
            source: wgpu::ShaderSource::Wgsl(include_str!("shaders/grid.wgsl").into()),
        });

        let grid_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label:  Some("grid.pipeline"),
            layout: Some(&layout),
            vertex: wgpu::VertexState {
                module:               &grid_shader,
                entry_point:          "vs_main",
                compilation_options:  wgpu::PipelineCompilationOptions::default(),
                buffers: &[wgpu::VertexBufferLayout {
                    array_stride: std::mem::size_of::<GridVertex>() as wgpu::BufferAddress,
                    step_mode:    wgpu::VertexStepMode::Vertex,
                    attributes:   &wgpu::vertex_attr_array![0 => Float32x3],
                }],
            },
            fragment: Some(wgpu::FragmentState {
                module:              &grid_shader,
                entry_point:         "fs_main",
                compilation_options: wgpu::PipelineCompilationOptions::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend:      Some(wgpu::BlendState::ALPHA_BLENDING),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            primitive: wgpu::PrimitiveState {
                topology:           wgpu::PrimitiveTopology::TriangleList,
                strip_index_format: None,
                front_face:         wgpu::FrontFace::Ccw,
                cull_mode:          None,
                ..Default::default()
            },
            depth_stencil: Some(wgpu::DepthStencilState {
                format:              DEPTH_FORMAT,
                depth_write_enabled: false,
                depth_compare:       wgpu::CompareFunction::Less,
                stencil:             wgpu::StencilState::default(),
                bias:                wgpu::DepthBiasState::default(),
            }),
            multisample: wgpu::MultisampleState {
                count: 4,
                mask: !0,
                alpha_to_coverage_enabled: false,
            },
            multiview:   None,
        });

        let (grid_verts, grid_idx) = grid_quad();
        let grid_vertex_buf = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label:    Some("grid.vtx"),
            contents: bytemuck::cast_slice(&grid_verts),
            usage:    wgpu::BufferUsages::VERTEX,
        });
        let grid_index_buf = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label:    Some("grid.idx"),
            contents: bytemuck::cast_slice(&grid_idx),
            usage:    wgpu::BufferUsages::INDEX,
        });
        let grid_index_count = grid_idx.len() as u32;

        Self {
            pipeline,
            vertex_buf,
            index_buf,
            index_count,
            instance_buf,
            instance_count: 0,
            camera_buf,
            camera_bind_grp,
            msaa_tex,
            msaa_view,
            depth_tex,
            depth_view,

            gizmo_pipeline,
            gizmo_vertex_buf,
            gizmo_count: 0,

            grid_pipeline,
            grid_vertex_buf,
            grid_index_buf,
            grid_index_count,
        }
    }

    pub fn resize(&mut self, device: &wgpu::Device, format: wgpu::TextureFormat, width: u32, height: u32) {
        let (m_tex, m_view) = make_msaa(device, format, width.max(1), height.max(1));
        self.msaa_tex       = m_tex;
        self.msaa_view      = m_view;

        let (d_tex, d_view) = make_depth(device, width.max(1), height.max(1));
        self.depth_tex      = d_tex;
        self.depth_view     = d_view;
    }

    pub fn load_commands(&mut self, queue: &wgpu::Queue, commands: &[serde_json::Value]) {
        let mut instances: Vec<Instance> = Vec::new();

        for cmd in commands {
            if cmd.get("Cmd").and_then(|v| v.as_str()) != Some("AddPart") { continue; }

            let pos = cmd.get("Position");
            let siz = cmd.get("Size");
            let col = cmd.get("Color");

            let f = |obj: Option<&serde_json::Value>, key: &str, fallback: f64| -> f32 {
                obj.and_then(|o| o.get(key)).and_then(|v| v.as_f64()).unwrap_or(fallback) as f32
            };

            let cf  = cmd.get("CFrame");
            let rx  = cf.and_then(|o| o.get("RX")).and_then(|v| v.as_f64()).unwrap_or(0.0) as f32;
            let ry  = cf.and_then(|o| o.get("RY")).and_then(|v| v.as_f64()).unwrap_or(0.0) as f32;
            let rz  = cf.and_then(|o| o.get("RZ")).and_then(|v| v.as_f64()).unwrap_or(0.0) as f32;

            instances.push(Instance {
                position: [f(pos, "X", 0.0), f(pos, "Y", 0.0), f(pos, "Z", 0.0)],
                size:     [f(siz, "X", 4.0), f(siz, "Y", 1.2), f(siz, "Z", 2.0)],
                color:    [f(col, "R", 0.64), f(col, "G", 0.64), f(col, "B", 0.64)],
                rotation: euler_to_quat(rx, ry, rz),
            });

            if instances.len() >= MAX_INSTANCES as usize { break; }
        }

        self.instance_count = instances.len() as u32;
        if !instances.is_empty() {
            queue.write_buffer(&self.instance_buf, 0, bytemuck::cast_slice(&instances));
        }
    }

    pub fn load_gizmo(
        &mut self,
        queue:       &wgpu::Queue,
        selected_id: Option<&str>,
        commands:    &[serde_json::Value],
        gizmo_mode:  &str,
    ) {
        self.gizmo_count = 0;
        let id = match selected_id { Some(i) => i, None => return };

        for cmd in commands {
            if cmd.get("Cmd").and_then(|v| v.as_str()) != Some("AddPart") { continue; }
            if cmd.get("Id").and_then(|v| v.as_str())  != Some(id)        { continue; }

            let fp = |k: &str| -> f32 {
                cmd.get("Position").and_then(|o| o.get(k)).and_then(|v| v.as_f64()).unwrap_or(0.0) as f32
            };
            let fs = |k: &str, d: f64| -> f32 {
                cmd.get("Size").and_then(|o| o.get(k)).and_then(|v| v.as_f64()).unwrap_or(d) as f32
            };
            let px = fp("X"); let py = fp("Y"); let pz = fp("Z");
            let sx = fs("X", 2.0); let sy = fs("Y", 2.0); let sz = fs("Z", 2.0);

            let mut verts: Vec<GizmoVertex> = Vec::new();

            match gizmo_mode {
                "rotate" => {
                    let radius = sx.max(sy).max(sz) * 0.5 + 0.8;
                    let segs = 32usize;
                    let ring_data: [([f32; 3], u8); 3] = [
                        ([1.0, 0.15, 0.15], 0), // X ring (YZ plane)
                        ([0.15, 1.0, 0.15], 1), // Y ring (XZ plane)
                        ([0.15, 0.15, 1.0], 2), // Z ring (XY plane)
                    ];
                    for (color, axis) in &ring_data {
                        for i in 0..segs {
                            let a0 = (i     as f32) / (segs as f32) * std::f32::consts::TAU;
                            let a1 = ((i+1) as f32) / (segs as f32) * std::f32::consts::TAU;
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
                            verts.push(GizmoVertex { position: p0, color: *color });
                            verts.push(GizmoVertex { position: p1, color: *color });
                        }
                    }
                }
                "scale" => {
                    let len = 6.0_f32;
                    let hs  = 0.35_f32;
                    verts.push(GizmoVertex { position: [px,       py, pz], color: [1.0, 0.15, 0.15] });
                    verts.push(GizmoVertex { position: [px+len,   py, pz], color: [1.0, 0.15, 0.15] });
                    verts.push(GizmoVertex { position: [px, py,       pz], color: [0.15, 1.0, 0.15] });
                    verts.push(GizmoVertex { position: [px, py+len,   pz], color: [0.15, 1.0, 0.15] });
                    verts.push(GizmoVertex { position: [px, py, pz      ], color: [0.15, 0.15, 1.0] });
                    verts.push(GizmoVertex { position: [px, py, pz+len  ], color: [0.15, 0.15, 1.0] });
                    // Square handle at X tip (YZ plane)
                    let xc = [[px+len,py+hs,pz+hs],[px+len,py-hs,pz+hs],[px+len,py-hs,pz-hs],[px+len,py+hs,pz-hs]];
                    for i in 0..4 { verts.push(GizmoVertex { position: xc[i], color: [1.0,0.15,0.15] }); verts.push(GizmoVertex { position: xc[(i+1)%4], color: [1.0,0.15,0.15] }); }
                    // Square handle at Y tip (XZ plane)
                    let yc = [[px+hs,py+len,pz+hs],[px-hs,py+len,pz+hs],[px-hs,py+len,pz-hs],[px+hs,py+len,pz-hs]];
                    for i in 0..4 { verts.push(GizmoVertex { position: yc[i], color: [0.15,1.0,0.15] }); verts.push(GizmoVertex { position: yc[(i+1)%4], color: [0.15,1.0,0.15] }); }
                    // Square handle at Z tip (XY plane)
                    let zc = [[px+hs,py+hs,pz+len],[px-hs,py+hs,pz+len],[px-hs,py-hs,pz+len],[px+hs,py-hs,pz+len]];
                    for i in 0..4 { verts.push(GizmoVertex { position: zc[i], color: [0.15,0.15,1.0] }); verts.push(GizmoVertex { position: zc[(i+1)%4], color: [0.15,0.15,1.0] }); }
                }
                _ => {
                    let len = 6.0_f32;
                    verts.extend_from_slice(&[
                        GizmoVertex { position: [px,       py, pz], color: [1.0, 0.15, 0.15] },
                        GizmoVertex { position: [px + len, py, pz], color: [1.0, 0.15, 0.15] },
                        GizmoVertex { position: [px, py,       pz], color: [0.15, 1.0, 0.15] },
                        GizmoVertex { position: [px, py + len, pz], color: [0.15, 1.0, 0.15] },
                        GizmoVertex { position: [px, py, pz      ], color: [0.15, 0.15, 1.0] },
                        GizmoVertex { position: [px, py, pz + len], color: [0.15, 0.15, 1.0] },
                    ]);
                    let ah = 0.4_f32;
                    // X arrowhead
                    verts.push(GizmoVertex { position: [px+len, py+ah, pz], color: [1.0, 0.15, 0.15] });
                    verts.push(GizmoVertex { position: [px+len, py-ah, pz], color: [1.0, 0.15, 0.15] });
                    verts.push(GizmoVertex { position: [px+len, py, pz+ah], color: [1.0, 0.15, 0.15] });
                    verts.push(GizmoVertex { position: [px+len, py, pz-ah], color: [1.0, 0.15, 0.15] });
                    // Y arrowhead
                    verts.push(GizmoVertex { position: [px+ah, py+len, pz], color: [0.15, 1.0, 0.15] });
                    verts.push(GizmoVertex { position: [px-ah, py+len, pz], color: [0.15, 1.0, 0.15] });
                    verts.push(GizmoVertex { position: [px, py+len, pz+ah], color: [0.15, 1.0, 0.15] });
                    verts.push(GizmoVertex { position: [px, py+len, pz-ah], color: [0.15, 1.0, 0.15] });
                    // Z arrowhead
                    verts.push(GizmoVertex { position: [px+ah, py, pz+len], color: [0.15, 0.15, 1.0] });
                    verts.push(GizmoVertex { position: [px-ah, py, pz+len], color: [0.15, 0.15, 1.0] });
                    verts.push(GizmoVertex { position: [px, py+ah, pz+len], color: [0.15, 0.15, 1.0] });
                    verts.push(GizmoVertex { position: [px, py-ah, pz+len], color: [0.15, 0.15, 1.0] });
                }
            }
            let hx = sx * 0.5 + 0.04;
            let hy = sy * 0.5 + 0.04;
            let hz = sz * 0.5 + 0.04;
            let bc = [1.0_f32, 0.85, 0.0];
            let corners = [
                [px-hx, py-hy, pz-hz], [px+hx, py-hy, pz-hz],
                [px+hx, py+hy, pz-hz], [px-hx, py+hy, pz-hz],
                [px-hx, py-hy, pz+hz], [px+hx, py-hy, pz+hz],
                [px+hx, py+hy, pz+hz], [px-hx, py+hy, pz+hz],
            ];
            for (a, b) in [(0,1),(1,5),(5,4),(4,0),(3,2),(2,6),(6,7),(7,3),(0,3),(1,2),(5,6),(4,7)] {
                verts.push(GizmoVertex { position: corners[a], color: bc });
                verts.push(GizmoVertex { position: corners[b], color: bc });
            }

            self.gizmo_count = verts.len() as u32;
            queue.write_buffer(&self.gizmo_vertex_buf, 0, bytemuck::cast_slice(&verts));
            break;
        }
    }

    pub fn update_camera(&self, queue: &wgpu::Queue, uniform: &CameraUniform) {
        queue.write_buffer(&self.camera_buf, 0, bytemuck::bytes_of(uniform));
    }

    pub fn render(
        &self,
        surface: &wgpu::Surface<'static>,
        device:  &wgpu::Device,
        queue:   &wgpu::Queue,
        sky:     wgpu::Color,
    ) {
        let output = match surface.get_current_texture() {
            Ok(t) => t,
            Err(wgpu::SurfaceError::Outdated | wgpu::SurfaceError::Lost) => return,
            Err(_) => return,
        };

        let frame_view = output.texture.create_view(&wgpu::TextureViewDescriptor::default());
        let mut enc = device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: None });

        {
            let mut pass = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: None,
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view:           &self.msaa_view,
                    resolve_target: Some(&frame_view),
                    ops: wgpu::Operations {
                        load:  wgpu::LoadOp::Clear(sky),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                    view:        &self.depth_view,
                    depth_ops:   Some(wgpu::Operations {
                        load:  wgpu::LoadOp::Clear(1.0),
                        store: wgpu::StoreOp::Discard,
                    }),
                    stencil_ops: None,
                }),
                timestamp_writes:   None,
                occlusion_query_set: None,
            });

            if self.instance_count > 0 {
                pass.set_pipeline(&self.pipeline);
                pass.set_bind_group(0, &self.camera_bind_grp, &[]);
                pass.set_vertex_buffer(0, self.vertex_buf.slice(..));
                pass.set_vertex_buffer(1, self.instance_buf.slice(..));
                pass.set_index_buffer(self.index_buf.slice(..), wgpu::IndexFormat::Uint16);
                pass.draw_indexed(0..self.index_count, 0, 0..self.instance_count);
            }
            pass.set_pipeline(&self.grid_pipeline);
            pass.set_bind_group(0, &self.camera_bind_grp, &[]);
            pass.set_vertex_buffer(0, self.grid_vertex_buf.slice(..));
            pass.set_index_buffer(self.grid_index_buf.slice(..), wgpu::IndexFormat::Uint16);
            pass.draw_indexed(0..self.grid_index_count, 0, 0..1);

            if self.gizmo_count > 0 {
                pass.set_pipeline(&self.gizmo_pipeline);
                pass.set_bind_group(0, &self.camera_bind_grp, &[]);
                pass.set_vertex_buffer(0, self.gizmo_vertex_buf.slice(..));
                pass.draw(0..self.gizmo_count, 0..1);
            }
        }

        queue.submit(std::iter::once(enc.finish()));
        output.present();
    }
}

fn make_msaa(device: &wgpu::Device, format: wgpu::TextureFormat, width: u32, height: u32) -> (wgpu::Texture, wgpu::TextureView) {
    let tex = device.create_texture(&wgpu::TextureDescriptor {
        label:           Some("msaa"),
        size:            wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
        mip_level_count: 1,
        sample_count:    4,
        dimension:       wgpu::TextureDimension::D2,
        format,
        usage:           wgpu::TextureUsages::RENDER_ATTACHMENT,
        view_formats:    &[],
    });
    let view = tex.create_view(&wgpu::TextureViewDescriptor::default());
    (tex, view)
}

fn make_depth(device: &wgpu::Device, width: u32, height: u32) -> (wgpu::Texture, wgpu::TextureView) {
    let tex = device.create_texture(&wgpu::TextureDescriptor {
        label:           Some("depth"),
        size:            wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
        mip_level_count: 1,
        sample_count:    4,
        dimension:       wgpu::TextureDimension::D2,
        format:          DEPTH_FORMAT,
        usage:           wgpu::TextureUsages::RENDER_ATTACHMENT,
        view_formats:    &[],
    });
    let view = tex.create_view(&wgpu::TextureViewDescriptor::default());
    (tex, view)
}
