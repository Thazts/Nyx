#![allow(non_snake_case)]

use std::collections::HashMap;

use glam::Vec3;
use serde_json::{json, Map, Value};

#[derive(Debug, Clone, Copy)]
pub enum NyxFrictionMode {
    Average,
    Multiply,
}

#[derive(Debug, Clone, Copy)]
pub struct NyxMaterial {
    pub Density: f32,
    pub Friction: f32,
    pub Restitution: f32,
}

#[derive(Debug, Clone)]
pub struct NyxEngineProfile {
    pub Id: &'static str,
    pub Gravity: f32,
    pub FixedStep: f32,
    pub MaxSubsteps: usize,
    pub SolverIterations: usize,
    pub LinearDamping: f32,
    pub AngularDamping: f32,
    pub SleepSpeed: f32,
    pub SleepDelay: f32,
    pub MaxLinearSpeed: f32,
    pub ContactSlop: f32,
    pub ContactBias: f32,
    pub MasslessScale: f32,
    pub RestitutionVelocityThreshold: f32,
    pub FrictionMode: NyxFrictionMode,
    pub Materials: HashMap<String, NyxMaterial>,
}

#[derive(Debug, Clone)]
pub struct NyxPhysics {
    Profile: NyxEngineProfile,
    Gravity: f32,
    Accumulator: f32,
    Bodies: Vec<NyxBody>,
}

#[derive(Debug, Clone)]
struct NyxBody {
    Id: String,
    CommandIndex: usize,
    Position: Vec3,
    Size: Vec3,
    Rotation: Vec3,
    Velocity: Vec3,
    AngularVelocity: Vec3,
    Force: Vec3,
    Impulse: Vec3,
    Anchored: bool,
    CanCollide: bool,
    Massless: bool,
    Mass: f32,
    InvMass: f32,
    Density: f32,
    Friction: f32,
    Restitution: f32,
    Material: String,
    Shape: String,
    Sleeping: bool,
    SleepTimer: f32,
}

#[derive(Debug, Clone, Copy)]
struct NyxContact {
    A: usize,
    B: usize,
    Normal: Vec3,
    Depth: f32,
}

impl NyxPhysics {
    pub fn New(Profile: NyxEngineProfile) -> Self {
        let Gravity = Profile.Gravity;
        Self {
            Profile,
            Gravity,
            Accumulator: 0.0,
            Bodies: Vec::new(),
        }
    }

    pub fn Reset(&mut self, Commands: &[Value]) {
        self.Accumulator = 0.0;
        self.Rebuild(Commands, false);
    }

    pub fn Reconcile(&mut self, Commands: &[Value]) {
        self.Rebuild(Commands, true);
    }

    pub fn StepCommands(&mut self, Commands: &mut [Value], DeltaTime: f32) -> bool {
        if self
            .Bodies
            .iter()
            .all(|Body| Body.InvMass <= 0.0 || Body.Sleeping)
        {
            return false;
        }

        let DeltaTime = DeltaTime.clamp(
            0.0,
            self.Profile.FixedStep * self.Profile.MaxSubsteps as f32,
        );
        self.Accumulator = (self.Accumulator + DeltaTime)
            .min(self.Profile.FixedStep * self.Profile.MaxSubsteps as f32);

        let mut Stepped = false;
        let mut Substeps = 0;
        while self.Accumulator >= self.Profile.FixedStep && Substeps < self.Profile.MaxSubsteps {
            self.Step(self.Profile.FixedStep);
            self.Accumulator -= self.Profile.FixedStep;
            Substeps += 1;
            Stepped = true;
        }

        if Stepped {
            self.WriteBack(Commands);
        }
        Stepped
    }

