export interface Vec3 { X: number; Y: number; Z: number; }
export interface RGB  { R: number; G: number; B: number; }

export interface PhysicsState {
    Profile?:     string;
    Sleeping?:    boolean;
    Anchored?:    boolean;
    CanCollide?:  boolean;
    Shape?:       string;
    Material?:    string;
    Mass?:        number;
    Density?:     number;
    Friction?:    number;
    Elasticity?:  number;
    UseGravity?:  boolean;
    GravityScale?: number;
    LinearDamping?: number;
    AngularDamping?: number;
    LinearSpeed?: number;
}

// { X, Y, Z }
export interface PhysicsVector extends Vec3 {}

export type SceneCommand =
    | { Cmd: "SetGravity";  Value: number }
    | { Cmd: "SetSkybox";   Color: RGB }
    | { Cmd: "AddPart";     Id: string; Name: string; Position: Vec3; Size: Vec3;
        Color: RGB; Anchored: boolean; CanCollide: boolean;
        Material: string; Transparency: number; Shape: "Block" | "Sphere" | "Cylinder" | "Cone" | "Wedge" | "Torus";
        CFrame?: { X: number; Y: number; Z: number; RX: number; RY: number; RZ: number };
        AssemblyLinearVelocity?: PhysicsVector; Velocity?: PhysicsVector;
        AssemblyAngularVelocity?: PhysicsVector; RotVelocity?: PhysicsVector;
        Force?: PhysicsVector; Impulse?: PhysicsVector;
        UseGravity?: boolean; GravityScale?: number;
        LinearDamping?: number; AngularDamping?: number;
        Massless?: boolean; Mass?: number; Density?: number; Friction?: number; Elasticity?: number;
        Physics?: PhysicsState }
    | { Cmd: "AddMesh";     Id: string; Name: string; Position: Vec3; Size: Vec3;
        Color: RGB; Anchored: boolean; CanCollide: boolean;
        Material: string; Transparency: number; Shape: "Mesh";
        Bounds: Vec3; Vertices: Vec3[]; Indices: number[];
        Normals?: Vec3[];
        CFrame?: { X: number; Y: number; Z: number; RX: number; RY: number; RZ: number } }
    | { Cmd: "AddLight";    LightType: "Directional" | "Point" | "Ambient";
        Position: Vec3; Color: RGB; Intensity: number }
    | { Cmd: "SetCamera";   Position: Vec3; LookAt: Vec3 }
    | { Cmd: "AddWeld";     PartA: string; PartB: string };

export interface MaterialProps {
    Friction:    number;
    Restitution: number;
}

export interface EngineProfile {
    Id:              string;
    Label:           string;
    Gravity:         number;
    Materials:       Record<string, MaterialProps>;
    DefaultSkyColor: RGB;
}

export const RobloxProfile: EngineProfile = {
    Id:    "roblox",
    Label: "Roblox Studio",
    Gravity: 196.2,
    Materials: {
        SmoothPlastic: { Friction: 0.30, Restitution: 0.00 },
        Plastic:       { Friction: 0.30, Restitution: 0.00 },
        Wood:          { Friction: 0.48, Restitution: 0.20 },
        WoodPlanks:    { Friction: 0.48, Restitution: 0.20 },
        Metal:         { Friction: 0.40, Restitution: 0.25 },
        DiamondPlate:  { Friction: 0.35, Restitution: 0.25 },
        Brick:         { Friction: 0.80, Restitution: 0.15 },
        Concrete:      { Friction: 0.70, Restitution: 0.10 },
        Granite:       { Friction: 0.40, Restitution: 0.10 },
        Marble:        { Friction: 0.20, Restitution: 0.17 },
        Cobblestone:   { Friction: 0.50, Restitution: 0.17 },
        Slate:         { Friction: 0.40, Restitution: 0.21 },
        Ice:           { Friction: 0.02, Restitution: 0.15 },
        Grass:         { Friction: 0.40, Restitution: 0.10 },
        Sand:          { Friction: 0.50, Restitution: 0.05 },
        Fabric:        { Friction: 0.35, Restitution: 0.05 },
        Rubber:        { Friction: 0.80, Restitution: 0.80 },
        Neon:          { Friction: 0.30, Restitution: 0.20 },
        Glass:         { Friction: 0.25, Restitution: 0.20 },
        ForceField:    { Friction: 0.30, Restitution: 0.30 },
        Rock:          { Friction: 0.50, Restitution: 0.17 },
        Pebble:        { Friction: 0.45, Restitution: 0.17 },
        CorrodedMetal: { Friction: 0.70, Restitution: 0.15 },
    },
    DefaultSkyColor: { R: 0.39, G: 0.58, B: 0.93 },
};

export const UnityProfile: EngineProfile = {
    Id:    "unity",
    Label: "Unity",
    Gravity: 9.81,
    Materials: {
        Default:       { Friction: 0.60, Restitution: 0.00 },
        SmoothPlastic: { Friction: 0.45, Restitution: 0.00 },
        Plastic:       { Friction: 0.45, Restitution: 0.00 },
        Wood:          { Friction: 0.50, Restitution: 0.05 },
        Metal:         { Friction: 0.55, Restitution: 0.05 },
        Concrete:      { Friction: 0.70, Restitution: 0.00 },
        Ice:           { Friction: 0.03, Restitution: 0.00 },
        Rubber:        { Friction: 0.95, Restitution: 0.35 },
        Glass:         { Friction: 0.20, Restitution: 0.02 },
    },
    DefaultSkyColor: { R: 0.32, G: 0.42, B: 0.55 },
};

export const UnrealProfile: EngineProfile = {
    Id:    "unreal",
    Label: "Unreal Engine",
    Gravity: 980.0,
    Materials: {
        Default:       { Friction: 0.70, Restitution: 0.00 },
        SmoothPlastic: { Friction: 0.45, Restitution: 0.00 },
        Plastic:       { Friction: 0.45, Restitution: 0.00 },
        Wood:          { Friction: 0.60, Restitution: 0.05 },
        Metal:         { Friction: 0.62, Restitution: 0.04 },
        Concrete:      { Friction: 0.85, Restitution: 0.00 },
        Ice:           { Friction: 0.02, Restitution: 0.00 },
        Rubber:        { Friction: 1.00, Restitution: 0.25 },
        Glass:         { Friction: 0.25, Restitution: 0.02 },
    },
    DefaultSkyColor: { R: 0.38, G: 0.50, B: 0.68 },
};

export const AllProfiles: EngineProfile[] = [RobloxProfile, UnityProfile, UnrealProfile];

export function GetProfile(Id: string): EngineProfile {
    return AllProfiles.find(P => P.Id === Id) ?? RobloxProfile;
}

export function InferProfileFromPath(Path: string): EngineProfile {
    const Ext = Path.split(/[\\/]/).pop()?.split(".").pop()?.toLowerCase() ?? "";
    if (Ext === "cs") return UnityProfile;
    if (Ext === "cpp" || Ext === "cc" || Ext === "cxx" || Ext === "h" || Ext === "hpp") return UnrealProfile;
    return RobloxProfile;
}
