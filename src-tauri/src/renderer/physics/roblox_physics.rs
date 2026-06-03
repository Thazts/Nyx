#![allow(non_snake_case)]

use std::collections::HashMap;

use serde_json::Value;

use super::nyx_physics::{NyxEngineProfile, NyxFrictionMode, NyxMaterial, NyxPhysics};

#[derive(Debug, Clone)]
pub struct RobloxPhysics {
    Base: NyxPhysics,
}

impl RobloxPhysics {
    pub fn New() -> Self {
        Self { Base: NyxPhysics::New(RobloxProfile()) }
    }

    pub fn Reset(&mut self, Commands: &[Value]) {
        self.Base.Reset(Commands);
    }

    pub fn Reconcile(&mut self, Commands: &[Value]) {
        self.Base.Reconcile(Commands);
    }

    pub fn StepCommands(&mut self, Commands: &mut [Value], DeltaTime: f32) -> bool {
        self.Base.StepCommands(Commands, DeltaTime)
    }
}

fn RobloxProfile() -> NyxEngineProfile {
    let mut Materials = HashMap::new();
    for (Name, Density, Friction, Restitution) in [
        ("SmoothPlastic", 0.70, 0.30, 0.00),
        ("Plastic",       0.70, 0.30, 0.00),
        ("Wood",          0.55, 0.48, 0.20),
        ("WoodPlanks",    0.55, 0.48, 0.20),
        ("Metal",         7.80, 0.40, 0.25),
        ("DiamondPlate",  7.80, 0.35, 0.25),
        ("Brick",         2.00, 0.80, 0.15),
        ("Concrete",      2.40, 0.70, 0.10),
        ("Granite",       2.70, 0.40, 0.10),
        ("Marble",        2.70, 0.20, 0.17),
        ("Cobblestone",   2.20, 0.50, 0.17),
        ("Slate",         2.70, 0.40, 0.21),
        ("Ice",           0.92, 0.02, 0.15),
        ("Grass",         0.35, 0.40, 0.10),
        ("Sand",          1.60, 0.50, 0.05),
        ("Fabric",        0.30, 0.35, 0.05),
        ("Rubber",        1.10, 0.80, 0.80),
        ("Neon",          0.70, 0.30, 0.20),
        ("Glass",         2.50, 0.25, 0.20),
        ("ForceField",    0.20, 0.30, 0.30),
        ("Rock",          2.20, 0.50, 0.17),
        ("Pebble",        2.00, 0.45, 0.17),
        ("CorrodedMetal", 7.00, 0.70, 0.15),
    ] {
        Materials.insert(Name.to_string(), NyxMaterial { Density, Friction, Restitution });
    }

    NyxEngineProfile {
        Id: "roblox",
        Gravity: 196.2,
        FixedStep: 1.0 / 240.0,
        MaxSubsteps: 8,
        SolverIterations: 8,
        LinearDamping: 0.015,
        AngularDamping: 0.08,
        SleepSpeed: 0.05,
        SleepDelay: 0.75,
        MaxLinearSpeed: 6000.0,
        ContactSlop: 0.035,
        ContactBias: 0.018,
        MasslessScale: 0.05,
        RestitutionVelocityThreshold: 1.0,
        FrictionMode: NyxFrictionMode::Average,
        Materials,
    }
}