    fn Rebuild(&mut self, Commands: &[Value], PreserveMotion: bool) {
        let Previous: HashMap<String, NyxBody> = if PreserveMotion {
            self.Bodies
                .iter()
                .map(|Body| (Body.Id.clone(), Body.clone()))
                .collect()
        } else {
            HashMap::new()
        };

        self.Gravity = Commands
            .iter()
            .filter_map(|Command| {
                (Command.get("Cmd").and_then(Value::as_str) == Some("SetGravity"))
                    .then(|| ReadF32(Command.get("Value"), self.Profile.Gravity))
            })
            .last()
            .unwrap_or(self.Profile.Gravity);

        self.Bodies.clear();

        for (CommandIndex, Command) in Commands.iter().enumerate() {
            if Command.get("Cmd").and_then(Value::as_str) != Some("AddPart") {
                continue;
            }

            let Id = Command
                .get("Id")
                .and_then(Value::as_str)
                .unwrap_or("Part")
                .to_string();
            let MaterialName = Command
                .get("Material")
                .and_then(Value::as_str)
                .unwrap_or("SmoothPlastic")
                .to_string();
            let Material = self.MaterialFor(&MaterialName);
            let Size =
                ReadVec3(Command.get("Size"), Vec3::new(4.0, 1.2, 2.0)).max(Vec3::splat(0.001));
            let Anchored = ReadBool(Command.get("Anchored"), false);
            let CanCollide = ReadBool(Command.get("CanCollide"), true);
            let Massless = ReadBool(Command.get("Massless"), false);
            let Density = ReadF32(Command.get("Density"), Material.Density).max(0.001);
            let Friction = ReadF32(Command.get("Friction"), Material.Friction).clamp(0.0, 4.0);
            let Restitution = ReadF32(
                Command
                    .get("Elasticity")
                    .or_else(|| Command.get("Restitution")),
                Material.Restitution,
            )
            .clamp(0.0, 2.0);
            let Volume = (Size.x.abs() * Size.y.abs() * Size.z.abs()).max(0.001);
            let BaseMass = ReadF32(Command.get("Mass"), Volume * Density).max(0.001);
            let Mass = if Massless {
                BaseMass * self.Profile.MasslessScale.max(0.001)
            } else {
                BaseMass
            };
            let InvMass = if Anchored { 0.0 } else { 1.0 / Mass };

            let PreviousBody = Previous.get(&Id);
            let Position = if !Anchored {
                PreviousBody
                    .map(|B| B.Position)
                    .unwrap_or_else(|| ReadPosition(Command))
            } else {
                ReadPosition(Command)
            };
            let Rotation = if !Anchored {
                PreviousBody
                    .map(|B| B.Rotation)
                    .unwrap_or_else(|| ReadRotation(Command))
            } else {
                ReadRotation(Command)
            };
            let Velocity = ReadVec3Any(
                Command,
                &["AssemblyLinearVelocity", "Velocity", "LinearVelocity"],
                PreviousBody.map(|Body| Body.Velocity).unwrap_or(Vec3::ZERO),
            );
            let AngularVelocity = ReadVec3Any(
                Command,
                &["AssemblyAngularVelocity", "RotVelocity", "AngularVelocity"],
                PreviousBody
                    .map(|Body| Body.AngularVelocity)
                    .unwrap_or(Vec3::ZERO),
            );

            self.Bodies.push(NyxBody {
                Id,
                CommandIndex,
                Position,
                Size,
                Rotation,
                Velocity,
                AngularVelocity,
                Force: ReadVec3Any(Command, &["Force", "AccumulatedForce"], Vec3::ZERO),
                Impulse: ReadVec3Any(Command, &["Impulse", "PendingImpulse"], Vec3::ZERO),
                Anchored,
                CanCollide,
                Massless,
                Mass,
                InvMass,
                Density,
                Friction,
                Restitution,
                Material: MaterialName,
                Shape: Command
                    .get("Shape")
                    .and_then(Value::as_str)
                    .unwrap_or("Block")
                    .to_string(),
                Sleeping: PreviousBody.map(|Body| Body.Sleeping).unwrap_or(false),
                SleepTimer: PreviousBody.map(|Body| Body.SleepTimer).unwrap_or(0.0),
            });
        }
    }

