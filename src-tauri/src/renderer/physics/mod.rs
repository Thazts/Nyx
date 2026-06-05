#![allow(non_snake_case)]

mod nyx_physics;
mod roblox_physics;
mod unity_physics;
mod unreal_physics;

use serde_json::Value;

use roblox_physics::RobloxPhysics;
use unity_physics::UnityPhysics;
use unreal_physics::UnrealPhysics;

#[derive(Debug, Clone)]
pub struct PhysicsWorld {
    Engine: EnginePhysics,
}

#[derive(Debug, Clone)]
enum EnginePhysics {
    Roblox(RobloxPhysics),
    Unity(UnityPhysics),
    Unreal(UnrealPhysics),
}

impl Default for PhysicsWorld {
    fn default() -> Self {
        Self {
            Engine: EnginePhysics::Roblox(RobloxPhysics::New()),
        }
    }
}

impl PhysicsWorld {
    pub fn Reset(&mut self, Commands: &[Value], Profile: &str) {
        self.Engine = EnginePhysics::ForProfile(Profile);
        self.Engine.Reset(Commands);
    }

    pub fn Reconcile(&mut self, Commands: &[Value], Profile: &str) {
        if !self.Engine.Matches(Profile) {
            self.Engine = EnginePhysics::ForProfile(Profile);
            self.Engine.Reset(Commands);
            return;
        }
        self.Engine.Reconcile(Commands);
    }

    pub fn StepCommands(&mut self, Commands: &mut [Value], DeltaTime: f32) -> bool {
        self.Engine.StepCommands(Commands, DeltaTime)
    }
}

impl EnginePhysics {
    fn ForProfile(Profile: &str) -> Self {
        match Profile.to_ascii_lowercase().as_str() {
            "unity" => Self::Unity(UnityPhysics::New()),
            "unreal" | "ue" | "ue5" => Self::Unreal(UnrealPhysics::New()),
            _ => Self::Roblox(RobloxPhysics::New()),
        }
    }

    fn Matches(&self, Profile: &str) -> bool {
        let Profile = Profile.to_ascii_lowercase();
        match self {
            Self::Roblox(_) => Profile == "roblox" || Profile.is_empty(),
            Self::Unity(_) => Profile == "unity",
            Self::Unreal(_) => Profile == "unreal" || Profile == "ue" || Profile == "ue5",
        }
    }

    fn Reset(&mut self, Commands: &[Value]) {
        match self {
            Self::Roblox(Engine) => Engine.Reset(Commands),
            Self::Unity(Engine) => Engine.Reset(Commands),
            Self::Unreal(Engine) => Engine.Reset(Commands),
        }
    }

    fn Reconcile(&mut self, Commands: &[Value]) {
        match self {
            Self::Roblox(Engine) => Engine.Reconcile(Commands),
            Self::Unity(Engine) => Engine.Reconcile(Commands),
            Self::Unreal(Engine) => Engine.Reconcile(Commands),
        }
    }

    fn StepCommands(&mut self, Commands: &mut [Value], DeltaTime: f32) -> bool {
        match self {
            Self::Roblox(Engine) => Engine.StepCommands(Commands, DeltaTime),
            Self::Unity(Engine) => Engine.StepCommands(Commands, DeltaTime),
            Self::Unreal(Engine) => Engine.StepCommands(Commands, DeltaTime),
        }
    }
}
