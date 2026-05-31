import { invoke } from "@tauri-apps/api/tauri";
import { SceneCommand } from "./EngineProfiles";

export const RendererService = {
    async LoadScene(Config: { Commands: SceneCommand[]; Profile: string }): Promise<void> {
        return invoke("renderer_load_scene", {
            commands: Config.Commands,
            profile:  Config.Profile,
        });
    },

    async SetBounds(Config: { X: number; Y: number; Width: number; Height: number }): Promise<void> {
        return invoke("renderer_set_bounds", {
            x:      Config.X,
            y:      Config.Y,
            width:  Config.Width,
            height: Config.Height,
        });
    },

    async SetVisible(Config: { Visible: boolean }): Promise<void> {
        return invoke("renderer_set_visible", { visible: Config.Visible });
    },

    async Detach(): Promise<void> {
        return invoke("renderer_detach");
    },

    async Attach(Config: { X: number; Y: number; Width: number; Height: number }): Promise<void> {
        return invoke("renderer_attach", {
            x:      Config.X,
            y:      Config.Y,
            width:  Config.Width,
            height: Config.Height,
        });
    },

    async CameraOrbit(Config: { Dx: number; Dy: number }): Promise<void> {
        return invoke("renderer_camera_orbit", { dx: Config.Dx, dy: Config.Dy });
    },

    async CameraPan(Config: { Dx: number; Dy: number }): Promise<void> {
        return invoke("renderer_camera_pan", { dx: Config.Dx, dy: Config.Dy });
    },

    async CameraZoom(Config: { Delta: number }): Promise<void> {
        return invoke("renderer_camera_zoom", { delta: Config.Delta });
    },

    async SetOnTop(Config: { OnTop: boolean }): Promise<void> {
        return invoke("renderer_set_on_top", { onTop: Config.OnTop });
    },

    async Click(Config: { X: number; Y: number; Width: number; Height: number }): Promise<string | null> {
        return invoke("renderer_click", {
            x: Config.X,
            y: Config.Y,
            width: Config.Width,
            height: Config.Height,
        });
    },

    async GizmoHitTest(Config: { X: number; Y: number; Width: number; Height: number }): Promise<string | null> {
        return invoke("renderer_gizmo_hit_test", {
            x: Config.X, y: Config.Y,
            width: Config.Width, height: Config.Height,
        });
    },

    async CameraWasd(Config: { Forward: number; Right: number; Up: number }): Promise<void> {
        return invoke("renderer_camera_wasd", {
            forward: Config.Forward,
            right:   Config.Right,
            up:      Config.Up,
        });
    },

    async GizmoDrag(Config: {
        Axis: string;
        PrevX: number; PrevY: number;
        CurrX: number; CurrY: number;
        Width: number; Height: number;
    }): Promise<[number, number, number] | null> {
        return invoke("renderer_gizmo_drag", {
            axis:   Config.Axis,
            prevX:  Config.PrevX, prevY: Config.PrevY,
            currX:  Config.CurrX, currY: Config.CurrY,
            width:  Config.Width, height: Config.Height,
        });
    },

    async GetPart(Config: { Id: string }): Promise<Record<string, unknown> | null> {
        return invoke("renderer_get_part", { id: Config.Id });
    },

    async SetPartProperties(Config: {
        Id: string;
        Position?: { X: number; Y: number; Z: number };
        Size?:     { X: number; Y: number; Z: number };
        Color?:    { R: number; G: number; B: number };
        Rotation?: { RX: number; RY: number; RZ: number };
    }): Promise<void> {
        return invoke("renderer_set_part_properties", {
            id:       Config.Id,
            position: Config.Position ?? null,
            size:     Config.Size     ?? null,
            color:    Config.Color    ?? null,
            rotation: Config.Rotation ?? null,
        });
    },

    async SetGizmoMode(Config: { Mode: string }): Promise<void> {
        return invoke("renderer_set_gizmo_mode", { mode: Config.Mode });
    },

    async RotateDrag(Config: {
        Axis: string;
        PrevX: number; PrevY: number;
        CurrX: number; CurrY: number;
        Width: number; Height: number;
    }): Promise<[number, number, number] | null> {
        return invoke("renderer_rotate_drag", {
            axis:   Config.Axis,
            prevX:  Config.PrevX, prevY: Config.PrevY,
            currX:  Config.CurrX, currY: Config.CurrY,
            width:  Config.Width, height: Config.Height,
        });
    },

    async ScaleDrag(Config: {
        Axis: string;
        PrevX: number; PrevY: number;
        CurrX: number; CurrY: number;
        Width: number; Height: number;
    }): Promise<[number, number, number] | null> {
        return invoke("renderer_scale_drag", {
            axis:   Config.Axis,
            prevX:  Config.PrevX, prevY: Config.PrevY,
            currX:  Config.CurrX, currY: Config.CurrY,
            width:  Config.Width, height: Config.Height,
        });
    },

    async Undo(): Promise<void> {
        return invoke("renderer_undo");
    },

    async Redo(): Promise<void> {
        return invoke("renderer_redo");
    },

    async DeletePart(Config: { Id: string }): Promise<void> {
        return invoke("renderer_delete_part", { id: Config.Id });
    },

    async FrameSelected(): Promise<void> {
        return invoke("renderer_frame_selected");
    },

    async EndDrag(): Promise<void> {
        return invoke("renderer_end_drag");
    },
};
