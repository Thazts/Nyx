#![allow(non_snake_case)]

use std::collections::HashMap;

use serde_json::Value;

use super::nyx_physics::{NyxEngineProfile, NyxFrictionMode, NyxMaterial, NyxPhysics};

#[derive(Debug, Clone)]
pub struct UnrealPhysics {
    Base: NyxPhysics,
}

impl UnrealPhysics {
    pub fn New() -> Self {
        Self {
            Base: NyxPhysics::New(UnrealProfile()),
        }
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

fn UnrealProfile() -> NyxEngineProfile {
    let mut Materials = HashMap::new();
    for (Name, Density, Friction, Restitution) in [
        ("Default", 1.00, 0.70, 0.00),
        ("SmoothPlastic", 1.00, 0.45, 0.00),
        ("Plastic", 1.00, 0.45, 0.00),
        ("Wood", 0.70, 0.60, 0.05),
        ("Metal", 7.80, 0.62, 0.04),
        ("Concrete", 2.40, 0.85, 0.00),
        ("Ice", 0.92, 0.02, 0.00),
        ("Rubber", 1.10, 1.00, 0.25),
        ("Glass", 2.50, 0.25, 0.02),
    ] {
        Materials.insert(
            Name.to_string(),
            NyxMaterial {
                Density,
                Friction,
                Restitution,
            },
        );
    }

    NyxEngineProfile {
        Id: "unreal",
        Gravity: 980.0,
        FixedStep: 1.0 / 120.0,
        MaxSubsteps: 8,
        SolverIterations: 10,
        LinearDamping: 0.01,
        AngularDamping: 0.06,
        SleepSpeed: 1.0,
        SleepDelay: 0.5,
        MaxLinearSpeed: 120_000.0,
        ContactSlop: 0.5,
        ContactBias: 0.25,
        MasslessScale: 1.0,
        RestitutionVelocityThreshold: 20.0,
        FrictionMode: NyxFrictionMode::Multiply,
        Materials,
    }
}
