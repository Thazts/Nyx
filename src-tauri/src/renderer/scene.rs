use std::collections::{HashMap, HashSet};

use wgpu::util::DeviceExt;

use super::gizmo::{self, GizmoVertex, GridQuad, GridVertex};
use super::mesh::{
    BuildMeshGeometry, Instance, MakeMeshDraw, MeshDraw, ReadInstance, ShapeIndex, UnitShapeMesh,
    Vertex, SHAPE_COUNT,
};
use super::{camera::CameraUniform, SelectedFace};

const DEPTH_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Depth32Float;
const MSAA_SAMPLES: u32 = 4;
const GIZMO_MAX_VERTS: usize = 512;
const INITIAL_INSTANCE_CAPACITY: u32 = 256;

macro_rules! SceneShader {
    ($File:literal) => {
        concat!(include_str!("shaders/common.wgsl"), include_str!($File))
    };
}

struct ShapeBatch {
    vertex_buf: wgpu::Buffer,
    index_buf: wgpu::Buffer,
    index_count: u32,
    instance_buf: wgpu::Buffer,
    instance_capacity: u32,
    instance_count: u32,
}

struct CachedMesh {
    command: serde_json::Value,
    draw: MeshDraw,
}

fn SameGeometry(a: &serde_json::Value, b: &serde_json::Value) -> bool {
    a.get("Vertices") == b.get("Vertices")
        && a.get("Indices") == b.get("Indices")
        && a.get("Normals") == b.get("Normals")
}

fn MeshInstance(Command: &serde_json::Value) -> Instance {
    ReadInstance(Command, [1.0, 1.0, 1.0], [0.72, 0.72, 0.76])
}

struct PipelineDesc<'a> {
    label: &'a str,
    shader: &'static str,
    buffers: &'a [wgpu::VertexBufferLayout<'a>],
    topology: wgpu::PrimitiveTopology,
    cull: Option<wgpu::Face>,
    blend: wgpu::BlendState,
    depth_write: bool,
    depth_compare: wgpu::CompareFunction,
}

pub struct SceneRenderer {
    sky_pipeline: wgpu::RenderPipeline,
    part_pipeline: wgpu::RenderPipeline,
    shape_batches: Vec<ShapeBatch>,
    mesh_cache: HashMap<String, CachedMesh>,
    mesh_order: Vec<String>,
    camera_buf: wgpu::Buffer,
    camera_bind_grp: wgpu::BindGroup,
    msaa_view: wgpu::TextureView,
    depth_view: wgpu::TextureView,
    gizmo_pipeline: wgpu::RenderPipeline,
    gizmo_vertex_buf: wgpu::Buffer,
    gizmo_count: u32,
    grid_pipeline: wgpu::RenderPipeline,
    grid_vertex_buf: wgpu::Buffer,
    grid_index_buf: wgpu::Buffer,
    grid_index_count: u32,
}