    fn Step(&mut self, DeltaTime: f32) {
        let Gravity = Vec3::new(0.0, -self.Gravity, 0.0);
        let LinearDamping = (1.0 - self.Profile.LinearDamping * DeltaTime).clamp(0.0, 1.0);
        let AngularDamping = (1.0 - self.Profile.AngularDamping * DeltaTime).clamp(0.0, 1.0);

        for Body in &mut self.Bodies {
            if Body.InvMass <= 0.0 {
                Body.Velocity = Vec3::ZERO;
                Body.AngularVelocity = Vec3::ZERO;
                continue;
            }

            if Body.Impulse.length_squared() > 0.0 {
                Body.Velocity += Body.Impulse * Body.InvMass;
                Body.Impulse = Vec3::ZERO;
                Body.Sleeping = false;
            }

            if Body.Sleeping {
                continue;
            }

            Body.Velocity += (Gravity + Body.Force * Body.InvMass) * DeltaTime;
            Body.Velocity *= LinearDamping;
            Body.AngularVelocity *= AngularDamping;
            Body.Force = Vec3::ZERO;

            let Speed = Body.Velocity.length();
            if Speed > self.Profile.MaxLinearSpeed {
                Body.Velocity = Body.Velocity / Speed * self.Profile.MaxLinearSpeed;
            }

            Body.Position += Body.Velocity * DeltaTime;
            Body.Rotation += Body.AngularVelocity * DeltaTime;
        }

        for _ in 0..self.Profile.SolverIterations {
            let Contacts = self.CollectContacts();
            if Contacts.is_empty() {
                break;
            }
            for Contact in Contacts {
                self.ResolveContact(Contact);
            }
        }

        for Body in &mut self.Bodies {
            if Body.InvMass <= 0.0 {
                continue;
            }

            if Body.Velocity.length() < self.Profile.SleepSpeed
                && Body.AngularVelocity.length() < self.Profile.SleepSpeed
            {
                Body.SleepTimer += DeltaTime;
                if Body.SleepTimer >= self.Profile.SleepDelay {
                    Body.Sleeping = true;
                    Body.Velocity = Vec3::ZERO;
                    Body.AngularVelocity = Vec3::ZERO;
                }
            } else {
                Body.SleepTimer = 0.0;
                Body.Sleeping = false;
            }
        }
    }

    fn CollectContacts(&self) -> Vec<NyxContact> {
        let mut Contacts = Vec::new();
        for A in 0..self.Bodies.len() {
            for B in (A + 1)..self.Bodies.len() {
                let BodyA = &self.Bodies[A];
                let BodyB = &self.Bodies[B];
                if !BodyA.CanCollide
                    || !BodyB.CanCollide
                    || (BodyA.InvMass <= 0.0 && BodyB.InvMass <= 0.0)
                {
                    continue;
                }
                if let Some(Contact) = ContactFor(A, BodyA, B, BodyB, self.Profile.ContactSlop) {
                    Contacts.push(Contact);
                }
            }
        }
        Contacts
    }

