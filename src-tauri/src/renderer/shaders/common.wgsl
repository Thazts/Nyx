struct Camera {
    view_proj:     mat4x4<f32>,
    inv_view_proj: mat4x4<f32>,
    view_pos:      vec3<f32>,
    sky_color:     vec3<f32>,
}

@group(0) @binding(0) var<uniform> camera: Camera;

const KEY_DIR:    vec3<f32> = vec3<f32>(0.4788, 0.8179, 0.3192);
const FILL_DIR:   vec3<f32> = vec3<f32>(-0.7247, 0.3623, -0.5861);
const BOUNCE_DIR: vec3<f32> = vec3<f32>(0.2086, -0.8345, -0.5100);
const SUN_TINT:   vec3<f32> = vec3<f32>(1.0, 0.96, 0.90);

fn srgb_to_linear(c: vec3<f32>) -> vec3<f32> {
    return pow(clamp(c, vec3<f32>(0.0), vec3<f32>(1.0)), vec3<f32>(2.2));
}

fn tonemap(color: vec3<f32>) -> vec3<f32> {
    let mapped = (color * (2.51 * color + 0.03)) / (color * (2.43 * color + 0.59) + 0.14);
    return clamp(mapped, vec3<f32>(0.0), vec3<f32>(1.0));
}

fn lit_surface(base: vec3<f32>, normal: vec3<f32>, world_pos: vec3<f32>) -> vec3<f32> {
    let n = normalize(normal);
    let view_dir = normalize(camera.view_pos - world_pos);

    let diffuse = max(dot(n, KEY_DIR), 0.0);
    let fill    = max(dot(n, FILL_DIR), 0.0) * 0.30;
    let bounce  = max(dot(n, BOUNCE_DIR), 0.0) * 0.18;
    let sky_tint = mix(vec3<f32>(0.70, 0.76, 0.82), camera.sky_color, 0.35);
    let ground_tint = vec3<f32>(0.26, 0.25, 0.24);
    let hemi = mix(ground_tint, sky_tint, n.y * 0.5 + 0.5);

    let half_dir = normalize(view_dir + KEY_DIR);
    let spec_mask = smoothstep(0.0, 0.12, diffuse);
    let specular = pow(max(dot(n, half_dir), 0.0), 48.0) * 0.20 * spec_mask;
    let fresnel = pow(clamp(1.0 - dot(n, view_dir), 0.0, 1.0), 3.0) * 0.05;

    let base_linear = srgb_to_linear(base);
    let light = hemi * 0.55 + diffuse * 1.15 + fill + bounce;
    let color = base_linear * light + (specular + fresnel) * SUN_TINT;
    return tonemap(color);
}