impl SceneRenderer {
    pub fn new(
        device: &wgpu::Device,
        format: wgpu::TextureFormat,
        width: u32,
        height: u32,
    ) -> Self {
        let CameraBuf = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("camera"),
            size: std::mem::size_of::<CameraUniform>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let CamBgl = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("cam.bgl"),
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::VERTEX | wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size: None,
                },
                count: None,
            }],
        });

        let CameraBindGrp = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("cam.bg"),
            layout: &CamBgl,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: CameraBuf.as_entire_binding(),
            }],
        });

        let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("scene.layout"),
            bind_group_layouts: &[&CamBgl],
            push_constant_ranges: &[],
        });

        let SkyPipeline = MakePipeline(
            device,
            &layout,
            format,
            &PipelineDesc {
                label: "sky.pipeline",
                shader: SceneShader!("shaders/sky.wgsl"),
                buffers: &[],
                topology: wgpu::PrimitiveTopology::TriangleList,
                cull: None,
                blend: wgpu::BlendState::REPLACE,
                depth_write: false,
                depth_compare: wgpu::CompareFunction::Always,
            },
        );

        let PartPipeline = MakePipeline(
            device,
            &layout,
            format,
            &PipelineDesc {
                label: "part.pipeline",
                shader: SceneShader!("shaders/roblox.wgsl"),
                buffers: &[
                    wgpu::VertexBufferLayout {
                        array_stride: std::mem::size_of::<Vertex>() as wgpu::BufferAddress,
                        step_mode: wgpu::VertexStepMode::Vertex,
                        attributes: &wgpu::vertex_attr_array![0 => Float32x3, 1 => Float32x3],
                    },
                    wgpu::VertexBufferLayout {
                        array_stride: std::mem::size_of::<Instance>() as wgpu::BufferAddress,
                        step_mode: wgpu::VertexStepMode::Instance,
                        attributes: &wgpu::vertex_attr_array![
                            2 => Float32x3,
                            3 => Float32x3,
                            4 => Float32x3,
                            5 => Float32x4,
                        ],
                    },
                ],
                topology: wgpu::PrimitiveTopology::TriangleList,
                cull: Some(wgpu::Face::Back),
                blend: wgpu::BlendState::REPLACE,
                depth_write: true,
                depth_compare: wgpu::CompareFunction::Less,
            },
        );

        let GizmoPipeline = MakePipeline(
            device,
            &layout,
            format,
            &PipelineDesc {
                label: "gizmo.pipeline",
                shader: SceneShader!("shaders/gizmo.wgsl"),
                buffers: &[wgpu::VertexBufferLayout {
                    array_stride: std::mem::size_of::<GizmoVertex>() as wgpu::BufferAddress,
                    step_mode: wgpu::VertexStepMode::Vertex,
                    attributes: &wgpu::vertex_attr_array![0 => Float32x3, 1 => Float32x3],
                }],
                topology: wgpu::PrimitiveTopology::LineList,
                cull: None,
                blend: wgpu::BlendState::REPLACE,
                depth_write: false,
                depth_compare: wgpu::CompareFunction::Always,
            },
        );

        let GridPipeline = MakePipeline(
            device,
            &layout,
            format,
            &PipelineDesc {
                label: "grid.pipeline",
                shader: SceneShader!("shaders/grid.wgsl"),
                buffers: &[wgpu::VertexBufferLayout {
                    array_stride: std::mem::size_of::<GridVertex>() as wgpu::BufferAddress,
                    step_mode: wgpu::VertexStepMode::Vertex,
                    attributes: &wgpu::vertex_attr_array![0 => Float32x3],
                }],
                topology: wgpu::PrimitiveTopology::TriangleList,
                cull: None,
                blend: wgpu::BlendState::ALPHA_BLENDING,
                depth_write: false,
                depth_compare: wgpu::CompareFunction::Less,
            },
        );

        let ShapeBatches = (0..SHAPE_COUNT)
            .map(|Index| {
                let (Vertices, Indices) = UnitShapeMesh(Index);
                ShapeBatch {
                    vertex_buf: device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                        label: Some("shape.vtx"),
                        contents: bytemuck::cast_slice(&Vertices),
                        usage: wgpu::BufferUsages::VERTEX,
                    }),
                    index_buf: device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                        label: Some("shape.idx"),
                        contents: bytemuck::cast_slice(&Indices),
                        usage: wgpu::BufferUsages::INDEX,
                    }),
                    index_count: Indices.len() as u32,
                    instance_buf: MakeInstanceBuffer(device, INITIAL_INSTANCE_CAPACITY),
                    instance_capacity: INITIAL_INSTANCE_CAPACITY,
                    instance_count: 0,
                }
            })
            .collect();

        let GizmoVertexBuf = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("gizmo_verts"),
            size: (std::mem::size_of::<GizmoVertex>() * GIZMO_MAX_VERTS) as u64,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let (grid_verts, grid_idx) = GridQuad();
        let GridVertexBuf = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("grid.vtx"),
            contents: bytemuck::cast_slice(&grid_verts),
            usage: wgpu::BufferUsages::VERTEX,
        });
        let GridIndexBuf = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("grid.idx"),
            contents: bytemuck::cast_slice(&grid_idx),
            usage: wgpu::BufferUsages::INDEX,
        });
        let GridIndexCount = grid_idx.len() as u32;

        let msaa_view = MakeMsaa(device, format, width.max(1), height.max(1));
        let depth_view = MakeDepth(device, width.max(1), height.max(1));

        Self {
            sky_pipeline: SkyPipeline,
            part_pipeline: PartPipeline,
            shape_batches: ShapeBatches,
            mesh_cache: HashMap::new(),
            mesh_order: Vec::new(),
            camera_buf: CameraBuf,
            camera_bind_grp: CameraBindGrp,
            msaa_view,
            depth_view,
            gizmo_pipeline: GizmoPipeline,
            gizmo_vertex_buf: GizmoVertexBuf,
            gizmo_count: 0,
            grid_pipeline: GridPipeline,
            grid_vertex_buf: GridVertexBuf,
            grid_index_buf: GridIndexBuf,
            grid_index_count: GridIndexCount,
        }
    }

    pub fn resize(
        &mut self,
        device: &wgpu::Device,
        format: wgpu::TextureFormat,
        width: u32,
        height: u32,
    ) {
        self.msaa_view = MakeMsaa(device, format, width.max(1), height.max(1));
        self.depth_view = MakeDepth(device, width.max(1), height.max(1));
    }

    pub fn LoadCommands(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        commands: &[serde_json::Value],
    ) {
        let mut InstanceLists: Vec<Vec<Instance>> = vec![Vec::new(); SHAPE_COUNT];
        let mut NewOrder: Vec<String> = Vec::with_capacity(self.mesh_order.len());
        let mut UsedKeys: HashSet<String> = HashSet::new();

        for (Index, cmd) in commands.iter().enumerate() {
            match cmd.get("Cmd").and_then(|v| v.as_str()) {
                Some("AddPart") => {
                    let Shape = cmd.get("Shape").and_then(|v| v.as_str()).unwrap_or("Block");
                    InstanceLists[ShapeIndex(Shape)]
                        .push(ReadInstance(cmd, [4.0, 1.2, 2.0], [0.64, 0.64, 0.64]));
                }
                Some("AddMesh") => {
                    let mut Key = match cmd.get("Id").and_then(|v| v.as_str()) {
                        Some(Id) => Id.to_string(),
                        None => format!("auto:{Index}"),
                    };
                    while !UsedKeys.insert(Key.clone()) {
                        Key.push('+');
                    }

                    match self.mesh_cache.get_mut(&Key) {
                        Some(Cached) if Cached.command == *cmd => {}
                        Some(Cached) if SameGeometry(&Cached.command, cmd) => {
                            queue.write_buffer(
                                &Cached.draw.instance_buf,
                                0,
                                bytemuck::bytes_of(&MeshInstance(cmd)),
                            );
                            Cached.command = cmd.clone();
                        }
                        _ => {
                            let Some((Vertices, Indices)) = BuildMeshGeometry(cmd) else {
                                continue;
                            };
                            let draw = MakeMeshDraw(device, &Vertices, &Indices);
                            queue.write_buffer(
                                &draw.instance_buf,
                                0,
                                bytemuck::bytes_of(&MeshInstance(cmd)),
                            );
                            self.mesh_cache.insert(
                                Key.clone(),
                                CachedMesh {
                                    command: cmd.clone(),
                                    draw,
                                },
                            );
                        }
                    }
                    NewOrder.push(Key);
                }
                _ => {}
            }
        }

        let Keep: HashSet<&String> = NewOrder.iter().collect();
        self.mesh_cache.retain(|Key, _| Keep.contains(Key));
        drop(Keep);
        self.mesh_order = NewOrder;

        for (Batch, Instances) in self.shape_batches.iter_mut().zip(&InstanceLists) {
            Batch.instance_count = Instances.len() as u32;
            if Instances.is_empty() {
                continue;
            }
            if Batch.instance_count > Batch.instance_capacity {
                Batch.instance_capacity = Batch.instance_count.next_power_of_two();
                Batch.instance_buf = MakeInstanceBuffer(device, Batch.instance_capacity);
            }
            queue.write_buffer(&Batch.instance_buf, 0, bytemuck::cast_slice(Instances));
        }
    }

    pub fn LoadGizmo(
        &mut self,
        queue: &wgpu::Queue,
        SelectedId: Option<&str>,
        SelectedFace: Option<&SelectedFace>,
        commands: &[serde_json::Value],
        gizmo_mode: &str,
    ) {
        self.gizmo_count = 0;
        let id = match SelectedId {
            Some(i) => i,
            None => return,
        };
        let mut verts = gizmo::BuildGizmoVerts(id, SelectedFace, commands, gizmo_mode);
        verts.truncate(GIZMO_MAX_VERTS & !1);
        if verts.is_empty() {
            return;
        }
        self.gizmo_count = verts.len() as u32;
        queue.write_buffer(&self.gizmo_vertex_buf, 0, bytemuck::cast_slice(&verts));
    }

    pub fn UpdateCamera(&self, queue: &wgpu::Queue, uniform: &CameraUniform) {
        queue.write_buffer(&self.camera_buf, 0, bytemuck::bytes_of(uniform));
    }

    pub fn render(
        &self,
        surface: &wgpu::Surface<'static>,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        sky: wgpu::Color,
    ) {
        let output = match surface.get_current_texture() {
            Ok(t) => t,
            Err(_) => return,
        };

        let FrameView = output
            .texture
            .create_view(&wgpu::TextureViewDescriptor::default());
        let mut enc =
            device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: None });

        {
            let mut pass = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: None,
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &self.msaa_view,
                    resolve_target: Some(&FrameView),
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(sky),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                    view: &self.depth_view,
                    depth_ops: Some(wgpu::Operations {
                        load: wgpu::LoadOp::Clear(1.0),
                        store: wgpu::StoreOp::Discard,
                    }),
                    stencil_ops: None,
                }),
                timestamp_writes: None,
                occlusion_query_set: None,
            });

            pass.set_bind_group(0, &self.camera_bind_grp, &[]);

            pass.set_pipeline(&self.sky_pipeline);
            pass.draw(0..3, 0..1);
            let HasParts = self.shape_batches.iter().any(|b| b.instance_count > 0);
            if HasParts || !self.mesh_order.is_empty() {
                pass.set_pipeline(&self.part_pipeline);
                for Batch in &self.shape_batches {
                    if Batch.instance_count == 0 {
                        continue;
                    }
                    pass.set_vertex_buffer(0, Batch.vertex_buf.slice(..));
                    pass.set_vertex_buffer(1, Batch.instance_buf.slice(..));
                    pass.set_index_buffer(Batch.index_buf.slice(..), wgpu::IndexFormat::Uint32);
                    pass.draw_indexed(0..Batch.index_count, 0, 0..Batch.instance_count);
                }
                for Key in &self.mesh_order {
                    let Some(Cached) = self.mesh_cache.get(Key) else {
                        continue;
                    };
                    pass.set_vertex_buffer(0, Cached.draw.vertex_buf.slice(..));
                    pass.set_vertex_buffer(1, Cached.draw.instance_buf.slice(..));
                    pass.set_index_buffer(Cached.draw.index_buf.slice(..), wgpu::IndexFormat::Uint32);
                    pass.draw_indexed(0..Cached.draw.index_count, 0, 0..1);
                }
            }

            pass.set_pipeline(&self.grid_pipeline);
            pass.set_vertex_buffer(0, self.grid_vertex_buf.slice(..));
            pass.set_index_buffer(self.grid_index_buf.slice(..), wgpu::IndexFormat::Uint16);
            pass.draw_indexed(0..self.grid_index_count, 0, 0..1);

            if self.gizmo_count > 0 {
                pass.set_pipeline(&self.gizmo_pipeline);
                pass.set_vertex_buffer(0, self.gizmo_vertex_buf.slice(..));
                pass.draw(0..self.gizmo_count, 0..1);
            }
        }

        queue.submit(std::iter::once(enc.finish()));
        output.present();
    }
}

