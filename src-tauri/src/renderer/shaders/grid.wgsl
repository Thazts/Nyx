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
fn grid_coverage(world: vec2<f32>, spacing: f32, deriv: vec2<f32>, width: f32) -> f32 {
    let dist = abs(world - round(world / spacing) * spacing);
    let coverage = vec2<f32>(1.0) - smoothstep(vec2<f32>(0.0), deriv * width, dist);
    return max(coverage.x, coverage.y);
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
    let world = in.world_pos.xz;
    let deriv = vec2<f32>(fwidth(world.x), fwidth(world.y));

    let major = grid_coverage(world, 1.0, deriv, 1.5);

    let minor_fade = 1.0 - smoothstep(0.02, 0.05, max(deriv.x, deriv.y));
    let minor = grid_coverage(world, 0.1, deriv, 1.0) * minor_fade;

    let dist_fade = 1.0 - smoothstep(40.0, 220.0, length(world));

    let major_color = vec3<f32>(0.26, 0.27, 0.31);
    let minor_color = vec3<f32>(0.15, 0.16, 0.19);
    let color = mix(minor_color, major_color, major);
    let alpha = max(major * 0.52, minor * 0.24) * dist_fade;

    return vec4<f32>(color, alpha);
}
