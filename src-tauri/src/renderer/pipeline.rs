use std::num::NonZeroIsize;

use rwh06::{RawDisplayHandle, RawWindowHandle, Win32WindowHandle, WindowsDisplayHandle};
pub struct SendSurface(pub wgpu::Surface<'static>);
unsafe impl Send for SendSurface {}

pub struct RenderState {
    pub surface: SendSurface,
    pub device: wgpu::Device,
    pub queue: wgpu::Queue,
    pub config: wgpu::SurfaceConfiguration,
    pub width: u32,
    pub height: u32,
}

impl RenderState {
    pub fn new(hwnd: isize, width: u32, height: u32) -> Result<Self, String> {
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
            backends: wgpu::Backends::DX12,
            ..Default::default()
        });

        let surface: wgpu::Surface<'static> = unsafe {
            let win32 = Win32WindowHandle::new(
                NonZeroIsize::new(hwnd).ok_or("Invalid HWND — cannot be zero")?,
            );
            let raw_window = RawWindowHandle::Win32(win32);
            let raw_display = RawDisplayHandle::Windows(WindowsDisplayHandle::new());

            instance
                .create_surface_unsafe(wgpu::SurfaceTargetUnsafe::RawHandle {
                    raw_display_handle: raw_display,
                    raw_window_handle: raw_window,
                })
                .map_err(|e| format!("create_surface_unsafe: {e}"))?
        };

        let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            compatible_surface: Some(&surface),
            force_fallback_adapter: false,
        }))
        .ok_or("No DX12-compatible GPU adapter found")?;

        let (device, queue) = pollster::block_on(adapter.request_device(
            &wgpu::DeviceDescriptor {
                label: Some("NyxRenderer"),
                required_features: wgpu::Features::empty(),
                required_limits: wgpu::Limits::default(),
            },
            None,
        ))
        .map_err(|e| format!("request_device: {e}"))?;

        let caps = surface.get_capabilities(&adapter);
        let format = caps
            .formats
            .iter()
            .find(|f| f.is_srgb())
            .copied()
            .unwrap_or(caps.formats[0]);

        let w = width.max(1);
        let h = height.max(1);
        let config = wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            format,
            width: w,
            height: h,
            present_mode: wgpu::PresentMode::Fifo,
            alpha_mode: wgpu::CompositeAlphaMode::Auto,
            view_formats: vec![],
            desired_maximum_frame_latency: 2,
        };
        surface.configure(&device, &config);

        Ok(RenderState {
            surface: SendSurface(surface),
            device,
            queue,
            config,
            width: w,
            height: h,
        })
    }

    pub fn resize(&mut self, width: u32, height: u32) {
        if width == 0 || height == 0 {
            return;
        }
        self.config.width = width;
        self.config.height = height;
        self.width = width;
        self.height = height;
        self.surface.0.configure(&self.device, &self.config);
    }
}