fn MakePipeline(
    device: &wgpu::Device,
    layout: &wgpu::PipelineLayout,
    format: wgpu::TextureFormat,
    desc: &PipelineDesc,
) -> wgpu::RenderPipeline {
    let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some(desc.label),
        source: wgpu::ShaderSource::Wgsl(desc.shader.into()),
    });
    device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some(desc.label),
        layout: Some(layout),
        vertex: wgpu::VertexState {
            module: &shader,
            entry_point: "vs_main",
            compilation_options: wgpu::PipelineCompilationOptions::default(),
            buffers: desc.buffers,
        },
        fragment: Some(wgpu::FragmentState {
            module: &shader,
            entry_point: "fs_main",
            compilation_options: wgpu::PipelineCompilationOptions::default(),
            targets: &[Some(wgpu::ColorTargetState {
                format,
                blend: Some(desc.blend),
                write_mask: wgpu::ColorWrites::ALL,
            })],
        }),
        primitive: wgpu::PrimitiveState {
            topology: desc.topology,
            strip_index_format: None,
            front_face: wgpu::FrontFace::Ccw,
            cull_mode: desc.cull,
            ..Default::default()
        },
        depth_stencil: Some(wgpu::DepthStencilState {
            format: DEPTH_FORMAT,
            depth_write_enabled: desc.depth_write,
            depth_compare: desc.depth_compare,
            stencil: wgpu::StencilState::default(),
            bias: wgpu::DepthBiasState::default(),
        }),
        multisample: wgpu::MultisampleState {
            count: MSAA_SAMPLES,
            mask: !0,
            alpha_to_coverage_enabled: false,
        },
        multiview: None,
    })
}

