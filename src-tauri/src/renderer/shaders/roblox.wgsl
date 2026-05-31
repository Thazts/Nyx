struct Camera {
    view_proj: mat4x4<f32>,
    view_pos:  vec3<f32>,
}

@group(0) @binding(0) var<uniform> camera: Camera;

struct VertexIn {
    // per-vertex
    @location(0) position:     vec3<f32>,
    @location(1) normal:       vec3<f32>,
    // per-instance
    @location(2) inst_pos:     vec3<f32>,
    @location(3) inst_size:    vec3<f32>,
    @location(4) inst_color:   vec3<f32>,
    @location(5) inst_rotation: vec4<f32>,  // quaternion XYZW
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
    let n = normalize(in.world_nrm);
    let view_dir = normalize(camera.view_pos - in.world_pos);

    // Main directional light
    let light_dir = normalize(vec3<f32>(0.5, 1.0, 0.5));
    let diffuse = max(dot(n, light_dir), 0.0);

    // Fill light (blueish)
    let fill_dir = normalize(vec3<f32>(-0.6, 0.2, -0.6));
    let fill_diffuse = max(dot(n, fill_dir), 0.0) * 0.3;

    // Hemisphere ambient (sky color vs ground color)
    let sky_color = vec3<f32>(0.8, 0.9, 1.0);
    let ground_color = vec3<f32>(0.2, 0.2, 0.2);
    let hemisphere = mix(ground_color, sky_color, n.y * 0.5 + 0.5) * 0.4;

    let half_dir = normalize(view_dir + light_dir);
    let specular = pow(max(dot(n, half_dir), 0.0), 24.0) * 0.45;

    let lit = in.color * (hemisphere + (diffuse * 0.9) + fill_diffuse) + vec3<f32>(specular);
    return vec4<f32>(lit, 1.0);
}