    fn ResolveContact(&mut self, Contact: NyxContact) {
        let (BodyA, BodyB) = SplitPairMut(&mut self.Bodies, Contact.A, Contact.B);
        let TotalInvMass = BodyA.InvMass + BodyB.InvMass;
        if TotalInvMass <= 0.0 {
            return;
        }

        let CorrectionDepth = (Contact.Depth + self.Profile.ContactBias).max(0.0);
        let Correction = Contact.Normal * (CorrectionDepth / TotalInvMass);
        if BodyA.InvMass > 0.0 {
            BodyA.Position -= Correction * BodyA.InvMass;
            BodyA.Sleeping = false;
        }
        if BodyB.InvMass > 0.0 {
            BodyB.Position += Correction * BodyB.InvMass;
            BodyB.Sleeping = false;
        }

        let RelativeVelocity = BodyB.Velocity - BodyA.Velocity;
        let NormalVelocity = RelativeVelocity.dot(Contact.Normal);
        if NormalVelocity > 0.0 {
            return;
        }

        let Restitution = if NormalVelocity.abs() < self.Profile.RestitutionVelocityThreshold {
            0.0
        } else {
            BodyA.Restitution.max(BodyB.Restitution)
        };

        let NormalImpulse = -(1.0 + Restitution) * NormalVelocity / TotalInvMass;
        let Impulse = Contact.Normal * NormalImpulse;
        if BodyA.InvMass > 0.0 {
            BodyA.Velocity -= Impulse * BodyA.InvMass;
        }
        if BodyB.InvMass > 0.0 {
            BodyB.Velocity += Impulse * BodyB.InvMass;
        }

        let RelativeVelocity = BodyB.Velocity - BodyA.Velocity;
        let TangentVelocity =
            RelativeVelocity - Contact.Normal * RelativeVelocity.dot(Contact.Normal);
        if TangentVelocity.length_squared() <= 0.000001 {
            return;
        }

        let Tangent = TangentVelocity.normalize();
        let FrictionImpulse = -RelativeVelocity.dot(Tangent) / TotalInvMass;
        let Friction = CombineFriction(BodyA.Friction, BodyB.Friction, self.Profile.FrictionMode);
        let ClampedFrictionImpulse =
            FrictionImpulse.clamp(-NormalImpulse * Friction, NormalImpulse * Friction);
        let FrictionVector = Tangent * ClampedFrictionImpulse;
        if BodyA.InvMass > 0.0 {
            BodyA.Velocity -= FrictionVector * BodyA.InvMass;
        }
        if BodyB.InvMass > 0.0 {
            BodyB.Velocity += FrictionVector * BodyB.InvMass;
        }
    }

    fn WriteBack(&self, Commands: &mut [Value]) {
        for Body in &self.Bodies {
            let Some(Command) = Commands.get_mut(Body.CommandIndex) else {
                continue;
            };
            let Some(Object) = Command.as_object_mut() else {
                continue;
            };

            // { X, Y, Z }
            Object.insert(
                "Position".to_string(),
                json!({
                    "X": Body.Position.x,
                    "Y": Body.Position.y,
                    "Z": Body.Position.z,
                }),
            );

            let mut CFrame = Object
                .get("CFrame")
                .and_then(Value::as_object)
                .cloned()
                .unwrap_or_else(Map::new);
            CFrame.insert("X".to_string(), json!(Body.Position.x));
            CFrame.insert("Y".to_string(), json!(Body.Position.y));
            CFrame.insert("Z".to_string(), json!(Body.Position.z));
            CFrame.insert("RX".to_string(), json!(Body.Rotation.x));
            CFrame.insert("RY".to_string(), json!(Body.Rotation.y));
            CFrame.insert("RZ".to_string(), json!(Body.Rotation.z));
            // { X, Y, Z, RX, RY, RZ }
            Object.insert("CFrame".to_string(), Value::Object(CFrame));

            // { X, Y, Z }
            let LinearVelocity = json!({
                "X": Body.Velocity.x,
                "Y": Body.Velocity.y,
                "Z": Body.Velocity.z,
            });
            Object.insert("AssemblyLinearVelocity".to_string(), LinearVelocity.clone());
            Object.insert("Velocity".to_string(), LinearVelocity);

            // { X, Y, Z }
            let AngularVelocity = json!({
                "X": Body.AngularVelocity.x,
                "Y": Body.AngularVelocity.y,
                "Z": Body.AngularVelocity.z,
            });
            Object.insert(
                "AssemblyAngularVelocity".to_string(),
                AngularVelocity.clone(),
            );
            Object.insert("RotVelocity".to_string(), AngularVelocity);

            Object.insert("Mass".to_string(), json!(Body.Mass));
            Object.insert("Density".to_string(), json!(Body.Density));
            Object.insert("Massless".to_string(), json!(Body.Massless));

            // { Profile, Sleeping, Anchored, CanCollide, Shape, Material, Mass, Density, Friction, Elasticity, LinearSpeed }
            Object.insert(
                "Physics".to_string(),
                json!({
                    "Profile": self.Profile.Id,
                    "Sleeping": Body.Sleeping,
                    "Anchored": Body.Anchored,
                    "CanCollide": Body.CanCollide,
                    "Shape": Body.Shape,
                    "Material": Body.Material,
                    "Mass": Body.Mass,
                    "Density": Body.Density,
                    "Friction": Body.Friction,
                    "Elasticity": Body.Restitution,
                    "LinearSpeed": Body.Velocity.length(),
                }),
            );
        }
    }

