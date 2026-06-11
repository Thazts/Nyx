struct VertexIn {
    @location(0) position:      vec3<f32>,
    @location(1) normal:        vec3<f32>,
    @location(2) inst_pos:      vec3<f32>,
    @location(3) inst_size:     vec3<f32>,
    @location(4) inst_color:    vec3<f32>,
    @location(5) inst_rotation: vec4<f32>,
}

struct VertexOut {
    @builtin(position) clip_pos:  vec4<f32>,
    @location(0)       color:     vec3<f32>,
    @location(1)       world_nrm: vec3<f32>,
    @location(2)       world_pos: vec3<f32>,
}

fn quat_rotate(v: vec3<f32>, q: vec4<f32>) -> vec3<f32> {
    let uv  = cross(q.xyz, v);
    let uuv = cross(q.xyz, uv);
    return v + ((uv * q.w) + uuv) * 2.0;
}

@vertex
fn vs_main(in: VertexIn) -> VertexOut {
    let scaled      = in.position * in.inst_size;
    let rotated_pos = quat_rotate(scaled, in.inst_rotation);
    let world_pos   = rotated_pos + in.inst_pos;
    let rotated_nrm = quat_rotate(in.normal, in.inst_rotation);
    var out: VertexOut;
    out.clip_pos  = camera.view_proj * vec4<f32>(world_pos, 1.0);
    out.color     = in.inst_color;
    out.world_nrm = rotated_nrm;
    out.world_pos = world_pos;
    return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
    return vec4<f32>(lit_surface(in.color, in.world_nrm, in.world_pos), 1.0);
}
