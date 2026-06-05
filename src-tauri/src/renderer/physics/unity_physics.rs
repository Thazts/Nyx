#![allow(non_snake_case)]

use std::collections::HashMap;

use serde_json::Value;

use super::nyx_physics::{NyxEngineProfile, NyxFrictionMode, NyxMaterial, NyxPhysics};

#[derive(Debug, Clone)]
pub struct UnityPhysics {
    Base: NyxPhysics,
}

impl UnityPhysics {
    pub fn New() -> Self {
        Self {
            Base: NyxPhysics::New(UnityProfile()),
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

fn UnityProfile() -> NyxEngineProfile {
    let mut Materials = HashMap::new();
    for (Name, Density, Friction, Restitution) in [
        ("Default", 1.00, 0.60, 0.00),
        ("SmoothPlastic", 1.00, 0.45, 0.00),
        ("Plastic", 1.00, 0.45, 0.00),
        ("Wood", 0.70, 0.50, 0.05),
        ("Metal", 7.80, 0.55, 0.05),
        ("Concrete", 2.40, 0.70, 0.00),
        ("Ice", 0.92, 0.03, 0.00),
        ("Rubber", 1.10, 0.95, 0.35),
        ("Glass", 2.50, 0.20, 0.02),
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
        Id: "unity",
        Gravity: 9.81,
        FixedStep: 0.02,
        MaxSubsteps: 5,
        SolverIterations: 6,
        LinearDamping: 0.0,
        AngularDamping: 0.05,
        SleepSpeed: 0.14,
        SleepDelay: 0.5,
        MaxLinearSpeed: 80.0,
        ContactSlop: 0.01,
        ContactBias: 0.005,
        MasslessScale: 1.0,
        RestitutionVelocityThreshold: 0.5,
        FrictionMode: NyxFrictionMode::Average,
        Materials,
    }
}
