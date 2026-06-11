struct SkyOut {
    @builtin(position) clip_pos: vec4<f32>,
    @location(0)       ndc:      vec2<f32>,
}

@vertex
fn vs_main(@builtin(vertex_index) index: u32) -> SkyOut {
    let ndc = vec2<f32>(f32((index << 1u) & 2u), f32(index & 2u)) * 2.0 - 1.0;
    var out: SkyOut;
    out.clip_pos = vec4<f32>(ndc, 1.0, 1.0);
    out.ndc = ndc;
    return out;
}

@fragment
fn fs_main(in: SkyOut) -> @location(0) vec4<f32> {
    let far = camera.inv_view_proj * vec4<f32>(in.ndc, 1.0, 1.0);
    let dir = normalize(far.xyz / far.w - camera.view_pos);

    let base = camera.sky_color;
    let zenith  = base * vec3<f32>(0.55, 0.65, 0.85);
    let horizon = mix(base, vec3<f32>(0.92, 0.95, 1.0), 0.45);
    let ground  = base * vec3<f32>(0.24, 0.25, 0.28);

    var color: vec3<f32>;
    if (dir.y >= 0.0) {
        color = mix(horizon, zenith, pow(clamp(dir.y, 0.0, 1.0), 0.58));
    } else {
        color = mix(horizon, ground, smoothstep(0.0, 0.22, -dir.y));
    }

    let sun = max(dot(dir, KEY_DIR), 0.0);
    color += (pow(sun, 900.0) * 0.85 + pow(sun, 14.0) * 0.06) * SUN_TINT;

    return vec4<f32>(tonemap(color), 1.0);
}
