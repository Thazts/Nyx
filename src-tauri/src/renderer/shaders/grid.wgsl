struct Camera {
    view_proj: mat4x4<f32>,
    view_pos:  vec3<f32>,
}

@group(0) @binding(0) var<uniform> camera: Camera;

struct VertexIn {
    @location(0) position: vec3<f32>,
}

struct VertexOut {
    @builtin(position) clip_pos:  vec4<f32>,
    @location(0)       world_pos: vec3<f32>,
}

@vertex
fn vs_main(in: VertexIn) -> VertexOut {
    var out: VertexOut;
    out.clip_pos  = camera.view_proj * vec4<f32>(in.position, 1.0);
    out.world_pos = in.position;
    return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
    let world = in.world_pos;
    let grid_size = 1.0;
    let minor_grid_size = 0.1;

    let dx = abs(world.x - round(world.x / grid_size) * grid_size);
    let dz = abs(world.z - round(world.z / grid_size) * grid_size);

    let minor_dx = abs(world.x - round(world.x / minor_grid_size) * minor_grid_size);
    let minor_dz = abs(world.z - round(world.z / minor_grid_size) * minor_grid_size);

    let fw = fwidth(world.x) * 0.5 + fwidth(world.z) * 0.5;
    let line_width = fw * 1.5;

    let major_x = 1.0 - smoothstep(0.0, line_width, dx);
    let major_z = 1.0 - smoothstep(0.0, line_width, dz);
    let major = max(major_x, major_z);

    let minor_x = 1.0 - smoothstep(0.0, line_width * 0.5, minor_dx);
    let minor_z = 1.0 - smoothstep(0.0, line_width * 0.5, minor_dz);
    let minor = max(minor_x, minor_z);

    let dist = length(world.xz);
    let fade = 1.0 - smoothstep(0.0, 200.0, dist);

    let grid_color = vec3<f32>(0.3, 0.3, 0.35);
    let minor_color = vec3<f32>(0.2, 0.2, 0.25);

    let grid = mix(minor_color, grid_color, major);
    let alpha = max(major, minor) * fade * 0.6;

    return vec4<f32>(grid, alpha);
}