fn MakeInstanceBuffer(device: &wgpu::Device, Capacity: u32) -> wgpu::Buffer {
    device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("shape.instances"),
        size: Capacity as u64 * std::mem::size_of::<Instance>() as u64,
        usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    })
}

fn MakeMsaa(
    device: &wgpu::Device,
    format: wgpu::TextureFormat,
    width: u32,
    height: u32,
) -> wgpu::TextureView {
    device
        .create_texture(&wgpu::TextureDescriptor {
            label: Some("msaa"),
            size: wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: MSAA_SAMPLES,
            dimension: wgpu::TextureDimension::D2,
            format,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            view_formats: &[],
        })
        .create_view(&wgpu::TextureViewDescriptor::default())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ShadersAndPipelinesValidate() {
        let instance = wgpu::Instance::default();
        let Some(adapter) = pollster::block_on(
            instance.request_adapter(&wgpu::RequestAdapterOptions::default()),
        ) else {
            eprintln!("no GPU adapter available; skipping shader validation");
            return;
        };
        let (device, _queue) = pollster::block_on(
            adapter.request_device(&wgpu::DeviceDescriptor::default(), None),
        )
        .expect("request_device");
        let _ = SceneRenderer::new(&device, wgpu::TextureFormat::Bgra8UnormSrgb, 4, 4);
    }
}

fn MakeDepth(device: &wgpu::Device, width: u32, height: u32) -> wgpu::TextureView {
    device
        .create_texture(&wgpu::TextureDescriptor {
            label: Some("depth"),
            size: wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: MSAA_SAMPLES,
            dimension: wgpu::TextureDimension::D2,
            format: DEPTH_FORMAT,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            view_formats: &[],
        })
        .create_view(&wgpu::TextureViewDescriptor::default())
}
