use bytemuck::{Pod, Zeroable};
use glam::{Mat4, Vec3};

#[repr(C)]
#[derive(Copy, Clone, Pod, Zeroable)]
pub struct CameraUniform {
    pub view_proj: [[f32; 4]; 4],
    pub view_pos:  [f32; 3],
    pub _pad:      f32,
}

#[derive(Debug, Clone)]
pub struct OrbitalCamera {
    pub target:    Vec3,
    pub distance:  f32,
    pub azimuth:   f32,   // horizontal
    pub elevation: f32,   // vertical
    pub fov_y:     f32,
    pub aspect:    f32,
    pub near:      f32,
    pub far:       f32,
}

impl Default for OrbitalCamera {
    fn default() -> Self {
        let mut c = Self {
            target: Vec3::new(0.0, 3.0, 0.0),
            distance: 0.0, azimuth: 0.0, elevation: 0.0,
            fov_y: std::f32::consts::FRAC_PI_3,
            aspect: 1.0, near: 0.1, far: 2000.0,
        };
        c.set_from_eye_target([18.0, 14.0, 18.0], [0.0, 3.0, 0.0]);
        c
    }
}

impl OrbitalCamera {
    pub fn eye(&self) -> Vec3 {
        Vec3::new(
            self.target.x + self.distance * self.elevation.cos() * self.azimuth.sin(),
            self.target.y + self.distance * self.elevation.sin(),
            self.target.z + self.distance * self.elevation.cos() * self.azimuth.cos(),
        )
    }

    pub fn orbit(&mut self, dx: f32, dy: f32) {
        if dx == 0.0 && dy == 0.0 { return; }
        self.azimuth   += dx * 0.007;
        self.elevation  = (self.elevation - dy * 0.007)
            .clamp(-(std::f32::consts::FRAC_PI_2 - 0.05),
                     std::f32::consts::FRAC_PI_2 - 0.05);
    }

    pub fn pan(&mut self, dx: f32, dy: f32) {
        if dx == 0.0 && dy == 0.0 { return; }
        let eye   = self.eye();
        let fwd   = (self.target - eye).normalize();
        let right = fwd.cross(Vec3::Y).normalize();
        let up    = right.cross(fwd).normalize();
        let spd   = self.distance * 0.0015;
        self.target -= right * dx * spd;
        self.target += up    * dy * spd;
    }

    pub fn zoom(&mut self, delta: f32) {
        if delta == 0.0 { return; }
        self.distance = (self.distance * 0.88_f32.powf(delta)).clamp(0.5, 5000.0);
    }

    pub fn wasd_move(&mut self, forward: f32, right: f32, up: f32) {
        if forward == 0.0 && right == 0.0 && up == 0.0 { return; }
        let eye = self.eye();
        let fwd  = (self.target - eye).normalize();
        let rgt   = fwd.cross(Vec3::Y).normalize();
        let spd   = self.distance * 0.02; // 2 % d/f
        let delta = fwd * forward * spd + rgt * right * spd + Vec3::Y * up * spd;
        self.target += delta;
    }

    pub fn set_from_eye_target(&mut self, eye: [f32; 3], target: [f32; 3]) {
        let e = Vec3::from_array(eye);
        let t = Vec3::from_array(target);
        let d = e - t;
        self.target = t;
        self.distance = d.length().max(0.001);
        self.azimuth = d.x.atan2(d.z);
        self.elevation = (d.y / self.distance).clamp(-1.0, 1.0).asin();
    }

    pub fn to_uniform(&self) -> CameraUniform {
        let eye  = self.eye();
        let view = Mat4::look_at_rh(eye, self.target, Vec3::Y);
        let proj = Mat4::perspective_rh(self.fov_y, self.aspect, self.near, self.far);
        CameraUniform {
            view_proj: (proj * view).to_cols_array_2d(),
            view_pos:  eye.to_array(),
            _pad:      0.0,
        }
    }

    pub fn get_ray(&self, ndc_x: f32, ndc_y: f32) -> (Vec3, Vec3) {
        let eye  = self.eye();
        let view = Mat4::look_at_rh(eye, self.target, Vec3::Y);
        let proj = Mat4::perspective_rh(self.fov_y, self.aspect, self.near, self.far);
        let inv_vp = (proj * view).inverse();
        
        let near_pt = inv_vp.project_point3(Vec3::new(ndc_x, ndc_y, 0.0));
        let far_pt  = inv_vp.project_point3(Vec3::new(ndc_x, ndc_y, 1.0));
        let dir = (far_pt - near_pt).normalize();
        
        (near_pt, dir)
    }
}