    fn MaterialFor(&self, Name: &str) -> NyxMaterial {
        self.Profile
            .Materials
            .get(Name)
            .copied()
            .unwrap_or(NyxMaterial {
                Density: 1.0,
                Friction: 0.35,
                Restitution: 0.0,
            })
    }
}

fn ContactFor(
    A: usize,
    BodyA: &NyxBody,
    B: usize,
    BodyB: &NyxBody,
    Slop: f32,
) -> Option<NyxContact> {
    let Delta = BodyB.Position - BodyA.Position;
    let HalfA = BodyA.Size * 0.5;
    let HalfB = BodyB.Size * 0.5;
    let Overlap = HalfA + HalfB - Delta.abs();
    if Overlap.x <= -Slop || Overlap.y <= -Slop || Overlap.z <= -Slop {
        return None;
    }

    let (Depth, Normal) = if Overlap.x <= Overlap.y && Overlap.x <= Overlap.z {
        (
            Overlap.x + Slop,
            Vec3::new(Delta.x.signum().max(-1.0).min(1.0), 0.0, 0.0),
        )
    } else if Overlap.y <= Overlap.z {
        (
            Overlap.y + Slop,
            Vec3::new(0.0, Delta.y.signum().max(-1.0).min(1.0), 0.0),
        )
    } else {
        (
            Overlap.z + Slop,
            Vec3::new(0.0, 0.0, Delta.z.signum().max(-1.0).min(1.0)),
        )
    };
    let Normal = if Normal.length_squared() <= 0.0 {
        Vec3::Y
    } else {
        Normal
    };

    Some(NyxContact {
        A,
        B,
        Normal,
        Depth,
    })
}

fn SplitPairMut<T>(Items: &mut [T], A: usize, B: usize) -> (&mut T, &mut T) {
    debug_assert!(A != B);
    if A < B {
        let (Left, Right) = Items.split_at_mut(B);
        (&mut Left[A], &mut Right[0])
    } else {
        let (Left, Right) = Items.split_at_mut(A);
        (&mut Right[0], &mut Left[B])
    }
}

fn CombineFriction(A: f32, B: f32, Mode: NyxFrictionMode) -> f32 {
    match Mode {
        NyxFrictionMode::Average => (A + B) * 0.5,
        NyxFrictionMode::Multiply => (A * B).sqrt(),
    }
}

fn ReadPosition(Command: &Value) -> Vec3 {
    if let Some(CFrame) = Command.get("CFrame") {
        return ReadVec3(Some(CFrame), Vec3::ZERO);
    }
    ReadVec3(Command.get("Position"), Vec3::ZERO)
}

fn ReadRotation(Command: &Value) -> Vec3 {
    let Some(CFrame) = Command.get("CFrame") else {
        return Vec3::ZERO;
    };
    Vec3::new(
        ReadF32(CFrame.get("RX"), 0.0),
        ReadF32(CFrame.get("RY"), 0.0),
        ReadF32(CFrame.get("RZ"), 0.0),
    )
}

fn ReadVec3Any(Command: &Value, Keys: &[&str], Default: Vec3) -> Vec3 {
    for Key in Keys {
        if let Some(Value) = Command.get(*Key) {
            return ReadVec3(Some(Value), Default);
        }
    }
    Default
}

fn ReadVec3(Value: Option<&Value>, Default: Vec3) -> Vec3 {
    let Some(Value) = Value else {
        return Default;
    };
    Vec3::new(
        ReadF32(Value.get("X"), Default.x),
        ReadF32(Value.get("Y"), Default.y),
        ReadF32(Value.get("Z"), Default.z),
    )
}

fn ReadF32(Value: Option<&Value>, Default: f32) -> f32 {
    Value
        .and_then(Value::as_f64)
        .map(|Value| Value as f32)
        .unwrap_or(Default)
}

fn ReadBool(Value: Option<&Value>, Default: bool) -> bool {
    Value.and_then(Value::as_bool).unwrap_or(Default)
}
